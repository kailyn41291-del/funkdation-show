'use strict';
// 控制台可使用的桌面功能（選擇輸出螢幕、打開資料夾）
const { contextBridge, ipcRenderer } = require('electron');

const dataArg = process.argv.find(a => a.startsWith('--fd-data='));

contextBridge.exposeInMainWorld('funk', {
  dataDir: dataArg ? dataArg.slice('--fd-data='.length) : '',
  displays: () => ipcRenderer.invoke('fd:displays'),
  openOutput: (id, fullscreen) => ipcRenderer.invoke('fd:openOutput', id, fullscreen),
  closeOutput: () => ipcRenderer.invoke('fd:closeOutput'),
  openDataFolder: () => ipcRenderer.invoke('fd:openDataFolder'),
  version: () => ipcRenderer.invoke('fd:version'),
  checkUpdate: () => ipcRenderer.invoke('fd:checkUpdate'),
  onUpdate: cb => ipcRenderer.on('fd:update', (e, msg) => cb(msg))
});
