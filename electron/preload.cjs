const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortStudioDesktop', {
  isDesktop: true,
  platform: process.platform,
  developer: 'Kelly Benjamin De La Cruz',
  version: process.env.SHORTSTUDIO_APP_VERSION || '1.0.0',
  repo: process.env.SHORTSTUDIO_UPDATE_REPO || 'elpirinpi/ShortStudio',
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openReleasePage: () => ipcRenderer.invoke('updates:open-release'),
  onUpdateState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('updates:state', handler);
    return () => {
      ipcRenderer.removeListener('updates:state', handler);
    };
  },
});
