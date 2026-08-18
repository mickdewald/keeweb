const electron = require('electron');
const fs = require('fs');
const path = require('path');

const { context } = require('./context');
const { logStartupMessage } = require('./startup-profile');

const main = electron.app;

const windowPositionFileName = 'window-position.json';

let mainWindowPosition = {};
let updateMainWindowPositionTimeout = null;
let mainWindowMaximized = false;

function isMainWindowMaximized() {
    return mainWindowMaximized;
}

function setMainWindowMaximized(maximized) {
    mainWindowMaximized = maximized;
}

function delaySaveMainWindowPosition() {
    if (updateMainWindowPositionTimeout) {
        clearTimeout(updateMainWindowPositionTimeout);
    }
    updateMainWindowPositionTimeout = setTimeout(updateMainWindowPosition, 500);
}

function updateMainWindowPositionIfPending() {
    if (updateMainWindowPositionTimeout) {
        clearTimeout(updateMainWindowPositionTimeout);
        updateMainWindowPosition();
    }
}

function updateMainWindowPosition() {
    const mainWindow = context.mainWindow;
    if (!mainWindow) {
        return;
    }
    updateMainWindowPositionTimeout = null;
    const bounds = mainWindow.getBounds();
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
        mainWindowPosition.x = bounds.x;
        mainWindowPosition.y = bounds.y;
        mainWindowPosition.width = bounds.width;
        mainWindowPosition.height = bounds.height;
    }
    mainWindowPosition.maximized = mainWindow.isMaximized();
    mainWindowPosition.fullScreen = mainWindow.isFullScreen();
    mainWindowPosition.changed = true;
}

function saveMainWindowPosition() {
    if (!mainWindowPosition.changed) {
        return;
    }
    delete mainWindowPosition.changed;
    try {
        fs.writeFileSync(
            path.join(main.getPath('userData'), windowPositionFileName),
            JSON.stringify(mainWindowPosition),
            'utf8'
        );
    } catch (e) {}
}

function restoreMainWindowPosition() {
    const fileName = path.join(main.getPath('userData'), windowPositionFileName);
    fs.readFile(fileName, 'utf8', (e, data) => {
        if (data) {
            try {
                mainWindowPosition = JSON.parse(data);
            } catch (e) {
                logStartupMessage(`Error loading main window position: ${e}`);
            }
            const mainWindow = context.mainWindow;
            if (mainWindow && mainWindowPosition) {
                if (mainWindowPosition.width && mainWindowPosition.height) {
                    mainWindow.setBounds(mainWindowPosition);
                    coerceMainWindowPositionToConnectedDisplay();
                }
                if (mainWindowPosition.maximized) {
                    mainWindow.maximize();
                    mainWindowMaximized = true;
                }
                if (mainWindowPosition.fullScreen) {
                    mainWindow.setFullScreen(true);
                }
            }
        }
    });
}

// If a display is disconnected while KeeWeb is minimized, Electron does not
// ensure that the restored window appears on a display that is still connected.
// This checks to be sure the title bar is somewhere the user can grab it,
// without making it impossible to minimize and restore a window keeping it
// partially off-screen or straddling two displays if the user desires that.

function coerceMainWindowPositionToConnectedDisplay() {
    const mainWindow = context.mainWindow;
    const eScreen = electron.screen;
    const displays = eScreen.getAllDisplays();
    if (!displays || !displays.length) return;
    const windowBounds = mainWindow.getBounds();
    const contentBounds = mainWindow.getContentBounds();
    const tbLeft = windowBounds.x;
    const tbRight = windowBounds.x + windowBounds.width;
    const tbTop = windowBounds.y;
    const tbBottom = contentBounds.y;
    // 160px width and 2/3s the title bar height should be enough that the user can grab it
    for (let i = 0; i < displays.length; ++i) {
        const workArea = displays[i].workArea;
        const overlapWidth =
            Math.min(tbRight, workArea.x + workArea.width) - Math.max(tbLeft, workArea.x);
        const overlapHeight =
            Math.min(tbBottom, workArea.y + workArea.height) - Math.max(tbTop, workArea.y);
        if (overlapWidth >= 160 && 3 * overlapHeight >= 2 * (tbBottom - tbTop)) return;
    }
    // If we get here, no display contains a big enough strip of the title bar
    // that we can be confident the user can drag it into visibility.  Rather than
    // attempt to guess what the user wants, just center it on the primary display.
    // Try to keep the previous height and width, but clamp each to 90% of the workarea.
    const workArea = eScreen.getPrimaryDisplay().workArea;
    const newWidth = Math.min(windowBounds.width, Math.floor(0.9 * workArea.width));
    const newHeight = Math.min(windowBounds.height, Math.floor(0.9 * workArea.height));
    mainWindow.setBounds({
        'x': workArea.x + Math.floor((workArea.width - newWidth) / 2),
        'y': workArea.y + Math.floor((workArea.height - newHeight) / 2),
        'width': newWidth,
        'height': newHeight
    });
    updateMainWindowPosition();
}

module.exports = {
    isMainWindowMaximized,
    setMainWindowMaximized,
    delaySaveMainWindowPosition,
    updateMainWindowPositionIfPending,
    updateMainWindowPosition,
    saveMainWindowPosition,
    restoreMainWindowPosition,
    coerceMainWindowPositionToConnectedDisplay
};
