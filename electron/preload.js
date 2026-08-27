const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
});
