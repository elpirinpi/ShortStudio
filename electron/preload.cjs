const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('shortStudioDesktop', {
  isDesktop: true,
  platform: process.platform,
  developer: 'Kelly Benjamin De La Cruz',
});
