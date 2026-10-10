const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paydropDesktop', {
  openDashboard: () => ipcRenderer.send('widget:open-dashboard'),
  showWidget: () => ipcRenderer.send('dashboard:show-widget'),
  revealWidget: () => ipcRenderer.send('pet:reveal-widget'),
  showPet: () => ipcRenderer.send('pet:show'),
  hidePet: () => ipcRenderer.send('pet:hide'),
  petActivity: activity => ipcRenderer.send('pet:activity', activity),
  petDrag: phase => ipcRenderer.send('pet:drag', phase),
  petPassthrough: value => ipcRenderer.send('pet:passthrough', value),
  onPetDirection: callback => {
    const listener = (_event, direction) => callback(direction);
    ipcRenderer.on('pet:direction', listener);
    return () => ipcRenderer.removeListener('pet:direction', listener);
  },
  minimize: () => ipcRenderer.send('widget:minimize'),
  close: () => ipcRenderer.send('widget:close'),
  readData: () => ipcRenderer.invoke('data:read'),
  readRestoreBackup: () => ipcRenderer.invoke('data:restore-backup'),
  updateData: operation => ipcRenderer.invoke('data:update', operation),
  onDataChanged: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('data:changed', listener);
    return () => ipcRenderer.removeListener('data:changed', listener);
  },
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openUpdateLog: () => ipcRenderer.invoke('update:open-log'),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
