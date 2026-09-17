const { app, autoUpdater, dialog, net } = require('electron');
const { PrivateUpdaterController } = require('./private-updater-controller');
const { fetchRelease } = require('./private-update-feed');
const { loadConfig, saveConfig } = require('./config-store');
const { logStartupMessage } = require('./startup-profile');

let updater;

async function startPrivateUpdater() {
    if (process.platform !== 'darwin' || process.arch !== 'arm64' || !app.isPackaged) {
        return;
    }
    const buildInfo = require('../private-update-build.json');
    if (!/^\d{14}$/.test(buildInfo.build)) {
        return;
    }
    let settings = {};
    const stored = await loadConfig('private-updater');
    if (stored) {
        try {
            settings = { automatic: JSON.parse(stored)?.automatic !== false };
        } catch {
            settings = { automatic: false };
            logStartupMessage('Invalid updater preferences; automatic checks disabled');
        }
    }
    updater = new PrivateUpdaterController({
        app,
        autoUpdater,
        dialog,
        fetchRelease: (build) => fetchRelease(net, build),
        settings,
        saveSettings: (value) => saveConfig('private-updater', JSON.stringify(value)),
        build: buildInfo.build,
        log: logStartupMessage
    });
    updater.start();
}

function updateMenuItems() {
    if (!updater) {
        return [];
    }
    return [
        { label: 'Nach Updates suchen …', click: () => updater.check() },
        {
            label: 'Automatisch nach Updates suchen',
            type: 'checkbox',
            checked: updater.settings.automatic !== false,
            click: (item) =>
                updater.setAutomatic(item.checked).catch((error) => {
                    item.checked = updater.settings.automatic !== false;
                    updater.manual = true;
                    updater.fail(error);
                })
        }
    ];
}

function finishPrivateUpdate(event) {
    updater?.finishInstall(event);
}
function cancelPrivateUpdate() {
    updater?.cancelInstall();
}

function isPrivateUpdateRequested() {
    return updater?.installRequested === true;
}

module.exports = {
    startPrivateUpdater,
    updateMenuItems,
    finishPrivateUpdate,
    cancelPrivateUpdate,
    isPrivateUpdateRequested
};
