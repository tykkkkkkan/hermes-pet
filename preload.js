const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
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
  onAnnounce: (cb) => ipcRenderer.on('announce', (_e, text, options) => cb(text, options || {})),
  onState: (cb) => ipcRenderer.on('pet-state', (_e, state) => cb(state)),
  getState: () => ipcRenderer.invoke('pet-state-get'),
  getHermesSnapshot: () => ipcRenderer.invoke('hermes-snapshot-get'),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSettings: (input) => ipcRenderer.invoke('settings-save', input),
  getHistory: () => ipcRenderer.invoke('history-get'),
  sendChat: (text) => ipcRenderer.invoke('chat-send', text)
});
