const electron = require('electron');
const fs = require('fs');
const path = require('path');

const { logProgress, logStartupMessage } = require('./startup-profile');
const { isDev } = require('./util/app-info');

const main = electron.app;

const portableConfigFileName = 'keeweb-portable.json';

let usingPortableUserDataDir = false;
let execPath;

function isUsingPortableUserDataDir() {
    return usingPortableUserDataDir;
}

function setUserDataPaths() {
    execPath = process.execPath;

    let isPortable = false;

    switch (process.platform) {
        case 'darwin':
            isPortable = !execPath.includes('/Applications/');
            if (isPortable) {
                execPath = execPath.substring(0, execPath.indexOf('.app'));
            }
            break;
        case 'win32':
            isPortable = !execPath.includes('Program Files');
            break;
        case 'linux':
            isPortable = !execPath.startsWith('/usr/') && !execPath.startsWith('/opt/');
            break;
    }

    if (isDev && process.env.KEEWEB_IS_PORTABLE) {
        try {
            isPortable = !!JSON.parse(process.env.KEEWEB_IS_PORTABLE);
        } catch {}
    }

    logProgress('portable check');

    if (isPortable) {
        const portableConfigDir = path.dirname(execPath);
        const portableConfigPath = path.join(portableConfigDir, portableConfigFileName);

        if (fs.existsSync(portableConfigPath)) {
            try {
                const portableConfig = JSON.parse(fs.readFileSync(portableConfigPath, 'utf8'));
                const portableUserDataDir = path.resolve(
                    portableConfigDir,
                    portableConfig.userDataDir
                );

                if (!fs.existsSync(portableUserDataDir)) {
                    fs.mkdirSync(portableUserDataDir, { recursive: true });
                }

                main.setPath('userData', portableUserDataDir);
                usingPortableUserDataDir = true;
            } catch (e) {
                logStartupMessage(`Error loading portable config: ${e}`);
            }
        }
    }

    logProgress('userdata dir');
}

function setEnv() {
    if (
        process.platform === 'linux' &&
        ['Pantheon', 'Unity:Unity7'].indexOf(process.env.XDG_CURRENT_DESKTOP) !== -1
    ) {
        // https://github.com/electron/electron/issues/9046
        process.env.XDG_CURRENT_DESKTOP = 'Unity';
    }

    main.commandLine.appendSwitch('disable-background-timer-throttling');

    // disable all caching, since we're not using old profile data anyway
    main.commandLine.appendSwitch('disable-http-cache');
    main.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

    if (process.platform === 'linux') {
        // fixes colors on Linux, see #1621
        main.commandLine.appendSwitch('force-color-profile', 'srgb');
    }

    main.allowRendererProcessReuse = true;

    logProgress('setting env');
}

function setDevAppIcon(htmlPath) {
    if (isDev && htmlPath && process.platform === 'darwin') {
        const icon = electron.nativeImage.createFromPath(
            path.join(__dirname, '../../graphics/512x512.png')
        );
        main.dock.setIcon(icon);
    }
}

// When sending a PUT XMLHttpRequest Chromium includes the header "Origin: file://".
// This confuses some WebDAV clients, notably OwnCloud.
// The header is invalid, so removing it everywhere it occurs should do no harm.

function hookRequestHeaders() {
    electron.session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (
            !details.url.startsWith('ws:') &&
            !details.url.startsWith('https://plugins.keeweb.info/')
        ) {
            delete details.requestHeaders.Origin;
        }
        callback({ requestHeaders: details.requestHeaders });
    });
    logProgress('setting request handlers');
}

module.exports = {
    isUsingPortableUserDataDir,
    setUserDataPaths,
    setEnv,
    setDevAppIcon,
    hookRequestHeaders
};
