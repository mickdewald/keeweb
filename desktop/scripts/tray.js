const electron = require('electron');
const path = require('path');

const { context } = require('./context');
const { emitRemoteEvent } = require('./remote-events');
const {
    coerceMainWindowPositionToConnectedDisplay,
    isMainWindowMaximized
} = require('./window-position');

const main = electron.app;

let appIcon = null;

function hasAppIcon() {
    return !!appIcon;
}

function minimizeApp(menuItemLabels) {
    const mainWindow = context.mainWindow;
    let imagePath;
    // a workaround to correctly restore focus on windows platform
    // without this workaround, focus is not restored to the previously focused field
    if (process.platform === 'win32') {
        mainWindow.minimize();
    }
    mainWindow.hide();
    if (process.platform === 'darwin') {
        main.dock.hide();
        imagePath = 'macOS-MenubarTemplate.png';
    } else {
        imagePath = 'icon.png';
    }
    mainWindow.setSkipTaskbar(true);
    if (!appIcon) {
        const image = electron.nativeImage.createFromPath(
            path.join(__dirname, '..', 'img', imagePath)
        );
        appIcon = new electron.Tray(image);
        if (process.platform !== 'darwin') {
            appIcon.on('click', restoreMainWindow);
        }
        const contextMenu = electron.Menu.buildFromTemplate([
            { label: menuItemLabels.restore, click: restoreMainWindow },
            { label: menuItemLabels.quit, click: closeMainWindow }
        ]);
        appIcon.setContextMenu(contextMenu);
        appIcon.setToolTip('KeeWeb');
    }
}

function minimizeThenHideIfInTray() {
    // This function is called when auto-type has displayed a selection list and a selection was made.
    // To ensure focus returns to the previous window we must minimize first even if we're going to hide.
    context.mainWindow.minimize();
    if (appIcon) context.mainWindow.hide();
}

function restoreMainWindow() {
    const mainWindow = context.mainWindow;
    if (process.platform === 'darwin' && !main.dock.isVisible()) {
        main.dock.show();
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.setSkipTaskbar(false);
    mainWindow.show();
    coerceMainWindowPositionToConnectedDisplay();
    setTimeout(destroyAppIcon, 0);
}

function showAndFocusMainWindow() {
    const mainWindow = context.mainWindow;
    if (appIcon) {
        restoreMainWindow();
    }
    if (isMainWindowMaximized()) {
        mainWindow.maximize();
    } else {
        mainWindow.show();
    }
    mainWindow.focus();
    if (process.platform === 'darwin' && !main.dock.isVisible()) {
        main.dock.show();
    }
}

function closeMainWindow() {
    emitRemoteEvent('launcher-exit-request');
    setTimeout(destroyAppIcon, 0);
}

function destroyAppIcon() {
    if (appIcon) {
        appIcon.destroy();
        appIcon = null;
    }
}

module.exports = {
    hasAppIcon,
    minimizeApp,
    minimizeThenHideIfInTray,
    restoreMainWindow,
    showAndFocusMainWindow,
    closeMainWindow
};
