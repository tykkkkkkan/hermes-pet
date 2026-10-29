const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, globalShortcut, safeStorage, Notification, protocol, net, dialog } = require('electron');
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
const createSettingsStore = require('./settings-store');
const createPetSpeech = require('./pet-speech');
const createPetState = require('./pet-state');
const createBridgeServer = require('./bridge-server');
const createHermesPoller = require('./hermes-poller');
const WIN_W = 340;
const WIN_H = 500;
const HERMES_DIR = path.join(process.env.LOCALAPPDATA || '', 'hermes');
const logger = require('./logger')({ logDir: path.join(HERMES_DIR, 'logs') });
const isFrameworkNoise = (args) => {
  const first = String(args[0] || '');
  return first.startsWith('(electron)') || first.startsWith('(node)');
};
console.log = (...args) => { if (!isFrameworkNoise(args)) logger.info(...args); };
console.error = (...args) => { if (!isFrameworkNoise(args)) logger.error(...args); };
console.warn = (...args) => { if (!isFrameworkNoise(args)) logger.warn(...args); };
const PERSONA_FILE = path.join(__dirname, 'persona.json');
let win = null;
let tray = null;
let chatWin = null;
let topMost = true;
let chatBusy = false;
let petState = null;
let rendererCrashCount = 0;
let rendererStableTimer = null;
const settingsStore = createSettingsStore({
  dataDir: () => app.getPath('userData'),
  safeStorage,
  hermesDir: HERMES_DIR,
  logger,
  onSave: () => applyAppearance()
});
const { readJson, writeJson } = settingsStore;
const dataDir = settingsStore.dataDir;
const settingsFile = settingsStore.settingsFile;
const historyFile = settingsStore.historyFile;
const stateFile = settingsStore.stateFile;
const loadSettings = settingsStore.load;
const saveSettings = settingsStore.save;
const getApiKey = settingsStore.getApiKey;
const importKeyFromHermes = settingsStore.importFromHermes;
const publicSettings = settingsStore.publicView;
const persona = readJson(PERSONA_FILE, {});
const pickTouchLine = createTouchPicker(persona);
const speech = createPetSpeech();
const petStateStore = createPetState({
  emotion: petEmotion,
  settingsStore,
  onChange: (next) => { petState = next; }
});
petState = petStateStore.get();
const applyEmotionEvent = petStateStore.applyEmotion;
const refreshEmotionClock = petStateStore.decay;
const trackUserEmotion = petStateStore.trackUserText;
const loadPetState = petStateStore.load;
const savePetState = petStateStore.save;
const adjustPetState = (...args) => (petStateStore.adjust(...args), pushPetState());

const taskTitle = petStateStore.taskTitle;

process.on('uncaughtException', (error) => {
  logger.error('[main] uncaughtException', error);
  try { dialog.showErrorBox('赫尔墨兹遇到问题', `${error?.message || error}\n\n日志：${logger.dir}`); } catch {}
});
process.on('unhandledRejection', (reason) => {
  logger.error('[main] unhandledRejection', reason instanceof Error ? reason : String(reason));
});

function announce(text, options = {}) {
  if (!text) return;
  if (!petRuntime.shouldAnnounce({
    taskResult: options.taskResult === true,
    userInitiated: options.userInitiated === true
  })) return;
  text = formatUtterance(text, { keepAddress: options.kind === 'interaction' });
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

function formatUtterance(text, options = {}) {
  const pool = Array.isArray(persona?.address?.pool) ? persona.address.pool : [];
  const history = Array.isArray(petState.addressHistory) ? petState.addressHistory : [];
  const previous = petState.address || '好大爹';
  let address = previous;
  const result = speech.prepareUtterance(text, {
    address: previous,
    pool,
    history,
    keepAddress: options.keepAddress,
    chooseAddress: (current, available, recent) => {
      address = petEmotion.chooseAddress(petState.emotion, current, available, recent);
      return address;
    }
  });
  if (address !== previous) {
    petState.address = address;
    petState.addressHistory = [...history, address].slice(-2);
  }
  return result;
}

function interactPet(zone) {
  const line = pickTouchLine(String(zone || 'body'), petState.emotion, petState.mood);
  applyEmotionEvent('touched');
  petStateStore.set({
    lastInteraction: Date.now(),
    mood: Math.min(100, petState.mood + 1),
    affection: Math.min(100, petState.affection + 1)
  });
  savePetState();
  pushPetState();
  announce(line, { kind: 'interaction', userInitiated: true });
}

const bridgeService = createBridgeServer({
  bridgeFile: () => process.env.PET_BRIDGE_FILE || path.join(HERMES_DIR, 'hermes-pet-bridge.json'),
  writeJson,
  getState: () => petState,
  getVisibility: () => ({
    visible: !!(win && !win.isDestroyed() && win.isVisible()),
    chatVisible: !!(chatWin && !chatWin.isDestroyed() && chatWin.isVisible())
  }),
  appVersion: () => app.getVersion(),
  appPath: __dirname,
  logger,
  announce,
  setStatus: setPetState,
  interact: interactPet,
  showChat,
  showPet,
  hidePet: () => { if (win && !win.isDestroyed()) win.hide(); }
});
const bridgeState = bridgeService.bridgeState;
const startBridgeServer = bridgeService.start;
const stopBridgeServer = bridgeService.stop;
const hermesPoller = createHermesPoller({
  bridge: hermesBridge,
  state: petStateStore,
  announce,
  pushState: pushPetState,
  taskTitle
});
const statusFromSnapshot = hermesPoller.statusFromSnapshot;
const startHermesPolling = hermesPoller.start;

function recordSessionMessage(sessionId, role, content, at = Date.now()) {
  return petMemory.record(path.join(dataDir(), 'memory'), sessionId, role, content, at);
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

function pushPetState() {
  if (win && !win.isDestroyed()) win.webContents.send('pet-state', petState);
  if (chatWin && !chatWin.isDestroyed()) chatWin.webContents.send('pet-state', petState);
}

function setPetState(status, statusText) {
  const nextStatus = status || 'idle';
  petStateStore.set({
    status: nextStatus,
    statusText: statusText || ({ idle: '待命', thinking: '思考中', working: '执行中', success: '完成', error: '遇到问题', sleep: '安静中' }[nextStatus] || '待命')
  });
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
  console.log('[pet] 模型请求:', base, '| apiKey length:', apiKey.length);
  let response;
  try {
    response = await net.fetch(`${base}/chat/completions`, {
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
  } catch (error) {
    console.error('[pet] 模型请求失败:', error.message, '| cause:', error.cause?.code || error.cause?.message || error.cause);
    throw error;
  }
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
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[main] 渲染进程退出', { reason: details?.reason, exitCode: details?.exitCode });
    if (++rendererCrashCount <= 3) {
      setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 800);
    } else {
      logger.error('[main] 渲染进程连续崩溃超过 3 次，停止自动重载');
    }
  });
  win.webContents.on('did-finish-load', () => {
    clearTimeout(rendererStableTimer);
    rendererStableTimer = setTimeout(() => { rendererCrashCount = 0; }, 30000);
  });
  win.on('move', () => {
    if (!win.isDestroyed()) {
      const [x, y] = win.getPosition();
      writeJson(path.join(dataDir(), 'position.json'), { x, y });
    }
  });
  if (process.env.PET_DEV_SELFCHECK || process.env.PET_APPEARANCE_TEST || process.env.PET_SETTINGS_TEST || process.env.PET_MENU_TEST || process.env.PET_TTS_PROBE || process.env.PET_HOVER_TEST || process.env.PET_DRAG_TEST || process.env.PET_SHOT || process.env.PET_LIVE2D_TEST === '1') require('./tools/dev-selfcheck')({ win, petState, showChat, openMenuWindow, getChatWin: () => chatWin, getMenuWin: () => menuWin, BrowserWindow, root: __dirname });
  win.on('closed', () => { win = null; });
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
  chatWin.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[main] 聊天窗渲染进程退出', { reason: details?.reason, exitCode: details?.exitCode });
    if (chatWin && !chatWin.isDestroyed()) chatWin.close();
  });
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
    { label: '打开日志目录', click: () => shell.openPath(logger.dir) },
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
  menuWin.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[main] 菜单窗渲染进程退出', { reason: details?.reason, exitCode: details?.exitCode });
    if (menuWin && !menuWin.isDestroyed()) menuWin.close();
  });
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
ipcMain.on('renderer-log', (_e, level, args) => {
  const write = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.info;
  write('[renderer]', ...(Array.isArray(args) ? args : [args]));
});
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
ipcMain.handle('utterance-format', (_e, text) => formatUtterance(text));
ipcMain.handle('hermes-snapshot-get', async () => {
  try { return await hermesBridge.snapshot(); } catch { return { online: false }; }
});
ipcMain.handle('session-history', async () => {
  try { return await hermesBridge.sessionHistory(); } catch { return { sessionId: '', entries: [] }; }
});
ipcMain.handle('session-chat', async (_e, text) => {
  const message = String(text || '').trim().slice(0, 4000);
  if (!message) return { ok: false, error: formatUtterance('消息不能为空') };
  if (chatBusy) return { ok: false, error: formatUtterance('我还在处理上一条消息') };
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
    if (!petState.hermesOnline || !petState.runningCount) setPetState(statusFromSnapshot(hermesPoller.getPrevious() || { online: false }).status);
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
    return { ok: false, error: formatUtterance(error?.message || '任务创建失败') };
  }
});
ipcMain.handle('task-upload', async (_e, taskId, filePath) => {
  try {
    return { ok: true, attachment: await hermesBridge.uploadAttachment(taskId, filePath) };
  } catch (error) {
    return { ok: false, error: formatUtterance(error?.message || '附件上传失败') };
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
  if (!message) return { ok: false, error: formatUtterance('消息不能为空') };
  if (chatBusy) return { ok: false, error: formatUtterance('我还在处理上一条消息') };
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
    return { ok: true, answer: formatUtterance(answer) };
  } catch (error) {
    setPetState('error', '连接异常');
    return { ok: false, error: formatUtterance(error && error.message ? error.message : '模型请求失败') };
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
      const base = path.resolve(__dirname);
      const target = path.resolve(base, rel);
      const relative = path.relative(base, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
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
    if (process.env.PET_DEV_CRASH_TEST === '1') {
      setTimeout(() => { throw new Error('PET_DEV_CRASH_TEST'); }, 3000);
    }
    if (process.env.PET_DEV_RENDER_CRASH_BURST === '1') {
      let crashCount = 0;
      const crashTimer = setInterval(() => {
        if (++crashCount > 4) return clearInterval(crashTimer);
        if (win && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
      }, 1200);
    }
    if (process.env.PET_DISABLE_POLL !== '1') startHermesPolling();
    globalShortcut.register('CommandOrControl+Shift+H', showChat);
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
