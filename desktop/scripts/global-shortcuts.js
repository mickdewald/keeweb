const electron = require('electron');

const { emitRemoteEvent } = require('./remote-events');
const { logProgress } = require('./startup-profile');
const { restoreMainWindow } = require('./tray');

function setGlobalShortcuts(appSettings) {
    const defaultShortcutModifiers = process.platform === 'darwin' ? 'Ctrl+Alt+' : 'Shift+Alt+';
    const defaultShortcuts = {
        AutoType: { shortcut: defaultShortcutModifiers + 'T', event: 'auto-type' },
        CopyPassword: { shortcut: defaultShortcutModifiers + 'C', event: 'copy-password' },
        CopyUser: { shortcut: defaultShortcutModifiers + 'B', event: 'copy-user' },
        CopyUrl: { shortcut: defaultShortcutModifiers + 'U', event: 'copy-url' },
        CopyOtp: { event: 'copy-otp' },
        RestoreApp: { action: restoreMainWindow }
    };
    electron.globalShortcut.unregisterAll();
    for (const [key, shortcutDef] of Object.entries(defaultShortcuts)) {
        const fromSettings = appSettings[`globalShortcut${key}`];
        const shortcut = fromSettings || shortcutDef.shortcut;
        if (shortcut) {
            try {
                electron.globalShortcut.register(shortcut, () => {
                    if (shortcutDef.event) {
                        emitRemoteEvent(shortcutDef.event);
                    }
                    if (shortcutDef.action) {
                        shortcutDef.action();
                    }
                });
            } catch (e) {}
        }
    }
    logProgress('setting global shortcuts');
}

function subscribePowerEvents() {
    electron.powerMonitor.on('suspend', () => {
        emitRemoteEvent('power-monitor-suspend');
    });
    electron.powerMonitor.on('resume', () => {
        emitRemoteEvent('power-monitor-resume');
    });
    electron.powerMonitor.on('lock-screen', () => {
        emitRemoteEvent('os-lock');
    });
    logProgress('subscribing to power events');
}

module.exports = { setGlobalShortcuts, subscribePowerEvents };
