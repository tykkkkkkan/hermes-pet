const { contextBridge, ipcRenderer } = require('electron');
const petRegions = require('./pet-regions.json');

contextBridge.exposeInMainWorld('pet', {
  regions: petRegions,
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  moveTo: (dx, dy) => ipcRenderer.send('move-to', dx, dy),
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
  getHistory: () => ipcRenderer.invoke('history-get'),
  sendChat: (text) => ipcRenderer.invoke('chat-send', text)
});
