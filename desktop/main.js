if (process.send && process.argv.includes('--native-module-host')) {
    require('./native-module-host').startInOwnProcess();
    return;
}

const {
    pushPerfTimestamp,
    logProgress,
    logStartupMessage,
    reportStartProfile
} = require('./scripts/startup-profile');

const electron = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');

remoteMain.initialize();
const url = require('url');

const { context } = require('./scripts/context');
const { emitRemoteEvent } = require('./scripts/remote-events');
const { locale, setLocale, getLocaleValues } = require('./scripts/locale');
const { Logger } = require('./scripts/logger');
const { isDev } = require('./scripts/util/app-info');
const {
    setUserDataPaths,
    setEnv,
    setDevAppIcon,
    hookRequestHeaders
} = require('./scripts/startup-env');
const {
    setConfigEncryptionKey,
    getAppMainRoot,
    getAppContentRoot,
    loadSettingsEncryptionKey,
    loadConfig,
    saveConfig
} = require('./scripts/config-store');
const {
    setMainWindowMaximized,
    delaySaveMainWindowPosition,
    updateMainWindowPositionIfPending,
    saveMainWindowPosition,
    restoreMainWindowPosition,
    coerceMainWindowPositionToConnectedDisplay
} = require('./scripts/window-position');
const {
    hasAppIcon,
    minimizeApp,
    minimizeThenHideIfInTray,
    restoreMainWindow,
    showAndFocusMainWindow
} = require('./scripts/tray');
const { setGlobalShortcuts, subscribePowerEvents } = require('./scripts/global-shortcuts');
const { setMenu, onContextMenu } = require('./scripts/app-menu');
const { httpRequest } = require('./scripts/http-request');

pushPerfTimestamp('loading app requires');

const main = electron.app;
const logger = new Logger('remote-app');

let ready = false;
let appReady = false;
let pendingUpdateFilePath;

const gotTheLock = main.requestSingleInstanceLock();
if (!gotTheLock) {
    main.quit();
}

logProgress('single instance lock');

setUserDataPaths();

let openFile = process.argv.filter((arg) => /\.kdbx$/i.test(arg))[0];

const htmlPath =
    (isDev && process.env.KEEWEB_HTML_PATH) ||
    url.format({ protocol: 'file', slashes: true, pathname: path.join(__dirname, 'index.html') });

const showDevToolsOnStart =
    process.argv.some((arg) => arg.startsWith('--devtools')) ||
    process.env.KEEWEB_OPEN_DEVTOOLS === '1';

const loginItemSettings = process.platform === 'darwin' ? main.getLoginItemSettings() : {};

const startMinimized =
    loginItemSettings.wasOpenedAsHidden ||
    process.argv.some((arg) => arg.startsWith('--minimized'));

const themeBgColors = {
    dark: '#1e1e1e',
    light: '#f6f6f6',
    db: '#342f2e',
    fb: '#282c34',
    wh: '#fafafa',
    te: '#222',
    hc: '#fafafa',
    sd: '#002b36',
    sl: '#fdf6e3'
};
const darkLightThemes = {
    dark: 'light',
    sd: 'sl',
    fb: 'bl',
    db: 'lb',
    te: 'lt',
    dc: 'hc'
};
const defaultBgColor = '#282C34';

logProgress('defining args');

setEnv();
setDevAppIcon(htmlPath);

let appSettings;

const settingsPromise = loadSettingsEncryptionKey().then((key) => {
    setConfigEncryptionKey(key);
    logProgress('loading settings key');

    return loadConfig('app-settings').then((settings) => {
        try {
            appSettings = settings ? JSON.parse(settings) : {};
        } catch (e) {
            logStartupMessage(`Error loading app settings: ${e}`);
        }
        logProgress('reading app settings');
    });
});

main.on('window-all-closed', () => {
    if (pendingUpdateFilePath) {
        exitAndStartUpdate();
    } else {
        if (process.platform !== 'darwin') {
            main.quit();
        }
    }
});
main.on('ready', () => {
    logProgress('app on ready');
    appReady = true;

    settingsPromise
        .then(() => {
            createMainWindow();
            setupIpcHandlers();
            setGlobalShortcuts(appSettings);
            subscribePowerEvents();
            hookRequestHeaders();

            loadLocale().then(() => {
                setMenu();
            });
        })
        .catch((e) => {
            electron.dialog.showErrorBox('KeeWeb', 'Error loading app: ' + e);
            main.exit(2);
        });
});
main.on('open-file', (e, path) => {
    e.preventDefault();
    openFile = path;
    notifyOpenFile();
});
main.on('activate', () => {
    if (process.platform === 'darwin') {
        if (appReady && !context.mainWindow && appSettings) {
            createMainWindow();
        } else if (hasAppIcon()) {
            restoreMainWindow();
        }
    }
});
main.on('before-quit', (e) => {
    if (main.hookBeforeQuitEvent && context.mainWindow) {
        e.preventDefault();
        emitRemoteEvent('launcher-before-quit');
    }
});
main.on('will-quit', () => {
    electron.globalShortcut.unregisterAll();
});
main.on('second-instance', () => {
    if (context.mainWindow) {
        restoreMainWindow();
    }
});
main.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler((e) => {
        logger.warn(`Prevented new window: ${e.url}`);
        emitRemoteEvent('log', `Prevented new window: ${e.url}`);
        return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
        if (!url.startsWith('https://beta.keeweb.info/') && !url.startsWith(htmlPath)) {
            e.preventDefault();
            logger.warn(`Prevented navigation: ${url}`);
        }
    });
});
main.restartAndUpdate = function (updateFilePath) {
    pendingUpdateFilePath = updateFilePath;
    context.mainWindow.close();
    setTimeout(() => {
        pendingUpdateFilePath = undefined;
    }, 1000);
};
main.minimizeApp = minimizeApp;
main.minimizeThenHideIfInTray = minimizeThenHideIfInTray;
main.getMainWindow = function () {
    return context.mainWindow;
};
main.setHookBeforeQuitEvent = (hooked) => {
    main.hookBeforeQuitEvent = !!hooked;
};
main.setGlobalShortcuts = setGlobalShortcuts;
main.showAndFocusMainWindow = showAndFocusMainWindow;
main.loadConfig = loadConfig;
main.saveConfig = saveConfig;
main.getAppMainRoot = getAppMainRoot;
main.getAppContentRoot = getAppContentRoot;
main.httpRequest = httpRequest;

function checkSettingsTheme(theme) {
    // old settings migration
    if (theme === 'macdark') {
        return 'dark';
    }
    if (theme === 'wh') {
        return 'light';
    }
    return theme;
}

function getDefaultTheme() {
    return 'dark';
}

function selectDarkOrLightTheme(theme) {
    const dark = electron.nativeTheme.shouldUseDarkColors;
    for (const [darkTheme, lightTheme] of Object.entries(darkLightThemes)) {
        if (darkTheme === theme || lightTheme === theme) {
            return dark ? darkTheme : lightTheme;
        }
    }
    return theme;
}

function createMainWindow() {
    let theme = checkSettingsTheme(appSettings.theme) || getDefaultTheme();
    if (appSettings.autoSwitchTheme) {
        theme = selectDarkOrLightTheme(theme);
    }
    const bgColor = themeBgColors[theme] || defaultBgColor;

    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    let titlebarStyle = appSettings.titlebarStyle;
    if (isMac && (!titlebarStyle || titlebarStyle === 'default')) {
        titlebarStyle = 'hidden-inset';
    }
    if (titlebarStyle === 'hidden-inset') {
        titlebarStyle = 'hiddenInset';
    }
    const frameless = isWindows && ['hidden', 'hiddenInset'].includes(titlebarStyle);

    const windowOptions = {
        show: false,
        width: 1000,
        height: 700,
        minWidth: 700,
        minHeight: 400,
        titleBarStyle: titlebarStyle,
        frame: !frameless,
        backgroundColor: isMac ? '#00000000' : bgColor,
        webPreferences: {
            contextIsolation: false,
            backgroundThrottling: false,
            nodeIntegration: true,
            nodeIntegrationInWorker: true,
            spellcheck: false,
            v8CacheOptions: 'none'
        }
    };
    if (process.platform !== 'win32') {
        windowOptions.icon = path.join(__dirname, 'img', 'icon.png');
    }
    if (isMac) {
        windowOptions.vibrancy = 'sidebar';
    }
    const mainWindow = new electron.BrowserWindow(windowOptions);
    context.mainWindow = mainWindow;
    remoteMain.enable(mainWindow.webContents);
    logProgress('creating main window');

    mainWindow.loadURL(htmlPath);
    mainWindow.once('ready-to-show', () => {
        logProgress('main window ready');
        if (startMinimized) {
            emitRemoteEvent('launcher-started-minimized');
        } else {
            mainWindow.show();
        }
        ready = true;
        notifyOpenFile();
        logProgress('main window shown');
        reportStartProfile();

        if (showDevToolsOnStart) {
            mainWindow.webContents.openDevTools({ mode: 'bottom' });
        }
    });
    mainWindow.webContents.on('context-menu', onContextMenu);
    mainWindow.on('resize', delaySaveMainWindowPosition);
    mainWindow.on('move', delaySaveMainWindowPosition);
    mainWindow.on('restore', coerceMainWindowPositionToConnectedDisplay);
    mainWindow.on('close', mainWindowClosing);
    mainWindow.on('closed', mainWindowClosed);
    mainWindow.on('focus', mainWindowFocus);
    mainWindow.on('blur', mainWindowBlur);
    mainWindow.on('closed', () => {
        context.mainWindow = null;
        saveMainWindowPosition();
    });
    mainWindow.on('minimize', () => {
        emitRemoteEvent('launcher-minimize');
    });
    mainWindow.on('maximize', () => {
        setMainWindowMaximized(true);
        emitRemoteEvent('launcher-maximize');
    });
    mainWindow.on('unmaximize', () => {
        setMainWindowMaximized(false);
        emitRemoteEvent('launcher-unmaximize');
    });
    mainWindow.on('leave-full-screen', () => {
        emitRemoteEvent('leave-full-screen');
    });
    mainWindow.on('enter-full-screen', () => {
        emitRemoteEvent('enter-full-screen');
    });
    mainWindow.on('session-end', () => {
        emitRemoteEvent('os-lock');
    });
    logProgress('configuring main window');

    restoreMainWindowPosition();
    logProgress('restoring main window position');
}

function mainWindowBlur() {
    emitRemoteEvent('main-window-blur');
}

function mainWindowFocus() {
    emitRemoteEvent('main-window-focus');
}

function mainWindowClosing() {
    updateMainWindowPositionIfPending();
}

function mainWindowClosed() {
    main.removeAllListeners('remote-app-event');
}

function notifyOpenFile() {
    if (ready && openFile && context.mainWindow) {
        const openKeyfile = process.argv
            .filter((arg) => arg.startsWith('--keyfile='))
            .map((arg) => arg.replace('--keyfile=', ''))[0];
        const fileInfo = JSON.stringify({ data: openFile, key: openKeyfile });
        context.mainWindow.webContents.executeJavaScript(
            'if (window.launcherOpen) { window.launcherOpen(' +
                fileInfo +
                '); } ' +
                ' else { window.launcherOpenedFile=' +
                fileInfo +
                '; }'
        );
        openFile = null;
    }
}

function loadLocale() {
    return loadConfig('locale').then((localeValues) => {
        if (localeValues) {
            try {
                localeValues = JSON.parse(localeValues);
                if (appSettings?.locale === localeValues?.locale) {
                    setLocale(localeValues);
                }
            } catch (e) {
                logStartupMessage(`Error loading locale: ${e}`);
            }
        }
        locale.on('changed', () => {
            setMenu();
            saveConfig('locale', JSON.stringify(getLocaleValues()));
        });
    });
}

function setupIpcHandlers() {
    const { setupIpcHandlers } = require('./scripts/ipc');
    setupIpcHandlers();
    logProgress('setting ipc handlers');
}

function exitAndStartUpdate() {
    if (pendingUpdateFilePath) {
        const { installUpdate } = require('./scripts/update-installer');
        installUpdate(pendingUpdateFilePath);
    }
}
