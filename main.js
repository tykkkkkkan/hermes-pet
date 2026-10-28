const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, globalShortcut, safeStorage, Notification, protocol, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Live2D 模型要用 fetch 读取 .moc3 / .model3.json，file:// 下会被 CORS 拦。
// 这里注册一个只读的本地协议，把项目目录映射成 petasset://app/<相对路径>。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'petasset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);
const hermesBridge = require('./hermes-bridge');
const petMemory = require('./memory');
const petEmotion = require('./pet-emotion');
const petRuntime = require('./pet-runtime');
const { createTouchPicker } = require('./pet-interactions');

const WIN_W = 340;
const WIN_H = 500;
const HERMES_DIR = path.join(process.env.LOCALAPPDATA || '', 'hermes');
const PERSONA_FILE = path.join(__dirname, 'persona.json');

let win = null;
let tray = null;
let chatWin = null;
let topMost = true;
let chatBusy = false;
let hermesTimer = null;
let hermesPollInFlight = false;
let previousHermes = null;
let successUntil = 0;
let bridgeServer = null;
let bridgeToken = '';
let persona = readJson(PERSONA_FILE, {});
const pickTouchLine = createTouchPicker(persona);
let petState = {
  status: 'idle',
  statusText: '待命',
  hermesOnline: false,
  hermesText: 'Hermes 离线',
  runningCount: 0,
  queue: { todo: 0, ready: 0, scheduled: 0, running: 0, blocked: 0, review: 0, done: 0 },
  currentTask: null,
  agents: [],
  emotion: '平静',
  address: '大哥',
  affection: 50,
  mood: 72
};

const DEFAULT_SETTINGS = {
  userName: '大哥',
  petName: '赫尔墨兹',
  persona: '你是 Hermes 的专属桌宠。你是可靠、机灵、略带执事感的伙伴，说话直接但有分寸。你会主动关心主人正在做的事，优先给出能执行的下一步，不说空话。',
  apiBase: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKeyCipher: '',
  // ---- 外观 ----
  petScale: 100,          // 70 ~ 140 (%)
  petOpacity: 100,        // 40 ~ 100 (%)
  lineFrequency: 'normal', // quiet | normal | chatty
  // ---- 语音 ----
  voiceEnabled: true,
  voiceName: '',          // 空 = 自动挑中文女声
  voiceRate: 100,         // 70 ~ 130
  voiceVolume: 85,        // 0 ~ 100
  // ---- 免打扰 ----
  dndEnabled: false,
  dndStart: '23:30',
  dndEnd: '08:00',
  dndAllowApproval: true
};

function dataDir() {
  return app.getPath('userData');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function applyEmotionEvent(event) {
  petState = petEmotion.applyEvent(petState, event);
}

function refreshEmotionClock(now = Date.now()) {
  petState = petEmotion.decay(petState, now);
  const lastInteraction = Number(petState.lastInteraction) || now;
  const lastIgnoredAt = Number(petState.lastIgnoredAt) || 0;
  if (now - lastInteraction >= 6 * 3600000 && now - lastIgnoredAt >= 6 * 3600000) {
    applyEmotionEvent('ignored');
    petState.lastIgnoredAt = now;
  }
}

function trackUserEmotion(text) {
  const message = String(text || '');
  petState.lastInteraction = Date.now();
  petState.lastIgnoredAt = 0;
  if (/谢谢|辛苦|做得好|真棒|厉害|夸你/.test(message)) applyEmotionEvent('praised');
  if (/催|快点|赶紧|怎么还没|进度呢/.test(message)) {
    const now = Date.now();
    const recentNagCount = Number(petState.recentNagCount) || 0;
    const recentNagAt = Number(petState.recentNagAt) || 0;
    petState.recentNagCount = now - recentNagAt <= 10 * 60000 ? recentNagCount + 1 : 1;
    petState.recentNagAt = now;
    if (petState.recentNagCount >= 3) {
      applyEmotionEvent('nagged');
      petState.recentNagCount = 0;
    }
  }
}

function statusFromSnapshot(snapshot) {
  return petRuntime.deriveStatus(snapshot, { now: Date.now(), successUntil });
}

function taskTitle(task) {
  return String(task?.title || task?.name || `任务 #${task?.id ?? '?'}`).trim();
}

function announce(text, options = {}) {
  if (!text) return;
  if (!petRuntime.shouldAnnounce({
    taskResult: options.taskResult === true,
    userInitiated: options.userInitiated === true
  })) return;
  text = prepareUtterance(text, { keepAddress: options.kind === 'interaction' });
  // 免打扰只静音、不拦消息；审批/需协助类可按设置例外放行
  const s = publicSettings();
  const muted = inDndWindow() && !(options.critical === true && s.dndAllowApproval);
  if (win && !win.isDestroyed()) win.webContents.send('announce', text, { ...options, voice: !muted });
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('announce', text, options);
  if (options.notify) showSystemNotification(text);
}

function showSystemNotification(text) {
  try {
    const supported = Notification.isSupported();
    console.log(`[hermes-pet] notification supported=${supported} body=${text}`);
    if (supported) new Notification({ title: '赫尔墨兹', body: text }).show();
    return supported;
  } catch (error) {
    console.log(`[hermes-pet] notification error=${error?.message || error}`);
    return false;
  }
}

function prepareUtterance(text, options = {}) {
  const pool = Array.isArray(persona?.address?.pool) ? persona.address.pool : [];
  const history = Array.isArray(petState.addressHistory) ? petState.addressHistory : [];
  const previous = petState.address || '好大爹';
  // 互动回应不随机换称呼：连点几下就换一个名字，听着像好几个人在说话
  const address = options.keepAddress ? previous : petEmotion.chooseAddress(petState.emotion, previous, pool, history);
  if (address !== previous) {
    petState.address = address;
    petState.addressHistory = [...history, address].slice(-2);
  }
  let result = String(text || '').replaceAll('{address}', petState.address || '好大爹');
  const knownAddresses = pool.map((item) => item?.word).filter(Boolean);
  const prefix = new RegExp(`^(?:${knownAddresses.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[，,、：:\\s]+`);
  const startsWithAddress = prefix.test(result);
  if (address !== previous) {
    result = startsWithAddress ? result.replace(prefix, `${address}，`) : `${address}，${result}`;
  } else if (startsWithAddress) {
    result = result.replace(prefix, `${address}，`);
  }
  return result;
}

function bridgeFile() {
  // 冒烟测试要在桌宠已经跑着的时候再起一个实例，两者共用同一个桥接文件会互相顶掉端口，
  // 所以允许测试用环境变量把它引到别处。
  return process.env.PET_BRIDGE_FILE || path.join(HERMES_DIR, 'hermes-pet-bridge.json');
}

function bridgeJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function bridgeAuthorized(req) {
  const value = String(req.headers.authorization || '');
  return value === `Bearer ${bridgeToken}`;
}

function readBridgeBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100000) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求体不是有效 JSON')); }
    });
    req.on('error', reject);
  });
}

function bridgeState() {
  return {
    ...petState,
    pid: process.pid,
    visible: !!(win && !win.isDestroyed() && win.isVisible()),
    chatVisible: !!(chatWin && !chatWin.isDestroyed() && chatWin.isVisible())
  };
}

function interactPet(zone) {
  const line = pickTouchLine(String(zone || 'body'), petState.emotion, petState.mood);
  applyEmotionEvent('touched');
  petState.lastInteraction = Date.now();
  petState.mood = Math.min(100, petState.mood + 1);
  petState.affection = Math.min(100, petState.affection + 1);
  savePetState();
  pushPetState();
  announce(line, { kind: 'interaction', userInitiated: true });
}

function startBridgeServer() {
  bridgeToken = crypto.randomBytes(32).toString('hex');
  bridgeServer = http.createServer(async (req, res) => {
    if (!bridgeAuthorized(req)) return bridgeJson(res, 401, { ok: false, error: '未授权的桌宠桥接请求' });
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return bridgeJson(res, 200, { ok: true, pid: process.pid, version: app.getVersion() });
      }
      if (req.method === 'GET' && url.pathname === '/state') {
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      if (req.method !== 'POST') return bridgeJson(res, 404, { ok: false, error: '桥接路径不存在' });
      const body = await readBridgeBody(req);
      if (url.pathname === '/say') {
        const text = String(body.text || '').trim().slice(0, 2000);
        if (!text) return bridgeJson(res, 400, { ok: false, error: '播报内容不能为空' });
        announce(text, {
          kind: String(body.kind || 'plugin').slice(0, 40),
          notify: body.notify === true,
          taskResult: body.taskResult === true,
          userInitiated: true,
          source: 'hermes-plugin'
        });
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      if (url.pathname === '/status') {
        const status = String(body.status || 'idle').toLowerCase();
        if (!['idle', 'thinking', 'working', 'success', 'error', 'sleep'].includes(status)) {
          return bridgeJson(res, 400, { ok: false, error: '不支持的桌宠状态' });
        }
        setPetState(status, String(body.statusText || '').slice(0, 80) || undefined);
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      if (url.pathname === '/interact') {
        if (!['head', 'face', 'body', 'feet'].includes(String(body.zone || ''))) {
          return bridgeJson(res, 400, { ok: false, error: '不支持的互动区域' });
        }
        interactPet(body.zone);
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      if (url.pathname === '/open-chat') {
        showChat();
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      if (url.pathname === '/show') {
        showPet();
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      if (url.pathname === '/hide') {
        if (win && !win.isDestroyed()) win.hide();
        return bridgeJson(res, 200, { ok: true, state: bridgeState() });
      }
      return bridgeJson(res, 404, { ok: false, error: '桥接路径不存在' });
    } catch (error) {
      return bridgeJson(res, 500, { ok: false, error: String(error?.message || error) });
    }
  });
  bridgeServer.on('error', (error) => console.error('[hermes-pet] bridge error:', error.message));
  bridgeServer.listen(0, '127.0.0.1', () => {
    const address = bridgeServer.address();
    writeJson(bridgeFile(), {
      pid: process.pid,
      port: address.port,
      token: bridgeToken,
      startedAt: Date.now(),
      appPath: __dirname
    });
    console.log(`[hermes-pet] bridge listening on 127.0.0.1:${address.port}`);
  });
}

function stopBridgeServer() {
  try { bridgeServer?.close(); } catch {}
  bridgeServer = null;
  bridgeToken = '';
  try { fs.unlinkSync(bridgeFile()); } catch {}
}

function applyHermesSnapshot(snapshot) {
  const next = petRuntime.normalizeSnapshot(snapshot);
  const transitions = petRuntime.taskTransitions(previousHermes, next);
  if (previousHermes) {
    if (transitions.some(({ task }) => task.status === 'done')) successUntil = Date.now() + 4500;
    if (transitions.some(({ task }) => petRuntime.isFailureStatus(task.status))) successUntil = 0;
  }
  const stateChange = statusFromSnapshot(next);
  const statusChanged = !previousHermes || stateChange.status !== petState.status;
  refreshEmotionClock();
  petState = {
    ...petState,
    ...stateChange,
    hermesOnline: !!next.online,
    gatewayBusy: !!next.gatewayBusy,
    hermesText: next.online ? `在线 · ${next.running.length} 个在跑` : 'Hermes 离线',
    runningCount: next.running.length,
    queue: next.counts,
    currentTask: next.currentTask ? {
      id: next.currentTask.id,
      title: taskTitle(next.currentTask),
      assignee: next.currentTask.assignee || ''
    } : null,
    agents: next.agents
  };
  if (statusChanged && (next.running || []).length) applyEmotionEvent('working');
  pushPetState();

  if (previousHermes) {
    for (const { task } of transitions) {
      if (task.status === 'done') {
        applyEmotionEvent('success');
        petState.mood = Math.min(100, petState.mood + 2);
        announce(`{address}，${taskTitle(task)} 完成了，验收一下`, { notify: true, kind: 'success', taskResult: true });
      } else if (petRuntime.isFailureStatus(task.status)) {
        applyEmotionEvent('failure');
        petState.mood = Math.max(0, petState.mood - 1);
        const resultWord = task.status === 'blocked' ? '受阻' : '失败';
        announce(`{address}，${taskTitle(task)} ${resultWord}了。先别急，我把问题盯住`, { notify: true, kind: 'error', taskResult: true });
      }
    }
    if (previousHermes.online && !next.online) {
      announce('{address}，Hermes 服务断了，我先安静等它回来', { notify: true, kind: 'error' });
    } else if (!previousHermes.online && next.online) {
      announce('{address}，Hermes 回来了，现在在线', { notify: false, kind: 'success' });
    }
  }
  previousHermes = next;
  savePetState();
}

async function pollHermes() {
  if (hermesPollInFlight) return;
  hermesPollInFlight = true;
  try {
    applyHermesSnapshot(await hermesBridge.snapshot());
  } catch {
    applyHermesSnapshot({ online: false });
  } finally {
    hermesPollInFlight = false;
  }
}

function startHermesPolling() {
  clearInterval(hermesTimer);
  pollHermes();
  hermesTimer = setInterval(pollHermes, 3000);
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

function settingsFile() {
  return path.join(dataDir(), 'settings.json');
}

function historyFile() {
  return path.join(dataDir(), 'memory', 'chat.json');
}

function stateFile() {
  return path.join(dataDir(), 'memory', 'state.json');
}

function recordSessionMessage(sessionId, role, content, at = Date.now()) {
  return petMemory.record(path.join(dataDir(), 'memory'), sessionId, role, content, at);
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(readJson(settingsFile(), {}) || {}) };
}

function getApiKey(settings = loadSettings()) {
  if (!settings.apiKeyCipher || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(settings.apiKeyCipher, 'base64'));
  } catch {
    return '';
  }
}

/* 从 Hermes 的 .env 导入 DeepSeek 密钥，省得再手填一遍。
 * 只在桌宠自己还没配密钥时自动执行；也可以从设置面板手动触发。 */
function importKeyFromHermes() {
  const envPath = path.join(process.env.LOCALAPPDATA || '', 'hermes', '.env');
  try {
    if (!fs.existsSync(envPath)) return { ok: false, reason: '没找到 Hermes 的 .env' };
    const raw = fs.readFileSync(envPath, 'utf8');
    const pick = (name) => {
      const m = raw.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.+)$', 'm'));
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    };
    const key = pick('DEEPSEEK_API_KEY');
    if (!key) return { ok: false, reason: '.env 里没有 DEEPSEEK_API_KEY' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: '系统加密存储不可用' };

    const base = pick('DEEPSEEK_API_BASE') || 'https://api.deepseek.com/v1';
    const current = loadSettings();
    const next = {
      ...current,
      apiBase: base,
      model: current.model || 'deepseek-chat',
      apiKeyCipher: safeStorage.encryptString(key).toString('base64')
    };
    writeJson(settingsFile(), next);
    console.log(`[hermes-pet] 已从 Hermes 导入 DeepSeek 密钥（长度 ${key.length}，base ${base}）`);
    return { ok: true, base, keyLength: key.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function saveSettings(input = {}) {
  const current = loadSettings();
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  };
  const pickEnum = (v, list, fallback) => (list.includes(v) ? v : fallback);
  const pickTime = (v, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : fallback);

  const next = {
    ...current,
    userName: String(input.userName || current.userName).trim().slice(0, 40) || DEFAULT_SETTINGS.userName,
    petName: String(input.petName || current.petName).trim().slice(0, 40) || DEFAULT_SETTINGS.petName,
    persona: String(input.persona || current.persona).trim().slice(0, 1200) || DEFAULT_SETTINGS.persona,
    apiBase: String(input.apiBase || current.apiBase).trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.apiBase,
    model: String(input.model || current.model).trim().slice(0, 100) || DEFAULT_SETTINGS.model,

    petScale: clamp(input.petScale, 70, 140, current.petScale ?? 100),
    petOpacity: clamp(input.petOpacity, 40, 100, current.petOpacity ?? 100),
    lineFrequency: pickEnum(input.lineFrequency, ['quiet', 'normal', 'chatty'], current.lineFrequency || 'normal'),

    voiceEnabled: input.voiceEnabled == null ? !!current.voiceEnabled : !!input.voiceEnabled,
    voiceName: String(input.voiceName == null ? current.voiceName || '' : input.voiceName).slice(0, 120),
    voiceRate: clamp(input.voiceRate, 70, 130, current.voiceRate ?? 100),
    voiceVolume: clamp(input.voiceVolume, 0, 100, current.voiceVolume ?? 85),

    dndEnabled: input.dndEnabled == null ? !!current.dndEnabled : !!input.dndEnabled,
    dndStart: pickTime(input.dndStart, current.dndStart || '23:30'),
    dndEnd: pickTime(input.dndEnd, current.dndEnd || '08:00'),
    dndAllowApproval: input.dndAllowApproval == null ? current.dndAllowApproval !== false : !!input.dndAllowApproval
  };
  if (input.apiKey && String(input.apiKey).trim()) {
    if (safeStorage.isEncryptionAvailable()) {
      next.apiKeyCipher = safeStorage.encryptString(String(input.apiKey).trim()).toString('base64');
    }
  } else if (input.clearApiKey) {
    next.apiKeyCipher = '';
  }
  writeJson(settingsFile(), next);
  applyAppearance();
  return next;
}

function publicSettings() {
  const s = loadSettings();
  return {
    userName: s.userName,
    petName: s.petName,
    persona: s.persona,
    apiBase: s.apiBase,
    model: s.model,
    hasApiKey: !!s.apiKeyCipher,
    petScale: s.petScale ?? 100,
    petOpacity: s.petOpacity ?? 100,
    lineFrequency: s.lineFrequency || 'normal',
    voiceEnabled: s.voiceEnabled !== false,
    voiceName: s.voiceName || '',
    voiceRate: s.voiceRate ?? 100,
    voiceVolume: s.voiceVolume ?? 85,
    dndEnabled: !!s.dndEnabled,
    dndStart: s.dndStart || '23:30',
    dndEnd: s.dndEnd || '08:00',
    dndAllowApproval: s.dndAllowApproval !== false
  };
}

/* 当前是否处在免打扰时段（支持跨午夜，例如 23:30 → 08:00） */
function inDndWindow(now = new Date()) {
  const s = publicSettings();
  if (!s.dndEnabled) return false;
  const toMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const start = toMin(s.dndStart);
  const end = toMin(s.dndEnd);
  if (start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/* 把外观设置真正落到窗口上：尺寸以右下角为锚点缩放，透明度只作用于角色本体 */
function applyAppearanceValues(scalePct, opacityPct) {
  const scale = Math.max(70, Math.min(140, Number(scalePct) || 100)) / 100;
  const w = Math.round(WIN_W * scale);
  const h = Math.round(WIN_H * scale);

  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    if (b.width !== w || b.height !== h) {
      const anchorX = b.x + b.width;
      const anchorY = b.y + b.height;
      win.setBounds({ x: Math.round(anchorX - w), y: Math.round(anchorY - h), width: w, height: h });
    }
    const opacity = Math.max(40, Math.min(100, Number(opacityPct) || 100)) / 100;
    win.webContents.send('appearance', { opacity });
  }
}

function applyAppearance() {
  const s = publicSettings();
  applyAppearanceValues(s.petScale, s.petOpacity);
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('settings-changed', publicSettings());
}

function loadHistory() {
  const rows = readJson(historyFile(), []);
  return Array.isArray(rows) ? rows.filter((x) => x && (x.role === 'user' || x.role === 'assistant')).slice(-200) : [];
}

function appendHistory(role, content) {
  const rows = loadHistory();
  rows.push({ role, content: String(content || '').slice(0, 8000), at: Date.now() });
  writeJson(historyFile(), rows.slice(-200));
}

function loadPetState() {
  const saved = readJson(stateFile(), {});
  const lastSeen = Number(saved.lastSeen) || Date.now();
  const hoursAway = Math.max(0, (Date.now() - lastSeen) / 3600000);
  return {
    status: 'idle',
    statusText: '待命',
    emotion: saved.emotion || '平静',
    emotionScores: saved.emotionScores || {},
    addressHistory: Array.isArray(saved.addressHistory) ? saved.addressHistory.slice(-2) : [],
    lastEmotionDecay: Number(saved.lastEmotionDecay) || lastSeen,
    lastInteraction: Number(saved.lastInteraction) || lastSeen,
    lastIgnoredAt: Number(saved.lastIgnoredAt) || 0,
    address: saved.address || '大哥',
    hermesOnline: false,
    hermesText: 'Hermes 离线',
    runningCount: 0,
    queue: { todo: 0, ready: 0, scheduled: 0, running: 0, blocked: 0, review: 0, done: 0 },
    currentTask: null,
    agents: [],
    affection: Math.max(0, Math.min(100, Number(saved.affection) || 50)),
    mood: Math.max(0, Math.min(100, (Number(saved.mood) || 72) - Math.min(24, Math.floor(hoursAway * 1.5))))
  };
}

function savePetState() {
  refreshEmotionClock();
  writeJson(stateFile(), {
    affection: petState.affection,
    mood: petState.mood,
    emotion: petState.emotion,
    address: petState.address,
    emotionScores: petState.emotionScores,
    addressHistory: petState.addressHistory,
    lastEmotionDecay: petState.lastEmotionDecay,
    lastInteraction: petState.lastInteraction,
    lastIgnoredAt: petState.lastIgnoredAt,
    lastSeen: Date.now()
  });
}

function pushPetState() {
  if (win && !win.isDestroyed()) win.webContents.send('pet-state', petState);
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('pet-state', petState);
}

function setPetState(status, statusText) {
  petState.status = status || 'idle';
  petState.statusText = statusText || ({ idle: '待命', thinking: '思考中', working: '执行中', success: '完成', error: '遇到问题', sleep: '安静中' }[petState.status] || '待命');
  pushPetState();
}

function adjustPetState(affection = 0, mood = 0) {
  petState.affection = Math.max(0, Math.min(100, Math.round(petState.affection + affection)));
  petState.mood = Math.max(0, Math.min(100, Math.round(petState.mood + mood)));
  savePetState();
  pushPetState();
}

function localReply(text) {
  const t = String(text || '').toLowerCase();
  if (/你好|嗨|早上好|晚上好|在吗/.test(t)) return '我在。今天先把最重要的一件事拎出来，我陪你做完。';
  if (/累|困|休息|睡觉/.test(t)) return '收到。先离开屏幕两分钟，回来以后我帮你把剩下的事拆小。';
  if (/状态|怎么样|进度/.test(t)) return `我现在${petState.statusText}，心情 ${petState.mood}/100，好感 ${petState.affection}/100。`;
  if (/谢谢|辛苦/.test(t)) return '记下了。你把下一步交给我，别自己扛着。';
  return '我已经记住这句话了。现在还没接入模型，我先陪你把想法理顺；配置 DeepSeek 后，我会继续接着聊。';
}

async function askModel(text) {
  const settings = loadSettings();
  const apiKey = getApiKey(settings);
  if (!apiKey) return localReply(text);
  const base = settings.apiBase.replace(/\/+$/, '');
  const recent = loadHistory().slice(-16).map((m) => ({ role: m.role, content: m.content }));
  const system = `${settings.persona}
主人称呼：${settings.userName}。
你是桌宠，不要声称自己已经执行了电脑操作。当前状态：${petState.statusText}；心情：${petState.mood}/100；好感：${petState.affection}/100。
回答要短、具体、像熟悉主人的桌面伙伴。除非主人要求，不要输出 Markdown 标题，不要复述问题。`;
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.8,
      max_tokens: 500,
      messages: [{ role: 'system', content: system }, ...recent]
    }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`模型接口返回 ${response.status}${body ? `：${body.slice(0, 160)}` : ''}`);
  }
  const data = await response.json();
  const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!answer) throw new Error('模型没有返回可显示的内容');
  return String(answer).trim();
}

/* 启动落点：优先用上次拖到的位置，但要重新夹进工作区——
 * 窗口从 224×372 长到 340×500 之后，旧坐标会把右下角顶到屏幕外，
 * 脚底投影正好被任务栏吃掉。夹一遍就永远完整可见。 */
function startPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  const fallback = {
    x: workArea.x + workArea.width - WIN_W - 30,
    y: workArea.y + workArea.height - WIN_H
  };
  const saved = readJson(path.join(dataDir(), 'position.json'), null);
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback;

  const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: WIN_W, height: WIN_H }).workArea;
  // 下限留 0：底边贴着工作区，投影才在窗口内
  return {
    x: Math.round(Math.min(Math.max(saved.x, area.x), area.x + area.width - WIN_W)),
    y: Math.round(Math.min(Math.max(saved.y, area.y), area.y + area.height - WIN_H))
  };
}

function createWindow() {
  const start = startPosition();

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: start.x,
    y: start.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 里 require 了 pet-regions.json 和 states/manifest.json；
      // Electron 20 起渲染进程默认沙箱化，沙箱内的 preload 只能 require electron，
      // 本地 json 会直接 module not found，window.pet 整个消失。
      sandbox: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    // PET_LIVE2D=0 时停用 Live2D，直接回到静态立绘
    query: process.env.PET_LIVE2D === '0' ? { live2d: '0' } : {}
  });
  win.once('ready-to-show', () => { win.show(); applyAppearance(); });
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    const message = first && typeof first === 'object' && 'message' in first ? first.message : args[2];
    if (typeof message === 'string' && (message.startsWith('[pet-live2d]') || message.startsWith('[pet-puppet]'))) console.log(message);
  });
  win.on('move', () => {
    if (!win.isDestroyed()) {
      const [x, y] = win.getPosition();
      writeJson(path.join(dataDir(), 'position.json'), { x, y });
    }
  });

  // 开发自检：PET_APPEARANCE_TEST=1 验证大小/不透明度是否真的落到窗口上
  if (process.env.PET_APPEARANCE_TEST) {
    setTimeout(async () => {
      console.log('appearance before:', JSON.stringify(win.getBounds()));
      await win.webContents
        .executeJavaScript('window.pet.previewAppearance({ petScale: 80, petOpacity: 65 })')
        .catch(() => {});
      setTimeout(async () => {
        console.log('appearance after:', JSON.stringify(win.getBounds()));
        try {
          fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
          const img = await win.capturePage();
          fs.writeFileSync(path.join(__dirname, '.tmp', 'appearance-shot.png'), img.toPNG());
          console.log('appearance shot saved');
        } catch (e) {
          console.log('appearance shot failed:', e.message);
        }
      }, 900);
    }, 3500);
  }

  // 开发自检：PET_SETTINGS_TEST=1 打开设置面板并截图
  if (process.env.PET_SETTINGS_TEST) {
    setTimeout(() => {
      showChat();
      setTimeout(() => {
        if (!chatWin || chatWin.isDestroyed()) return;
        chatWin.webContents.send('open-settings');
        setTimeout(async () => {
          try {
            const img = await chatWin.capturePage();
            fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, '.tmp', 'settings-shot.png'), img.toPNG());
            console.log('settings shot saved');
          } catch (e) {
            console.log('settings shot failed:', e.message);
          }
        }, 1200);
      }, 1600);
    }, 3000);
  }

  // 开发自检：PET_MENU_TEST=1 打开右键菜单小窗并截图，核对它是否贴在角色侧边
  if (process.env.PET_MENU_TEST) {
    setTimeout(async () => {
      openMenuWindow();
      setTimeout(async () => {
        try {
          if (menuWin && !menuWin.isDestroyed()) {
            const img = await menuWin.capturePage();
            fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, '.tmp', 'menu-shot.png'), img.toPNG());
            console.log('menu shot saved, pos:', JSON.stringify(menuWin.getPosition()));
          }
        } catch (e) {
          console.log('menu shot failed:', e.message);
        }
      }, 1300);
    }, 3200);
  }

  // 开发自检：PET_TTS_PROBE=1 探测系统可用的离线语音包
  if (process.env.PET_TTS_PROBE) {
    setTimeout(async () => {
      const script = `new Promise(function(res){
        function read(){
          try { return speechSynthesis.getVoices().map(function(v){ return v.name + ' | ' + v.lang + ' | local=' + v.localService; }); }
          catch (e) { return ['ERR:' + e.message]; }
        }
        var v = read();
        if (v.length) return res(v);
        speechSynthesis.onvoiceschanged = function(){ res(read()); };
        setTimeout(function(){ res(read()); }, 1800);
      })`;
      try {
        const voices = await win.webContents.executeJavaScript(script);
        console.log('tts voices:', JSON.stringify(voices));
      } catch (e) {
        console.log('tts probe failed:', e.message);
      }
    }, 2600);
  }

  // 开发自检：PET_HOVER_TEST=1 模拟鼠标停在头顶，验证摸头互动与爱心特效
  if (process.env.PET_HOVER_TEST) {
    setTimeout(() => {
      const script = `(function(){
        var a = document.getElementById('pet-hit-area').getBoundingClientRect();
        var x = a.left + a.width * 0.5;
        var y = a.top + a.height * 0.12;
        function fire(){ window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true })); }
        fire();
        setTimeout(fire, 620);
        setTimeout(fire, 900);
        return 'hover-injected';
      })()`;
      win.webContents.executeJavaScript(script).then((r) => console.log('hover test:', r)).catch(() => {});
    }, 3000);
  }

  // 开发自检：PET_DRAG_TEST=1 模拟连续拖拽，核对窗口位置与画布尺寸是否稳定
  if (process.env.PET_DRAG_TEST) {
    setTimeout(async () => {
      const probe = `(function(){
        var c = document.querySelector('#pet-live2d-host canvas');
        var r = c ? c.getBoundingClientRect() : null;
        var pet = document.getElementById('pet');
        return {
          iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio,
          canvasCss: r ? Math.round(r.width) + 'x' + Math.round(r.height) : 'none',
          canvasPx: c ? c.width + 'x' + c.height : 'none',
          petTransform: pet ? getComputedStyle(pet).transform : 'none',
          anim: pet ? getComputedStyle(pet).animationName : 'none',
          animState: pet ? getComputedStyle(pet).animationPlayState : 'none',
          classes: pet ? pet.className : ''
        };
      })()`;
      const before = await win.webContents.executeJavaScript(probe);
      console.log('drag[0] before:', JSON.stringify(before), 'pos:', JSON.stringify(win.getPosition()));
      const step = Number(process.env.PET_DRAG_STEP) || 30;
      for (let i = 1; i <= 40; i++) {
        win.webContents.executeJavaScript(`window.pet.moveTo(${step}, 10)`).catch(() => {});
        await new Promise((r) => setTimeout(r, 55));
        if (i % 10 === 0) {
          const p = win.getPosition();
          console.log(`drag[${i}] pos:`, JSON.stringify(p));
        }
      }
      const after = await win.webContents.executeJavaScript(probe);
      console.log('drag[40] after:', JSON.stringify(after), 'pos:', JSON.stringify(win.getPosition()));
      try {
        fs.mkdirSync(path.join(__dirname, '.tmp'), { recursive: true });
        const img = await win.capturePage();
        fs.writeFileSync(path.join(__dirname, '.tmp', 'drag-shot.png'), img.toPNG());
        console.log('drag shot saved');
      } catch (e) {
        console.log('drag shot failed:', e.message);
      }
    }, 3600);
  }

  // 开发自检：PET_SHOT=1 时把窗口渲染结果存一张图，用来核对透明与排版
  if (process.env.PET_SHOT) {
    // PET_STATE_TEST=success/error/sleep… 可在截图前切一次状态，验证参数驱动是否生效
    if (process.env.PET_STATE_TEST) {
      setTimeout(() => {
        // 用轮询保持测试状态，否则会被 Hermes 状态推送覆盖回 idle
        const script = `(function(){
          if (!window.petLive2d) return 'missing';
          var s = ${JSON.stringify(process.env.PET_STATE_TEST)};
          window.petLive2d.setState(s);
          clearInterval(window.__stateTestTimer);
          window.__stateTestTimer = setInterval(function(){ window.petLive2d.setState(s); }, 250);
          return 'ok';
        })()`;
        win.webContents.executeJavaScript(script).then((r) => console.log('state test:', r)).catch(() => {});
      }, 4200);
    }
    const delay = Number(process.env.PET_SHOT_DELAY) || 2600;
    setTimeout(async () => {
      const img = await win.capturePage();
      fs.writeFileSync(path.join(__dirname, 'shot.png'), img.toPNG());
      console.log('shot saved:', path.join(__dirname, 'shot.png'));
    }, delay);
  }
  win.on('closed', () => { win = null; });
}

// Phase 0 技术验证窗：只用来确认 Live2D 渲染链路能跑通，不影响桌宠本体。
// 启动方式：PET_LIVE2D_TEST=1 npm start
function createLive2dTestWindow() {
  const testWin = new BrowserWindow({
    width: 520,
    height: 720,
    title: 'Live2D 技术验证',
    backgroundColor: '#15161c',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  testWin.loadURL('petasset://app/renderer/live2d-test.html');
  testWin.webContents.on('console-message', (...args) => {
    const first = args[0];
    const message = first && typeof first === 'object' && 'message' in first ? first.message : args[2];
    console.log('[live2d-test]', message);
  });
  if (process.env.PET_LIVE2D_SHOT) {
    const delay = Number(process.env.PET_LIVE2D_SHOT) || 6000;
    setTimeout(async () => {
      const img = await testWin.capturePage();
      fs.writeFileSync(path.join(__dirname, 'live2d-test.png'), img.toPNG());
      console.log('live2d shot saved:', path.join(__dirname, 'live2d-test.png'));
    }, delay);
  }
  return testWin;
}

function createChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) return chatWin;
  chatWin = new BrowserWindow({
    width: 760,
    height: 780,
    minWidth: 620,
    minHeight: 620,
    frame: false,
    backgroundColor: '#f7f8fc',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 里 require 了 pet-regions.json 和 states/manifest.json；
      // Electron 20 起渲染进程默认沙箱化，沙箱内的 preload 只能 require electron，
      // 本地 json 会直接 module not found，window.pet 整个消失。
      sandbox: false
    }
  });
  chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  chatWin.once('ready-to-show', () => {
    chatWin.show();
    pushPetState();
  });
  chatWin.on('closed', () => { chatWin = null; });
  return chatWin;
}

function showChat() {
  const panel = createChatWindow();
  panel.show();
  panel.focus();
}

// ---------- 托盘 ----------
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'hermes-chibi.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 32, height: 32 });

  tray = new Tray(icon);
  tray.setToolTip('Hermes 桌宠');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '叫她出来', click: () => showPet() },
    { label: '打开 Hermes 对话', click: () => showChat() },
    { label: '安静一会儿', click: () => win && win.hide() },
    { type: 'separator' },
    { label: '打开 Hermes 目录', click: () => shell.openPath(HERMES_DIR) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('double-click', () => showPet());
}

function showPet() {
  if (!win) createWindow();
  else { win.show(); win.setAlwaysOnTop(true, 'screen-saver'); }
}

// ---------- 右键菜单：独立小窗，贴在桌宠侧边，避免盖住角色 ----------
let menuWin = null;

function closeMenuWindow() {
  if (menuWin && !menuWin.isDestroyed()) menuWin.destroy();
  menuWin = null;
}

function openMenuWindow() {
  if (!win) return;
  if (menuWin && !menuWin.isDestroyed()) { closeMenuWindow(); return; }

  const MENU_W = 206, MENU_H = 472;
  const [wx, wy] = win.getPosition();
  const { workArea } = screen.getDisplayNearestPoint({ x: wx, y: wy });

  // 优先贴左侧；左边放不下就贴右侧
  let x = wx - MENU_W - 10;
  if (x < workArea.x) x = Math.min(wx + WIN_W + 10, workArea.x + workArea.width - MENU_W - 8);
  // 纵向对齐角色的上半身
  let y = Math.min(Math.max(wy + 90, workArea.y + 8), workArea.y + workArea.height - MENU_H - 8);

  menuWin = new BrowserWindow({
    width: MENU_W,
    height: MENU_H,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  menuWin.setAlwaysOnTop(true, 'screen-saver');
  menuWin.loadFile(path.join(__dirname, 'renderer', 'menu.html'));
  menuWin.once('ready-to-show', () => {
    if (!menuWin) return;
    menuWin.show();
    menuWin.focus();
    // 等它真正拿到焦点后再挂失焦关闭，否则会被自身 show 触发的 blur 立刻关掉
    setTimeout(() => {
      if (menuWin && !menuWin.isDestroyed()) menuWin.once('blur', () => closeMenuWindow());
    }, 220);
  });
  menuWin.on('closed', () => { menuWin = null; });
}

ipcMain.on('open-menu', () => openMenuWindow());
ipcMain.on('close-menu', () => closeMenuWindow());
ipcMain.on('menu-action', (_e, act) => {
  closeMenuWindow();
  if (win && !win.isDestroyed()) win.webContents.send('menu-action', act);
});
ipcMain.on('open-settings', () => {
  closeMenuWindow();
  showChat();
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('open-settings');
});

// ---------- 鼠标穿透：只有落在小人身上才接管点击 ----------
ipcMain.on('set-ignore', (_e, ignore) => {
  if (!win) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});

// ---------- 拖拽 ----------
/* 之前用「每次鼠标增量去 setPosition」，增量在跨屏 / DPI 切换时会漂移，
 * 窗口会越拖越快，最后整块跑到屏幕外，用户就「找不回来了」。
 * 现在改成：按下时记住光标相对窗口的抓取偏移，移动时直接用光标的绝对坐标定位，
 * 并把落点夹在最近的显示器工作区内，保证至少露出一部分可再次抓取。 */
let dragGrab = null;
const MIN_VISIBLE = 56; // 拖出边界时至少留这么多像素在屏内

function clampToWorkArea(x, y) {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const size = win && !win.isDestroyed() ? win.getBounds() : { width: WIN_W, height: WIN_H };
  const nx = Math.max(
    workArea.x - size.width + MIN_VISIBLE,
    Math.min(workArea.x + workArea.width - MIN_VISIBLE, x)
  );
  const ny = Math.max(
    workArea.y,
    Math.min(workArea.y + workArea.height - MIN_VISIBLE, y)
  );
  return [Math.round(nx), Math.round(ny)];
}

ipcMain.on('drag-begin', () => {
  if (!win) return;
  const [x, y] = win.getPosition();
  const c = screen.getCursorScreenPoint();
  dragGrab = { x: c.x - x, y: c.y - y };
});

ipcMain.on('drag-move', () => {
  if (!win || !dragGrab) return;
  const c = screen.getCursorScreenPoint();
  const [nx, ny] = clampToWorkArea(c.x - dragGrab.x, c.y - dragGrab.y);
  win.setPosition(nx, ny);
});

ipcMain.on('drag-end', () => {
  dragGrab = null;
});

ipcMain.on('move-to', (_e, x, y) => {
  if (!win) return;
  const [cx, cy] = win.getPosition();
  const [nx, ny] = clampToWorkArea(cx + x, cy + y);
  win.setPosition(nx, ny);
});

ipcMain.on('snap-corner', () => {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const b = win.getBounds();
  // 底边贴住工作区，别再多探 10px，否则脚底投影被任务栏压掉
  win.setPosition(
    workArea.x + workArea.width - b.width - 30,
    workArea.y + workArea.height - b.height
  );
});

// ---------- 菜单动作 ----------
ipcMain.on('toggle-top', () => {
  if (!win) return;
  topMost = !topMost;
  win.setAlwaysOnTop(topMost, topMost ? 'screen-saver' : 'normal');
  win.webContents.send('toast', topMost ? '已置顶' : '取消置顶');
});

ipcMain.on('open-hermes-dir', () => shell.openPath(HERMES_DIR));
ipcMain.on('open-chat', () => showChat());
ipcMain.on('set-status', (_e, status) => {
  const map = { idle: '待命', thinking: '思考中', working: '执行中', success: '完成', sleep: '安静中' };
  setPetState(status, map[status] || '待命');
});
ipcMain.on('hide-chat', () => chatWin && chatWin.hide());
ipcMain.on('close-chat', () => chatWin && chatWin.close());

ipcMain.handle('pet-state-get', () => petState);
ipcMain.handle('utterance-format', (_e, text) => prepareUtterance(text));
ipcMain.handle('hermes-snapshot-get', async () => {
  try { return await hermesBridge.snapshot(); } catch { return { online: false }; }
});
ipcMain.handle('session-history', async () => {
  try { return await hermesBridge.sessionHistory(); } catch { return { sessionId: '', entries: [] }; }
});
ipcMain.handle('session-chat', async (_e, text) => {
  const message = String(text || '').trim().slice(0, 4000);
  if (!message) return { ok: false, error: prepareUtterance('消息不能为空') };
  if (chatBusy) return { ok: false, error: prepareUtterance('我还在处理上一条消息') };
  trackUserEmotion(message);
  chatBusy = true;
  setPetState('thinking', '思考中');
  const sentAt = Date.now();
  try {
    const result = await hermesBridge.sessionChat(message, (delta) => {
      if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('chat-delta', delta);
    });
    if (!result.answer) throw new Error('Hermes 没有返回可显示的内容');
    recordSessionMessage(result.sessionId, 'user', message, sentAt);
    recordSessionMessage(result.sessionId, 'assistant', result.answer);
    adjustPetState(1, 1);
    setPetState('success', '回复完成');
    setTimeout(() => {
    if (!petState.hermesOnline || !petState.runningCount) setPetState(statusFromSnapshot(previousHermes || { online: false }).status);
    }, 1200);
    return { ok: true, answer: result.answer, sessionId: result.sessionId };
  } catch (error) {
    setPetState('error', '会话异常');
    return { ok: false, error: error?.message || 'Hermes 会话请求失败' };
  } finally {
    chatBusy = false;
  }
});
ipcMain.handle('task-create', async (_e, payload) => {
  try {
    const result = await hermesBridge.createTask(payload || {});
    const task = result?.task || {};
    announce(`{address}，任务「${task.title || payload?.title || '未命名'}」已经放进 Hermes`, { kind: 'success', userInitiated: true });
    return { ok: true, task: result };
  } catch (error) {
    return { ok: false, error: prepareUtterance(error?.message || '任务创建失败') };
  }
});
ipcMain.handle('task-upload', async (_e, taskId, filePath) => {
  try {
    return { ok: true, attachment: await hermesBridge.uploadAttachment(taskId, filePath) };
  } catch (error) {
    return { ok: false, error: prepareUtterance(error?.message || '附件上传失败') };
  }
});
ipcMain.handle('memory-get', async () => ({
  ...hermesBridge.memorySnapshot(),
  archive: petMemory.snapshot(path.join(dataDir(), 'memory'))
}));
ipcMain.handle('skills-get', () => hermesBridge.skillSnapshot());
ipcMain.on('pet-interact', (_e, zone) => {
  interactPet(zone);
});
ipcMain.handle('settings-get', () => publicSettings());
ipcMain.handle('settings-save', (_e, input) => {
  const saved = saveSettings(input || {});
  return { ...publicSettings(), hasApiKey: !!saved.apiKeyCipher };
});
// 设置面板拖动滑块时实时预览，不写盘
ipcMain.on('appearance-preview', (_e, input) => {
  applyAppearanceValues(input && input.petScale, input && input.petOpacity);
});
// 手动从 Hermes 导入密钥
ipcMain.handle('import-key', () => {
  const r = importKeyFromHermes();
  return { ...r, settings: publicSettings() };
});
ipcMain.handle('history-get', () => loadHistory());
ipcMain.handle('chat-send', async (_e, text) => {
  const message = String(text || '').trim().slice(0, 4000);
  if (!message) return { ok: false, error: prepareUtterance('消息不能为空') };
  if (chatBusy) return { ok: false, error: prepareUtterance('我还在处理上一条消息') };
  trackUserEmotion(message);
  chatBusy = true;
  appendHistory('user', message);
  adjustPetState(1, 1);
  setPetState('thinking');
  try {
    const answer = await askModel(message);
    appendHistory('assistant', answer);
    adjustPetState(1, 2);
    setPetState('success');
    setTimeout(() => setPetState('idle'), 1600);
    return { ok: true, answer: prepareUtterance(answer) };
  } catch (error) {
    setPetState('error', '连接异常');
    return { ok: false, error: prepareUtterance(error && error.message ? error.message : '模型请求失败') };
  } finally {
    chatBusy = false;
  }
});

// ---------- 开机自启 ----------
ipcMain.on('toggle-autostart', () => {
  if (!win) return;
  const on = app.getLoginItemSettings().openAtLogin;
  app.setLoginItemSettings({
    openAtLogin: !on,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()]
  });
  win.webContents.send('toast', !on ? '下次开机会自己出来' : '已取消开机自启');
});

ipcMain.on('quit', () => app.quit());

ipcMain.on('hide-pet', () => win && win.hide());

// ---------- 启动 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showPet());
  app.whenReady().then(() => {
    // 只读地把项目目录映射成 petasset://app/<相对路径>，供 Live2D 用 fetch 读取模型
    // 直接读磁盘、不走 net.fetch：走网络栈会命中 Chromium 缓存，替换素材后仍读到旧文件
    protocol.handle('petasset', async (request) => {
      const { pathname } = new URL(request.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
      const target = path.normalize(path.join(__dirname, rel));
      if (!target.startsWith(__dirname)) {
        return new Response('forbidden', { status: 403 });
      }
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.moc3': 'application/octet-stream'
      };
      try {
        const data = await fs.promises.readFile(target);
        return new Response(data, {
          headers: {
            'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
          }
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    });

    fs.mkdirSync(HERMES_DIR, { recursive: true });
    petState = loadPetState();
    // 首次启动若还没有密钥，直接从 Hermes 的 .env 里搬过来，省得手填
    if (!loadSettings().apiKeyCipher) {
      const imported = importKeyFromHermes();
      console.log('[hermes-pet] 自动导入密钥：', imported.ok ? '成功' : `跳过（${imported.reason}）`);
    }
    createWindow();
    createTray();
    startBridgeServer();
    startHermesPolling();
    globalShortcut.register('CommandOrControl+Shift+H', showChat);
    if (process.env.PET_LIVE2D_TEST === '1') createLive2dTestWindow();
  });
}

app.on('window-all-closed', (e) => {
  // 桌宠不退，留在托盘
  e.preventDefault && e.preventDefault();
});

app.on('activate', () => showPet());
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopBridgeServer();
  savePetState();
});
