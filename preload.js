const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const petRegions = require('./pet-regions.json');
const { hitRegion } = require('./pet-regions');
const statesRoot = path.join(__dirname, 'assets', 'states');
const legacyManifest = path.join(statesRoot, 'manifest.json');
const v2Manifest = path.join(statesRoot, 'v2', 'index.json');
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
};
const legacy = readJson(legacyManifest);
const v2File = (group, name) => `../assets/states/v2/aligned/${group}/${name}.png`;
const faceFiles = legacy.face || {
  idle: v2File('face', 'face-calm'),
  happy: v2File('face', 'face-laugh'),
  sleepy: v2File('face', 'face-yawn'),
  thinking: v2File('face', 'face-serious'),
  angry: v2File('face', 'face-angry'),
  cry: v2File('face', 'face-cry')
};
const faceSources = Object.fromEntries(Object.entries(faceFiles).map(([key, file]) => [
  key,
  String(file).startsWith('../') ? file : `../assets/states/${file}`
]));
const stateSources = {
  idle: v2File('state', 'state-idle'),
  working: v2File('state2', 'state2-working'),
  thinking: v2File('state2', 'state2-thinking'),
  success: v2File('state', 'state-success'),
  sleep: v2File('state', 'state-sleepy'),
  error: v2File('state', 'state-error')
};
const hasV2 = fs.existsSync(v2Manifest);

contextBridge.exposeInMainWorld('pet', {
  regions: petRegions,
  hitRegion: (x, y) => hitRegion(x, y, petRegions),
  faceSources,
  stateSources: hasV2 ? stateSources : {},
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  openMenu: () => ipcRenderer.send('open-menu'),
  closeMenu: () => ipcRenderer.send('close-menu'),
  menuAction: (act) => ipcRenderer.send('menu-action', act),
  openSettings: () => ipcRenderer.send('open-settings'),
  onMenuAction: (cb) => ipcRenderer.on('menu-action', (_e, act) => cb(act)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  moveTo: (dx, dy) => ipcRenderer.send('move-to', dx, dy),
  dragBegin: () => ipcRenderer.send('drag-begin'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  snapCorner: () => ipcRenderer.send('snap-corner'),
  toggleTop: () => ipcRenderer.send('toggle-top'),
  openHermesDir: () => ipcRenderer.send('open-hermes-dir'),
  openChat: () => ipcRenderer.send('open-chat'),
  setStatus: (status) => ipcRenderer.send('set-status', status),
  toggleAutostart: () => ipcRenderer.send('toggle-autostart'),
  hidePet: () => ipcRenderer.send('hide-pet'),
  hideChat: () => ipcRenderer.send('hide-chat'),
  closeChat: () => ipcRenderer.send('close-chat'),
  quit: () => ipcRenderer.send('quit'),
  onToast: (cb) => ipcRenderer.on('toast', (_e, text) => cb(text)),
  onState: (cb) => ipcRenderer.on('pet-state', (_e, state) => cb(state)),
  onAnnounce: (cb) => ipcRenderer.on('announce', (_e, text, options) => cb(text, options || {})),
  onChatDelta: (cb) => ipcRenderer.on('chat-delta', (_e, delta) => cb(String(delta || ''))),
  formatUtterance: (text) => ipcRenderer.invoke('utterance-format', text),
  getState: () => ipcRenderer.invoke('pet-state-get'),
  getHermesSnapshot: () => ipcRenderer.invoke('hermes-snapshot-get'),
  getSessionHistory: () => ipcRenderer.invoke('session-history'),
  sendHermesChat: (text) => ipcRenderer.invoke('session-chat', text),
  createTask: (payload) => ipcRenderer.invoke('task-create', payload),
  uploadTaskFile: (taskId, filePath) => ipcRenderer.invoke('task-upload', taskId, filePath),
  getMemory: () => ipcRenderer.invoke('memory-get'),
  getSkills: () => ipcRenderer.invoke('skills-get'),
  interact: (zone) => ipcRenderer.send('pet-interact', zone),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSettings: (input) => ipcRenderer.invoke('settings-save', input),
  previewAppearance: (input) => ipcRenderer.send('appearance-preview', input),
  importKey: () => ipcRenderer.invoke('import-key'),
  onAppearance: (cb) => ipcRenderer.on('appearance', (_e, v) => cb(v)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, v) => cb(v)),
  getHistory: () => ipcRenderer.invoke('history-get'),
  sendChat: (text) => ipcRenderer.invoke('chat-send', text)
});
