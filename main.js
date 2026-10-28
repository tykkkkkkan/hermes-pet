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

const WIN_W = 224;
const WIN_H = 372;
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
  apiKeyCipher: ''
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
  text = prepareUtterance(text);
  if (win && !win.isDestroyed()) win.webContents.send('announce', text, options);
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

function prepareUtterance(text) {
  const pool = Array.isArray(persona?.address?.pool) ? persona.address.pool : [];
  const history = Array.isArray(petState.addressHistory) ? petState.addressHistory : [];
  const previous = petState.address || '大哥';
  const address = petEmotion.chooseAddress(petState.emotion, previous, pool, history);
  if (address !== previous) {
    petState.address = address;
    petState.addressHistory = [...history, address].slice(-2);
  }
  let result = String(text || '').replaceAll('{address}', petState.address || '大哥');
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

function interactionLine(zone, mood) {
  const region = persona.touchReactions?.[zone] || persona.touchReactions?.body;
  const moodKey = mood >= 45 ? 'good' : 'bad';
  return String(region?.[moodKey] || '{address}，有事直说，别只戳我');
}

function bridgeFile() {
  return path.join(HERMES_DIR, 'hermes-pet-bridge.json');
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
  const line = interactionLine(String(zone || 'body'), petState.mood);
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

function saveSettings(input = {}) {
  const current = loadSettings();
  const next = {
    ...current,
    userName: String(input.userName || current.userName).trim().slice(0, 40) || DEFAULT_SETTINGS.userName,
    petName: String(input.petName || current.petName).trim().slice(0, 40) || DEFAULT_SETTINGS.petName,
    persona: String(input.persona || current.persona).trim().slice(0, 1200) || DEFAULT_SETTINGS.persona,
    apiBase: String(input.apiBase || current.apiBase).trim().replace(/\/+$/, '') || DEFAULT_SETTINGS.apiBase,
    model: String(input.model || current.model).trim().slice(0, 100) || DEFAULT_SETTINGS.model
  };
  if (input.apiKey && String(input.apiKey).trim()) {
    if (safeStorage.isEncryptionAvailable()) {
      next.apiKeyCipher = safeStorage.encryptString(String(input.apiKey).trim()).toString('base64');
    }
  } else if (input.clearApiKey) {
    next.apiKeyCipher = '';
  }
  writeJson(settingsFile(), next);
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
    hasApiKey: !!s.apiKeyCipher
  };
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

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: workArea.x + workArea.width - WIN_W - 30,
    y: workArea.y + workArea.height - WIN_H + 10,
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
  win.once('ready-to-show', () => win.show());
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    const message = first && typeof first === 'object' && 'message' in first ? first.message : args[2];
    if (typeof message === 'string' && message.startsWith('[pet-live2d]')) console.log(message);
  });
  win.on('move', () => {
    if (!win.isDestroyed()) {
      const [x, y] = win.getPosition();
      writeJson(path.join(dataDir(), 'position.json'), { x, y });
    }
  });

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

// ---------- 鼠标穿透：只有落在小人身上才接管点击 ----------
ipcMain.on('set-ignore', (_e, ignore) => {
  if (!win) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
});

// ---------- 拖拽 ----------
ipcMain.on('move-to', (_e, x, y) => {
  if (!win) return;
  const [cx, cy] = win.getPosition();
  win.setPosition(Math.round(cx + x), Math.round(cy + y));
});

ipcMain.on('snap-corner', () => {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  win.setPosition(
    workArea.x + workArea.width - WIN_W - 30,
    workArea.y + workArea.height - WIN_H + 10
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
    const result = await hermesBridge.sessionChat(message);
    if (!result.answer) throw new Error('Hermes 没有返回可显示的内容');
    recordSessionMessage(result.sessionId, 'user', message, sentAt);
    recordSessionMessage(result.sessionId, 'assistant', result.answer);
    adjustPetState(1, 1);
    setPetState('success', '回复完成');
    setTimeout(() => {
    if (!petState.hermesOnline || !petState.runningCount) setPetState(statusFromSnapshot(previousHermes || { online: false }).status);
    }, 1200);
    return { ok: true, answer: prepareUtterance(result.answer), sessionId: result.sessionId };
  } catch (error) {
    setPetState('error', '会话异常');
    return { ok: false, error: prepareUtterance(error?.message || 'Hermes 会话请求失败') };
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
