const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paydropDesktop', {
  openDashboard: () => ipcRenderer.send('widget:open-dashboard'),
  showWidget: () => ipcRenderer.send('dashboard:show-widget'),
  minimize: () => ipcRenderer.send('widget:minimize'),
  close: () => ipcRenderer.send('widget:close'),
  readSettings: () => ipcRenderer.sendSync('settings:read'),
  writeSettings: (settings) => ipcRenderer.sendSync('settings:write', settings),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  onSettingsChanged: (callback) => {
    ipcRenderer.on('widget:refresh-settings', callback);
  },
});
