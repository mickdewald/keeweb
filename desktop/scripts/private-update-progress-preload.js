const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updateProgress', {
    subscribe(callback) {
        ipcRenderer.on('private-update-progress', (_event, value) => callback(value));
        ipcRenderer.send('private-update-progress-ready');
    },
    hide: () => ipcRenderer.send('private-update-progress-action', 'hide'),
    cancel: () => ipcRenderer.send('private-update-progress-action', 'cancel')
});
