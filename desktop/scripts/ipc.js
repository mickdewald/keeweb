module.exports.setupIpcHandlers = () => {
    const { app, clipboard, ipcMain } = require('electron');
    const { context } = require('./context');
    const { setupClipboardIpc } = require('./ipc-handlers/clipboard');

    setupClipboardIpc({ app, clipboard, ipcMain, context });
    require('./ipc-handlers/browser-extension-connector');
    require('./ipc-handlers/hardware-crypto');
    require('./ipc-handlers/native-module-host-proxy');
    require('./ipc-handlers/spawn-process');
    require('./ipc-handlers/set-locale');
};
