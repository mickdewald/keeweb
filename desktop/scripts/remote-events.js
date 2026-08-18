const electron = require('electron');

const { context } = require('./context');

const main = electron.app;

function emitRemoteEvent(e, arg) {
    if (context.mainWindow && context.mainWindow.webContents) {
        main.emit('remote-app-event', {
            name: e,
            data: arg
        });
    }
}

module.exports = { emitRemoteEvent };
