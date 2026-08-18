import { Events } from 'framework/events';
import { FileCollection } from 'collections/file-collection';
import { FileInfoCollection } from 'collections/file-info-collection';
import { RuntimeInfo } from 'const/runtime-info';
import { UsbListener } from 'comp/app/usb-listener';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';
import { NativeModules } from 'comp/launcher/native-modules';
import { Timeouts } from 'const/timeouts';
import { AppSettingsModel } from 'models/app-settings-model';
import { FileInfoModel } from 'models/file-info-model';
import { YubiKeyOtpModel } from 'models/otp-device/yubikey-otp-model';
import { MenuModel } from 'models/menu/menu-model';
import { AppModelBackupMixin } from 'models/app-model-backup';
import { AppModelFileOpenMixin } from 'models/app-model-file-open';
import { AppModelFilterMixin } from 'models/app-model-filter';
import { AppModelSyncMixin } from 'models/app-model-sync';
import { PluginManager } from 'plugins/plugin-manager';
import { Features } from 'util/features';
import { Launcher } from 'comp/launcher';
import { IdGenerator } from 'util/generators/id-generator';
import { Logger } from 'util/logger';
import 'util/kdbxweb/protected-value-ex';

class AppModel {
    tags = [];
    files = new FileCollection();
    fileInfos = FileInfoCollection;
    menu = new MenuModel();
    filter = {};
    sort = 'title';
    settings = AppSettingsModel;
    activeEntryId = null;
    isBeta = RuntimeInfo.beta;
    advancedSearch = null;
    attachedYubiKeysCount = 0;
    memoryPasswordStorage = {};
    fileUnlockPromise = null;
    hardwareDecryptInProgress = false;
    mainWindowBlurTimer = null;

    constructor() {
        Events.on('refresh', this.refresh.bind(this));
        Events.on('set-filter', this.setFilter.bind(this));
        Events.on('add-filter', this.addFilter.bind(this));
        Events.on('set-sort', this.setSort.bind(this));
        Events.on('empty-trash', this.emptyTrash.bind(this));
        Events.on('select-entry', this.selectEntry.bind(this));
        Events.on('unset-keyfile', this.unsetKeyFile.bind(this));
        Events.on('usb-devices-changed', this.usbDevicesChanged.bind(this));
        Events.on('main-window-blur', this.mainWindowBlur.bind(this));
        Events.on('main-window-focus', this.mainWindowFocus.bind(this));
        Events.on('main-window-will-close', this.mainWindowWillClose.bind(this));
        Events.on('hardware-decrypt-started', this.hardwareDecryptStarted.bind(this));
        Events.on('hardware-decrypt-finished', this.hardwareDecryptFinished.bind(this));

        this.appLogger = new Logger('app');
        AppModel.instance = this;
    }

    loadConfig(configLocation) {
        return new Promise((resolve, reject) => {
            this.ensureCanLoadConfig(configLocation);
            this.appLogger.debug('Loading config from', configLocation);
            const ts = this.appLogger.ts();
            const xhr = new XMLHttpRequest();
            xhr.open('GET', configLocation);
            xhr.responseType = 'json';
            xhr.send();
            xhr.addEventListener('load', () => {
                let response = xhr.response;
                if (!response) {
                    const errorDesc = xhr.statusText === 'OK' ? 'Malformed JSON' : xhr.statusText;
                    this.appLogger.error('Error loading app config', errorDesc);
                    return reject('Error loading app config');
                }
                if (typeof response === 'string') {
                    try {
                        response = JSON.parse(response);
                    } catch (e) {
                        this.appLogger.error('Error parsing response', e, response);
                        return reject('Error parsing response');
                    }
                }
                if (!response.settings) {
                    this.appLogger.error('Invalid app config, no settings section', response);
                    return reject('Invalid app config, no settings section');
                }
                this.appLogger.info(
                    'Loaded app config from',
                    configLocation,
                    this.appLogger.ts(ts)
                );
                resolve(response);
            });
            xhr.addEventListener('error', () => {
                this.appLogger.error('Error loading app config', xhr.statusText, xhr.status);
                reject('Error loading app config');
            });
        }).then((config) => {
            return this.applyUserConfig(config);
        });
    }

    ensureCanLoadConfig(url) {
        if (!Features.isSelfHosted) {
            throw 'Configs are supported only in self-hosted installations';
        }
        const link = document.createElement('a');
        link.href = url;
        const isExternal = link.host && link.host !== location.host;
        if (isExternal) {
            throw 'Loading config from this location is not allowed';
        }
    }

    applyUserConfig(config) {
        this.settings.set(config.settings);
        if (config.files) {
            if (config.showOnlyFilesFromConfig) {
                this.fileInfos.length = 0;
            }
            config.files
                .filter(
                    (file) =>
                        file &&
                        file.storage &&
                        file.name &&
                        file.path &&
                        !this.fileInfos.getMatch(file.storage, file.name, file.path)
                )
                .map(
                    (file) =>
                        new FileInfoModel({
                            id: IdGenerator.uuid(),
                            name: file.name,
                            storage: file.storage,
                            path: file.path,
                            opts: file.options
                        })
                )
                .reverse()
                .forEach((fi) => this.fileInfos.unshift(fi));
        }
        if (config.plugins) {
            const pluginsPromises = config.plugins.map((plugin) =>
                PluginManager.installIfNew(plugin.url, plugin.manifest, true)
            );
            return Promise.all(pluginsPromises).then(() => {
                this.settings.set(config.settings);
            });
        }
        if (config.advancedSearch) {
            this.advancedSearch = config.advancedSearch;
            this.addFilter({ advanced: this.advancedSearch });
        }
    }

    addFile(file) {
        if (this.files.get(file.id)) {
            return false;
        }
        this._ensureDefaultBackup(file);
        this.files.push(file);
        for (const group of file.groups) {
            this.menu.groupsSection.addItem(group);
        }
        this._presentGroupsMenu();
        this._addTags(file);
        this._tagsChanged();
        this.menu.filesSection.addItem({
            icon: 'lock',
            title: file.name,
            page: 'file',
            file
        });

        this.refresh();

        file.on('reload', this.reloadFile.bind(this));
        file.on('change', () => {
            Events.emit('file-changed', file);
        });
        file.on('ejected', () => this.closeFile(file));
        file.on('change:dirty', (file, dirty) => {
            if (dirty && this.settings.autoSaveInterval === -1) {
                this.syncFile(file);
            }
        });

        Events.emit('file-opened');

        if (this.fileUnlockPromise) {
            this.appLogger.info('Running pending file unlock operation');
            this.fileUnlockPromise.resolve(file);
            this.fileUnlockPromise = null;
            Events.emit('unlock-message-changed', null);
        }

        return true;
    }

    reloadFile(file) {
        this.menu.groupsSection.replaceByFile(file, file.groups[0]);
        this._presentGroupsMenu();
        this.updateTags();
    }

    closeAllFiles() {
        if (!this.files.hasOpenFiles()) {
            return;
        }
        for (const file of this.files) {
            file.close();
            this.fileClosed(file);
        }
        this.files.length = 0;
        this.menu.groupsSection.removeAllItems();
        this._presentGroupsMenu();
        this.menu.filesSection.removeAllItems();
        this.tags.splice(0, this.tags.length);
        this._tagsChanged();
        this.filter = {};
        this.menu.select({ item: this.menu.allItemsItem });
        Events.emit('all-files-closed');
    }

    closeFile(file) {
        file.close();
        this.fileClosed(file);
        this.files.remove(file);
        this.updateTags();
        this.menu.groupsSection.removeByFile(file);
        this._presentGroupsMenu();
        this.menu.filesSection.removeByFile(file);
        this.menu.select({ item: this.menu.allItemsSection.items[0] });
        Events.emit('one-file-closed');
    }

    usbDevicesChanged() {
        const attachedYubiKeysCount = this.attachedYubiKeysCount;

        this.attachedYubiKeysCount = UsbListener.attachedYubiKeys;

        if (!this.settings.yubiKeyAutoOpen) {
            return;
        }

        const isNewYubiKey = UsbListener.attachedYubiKeys > attachedYubiKeysCount;
        const hasOpenFiles = this.files.some(
            (file) => file.active && file.backend !== 'otp-device'
        );

        if (isNewYubiKey && hasOpenFiles && !this.openingOtpDevice) {
            this.tryOpenOtpDeviceInBackground();
        }
    }

    tryOpenOtpDeviceInBackground() {
        this.appLogger.debug('Auto-opening a YubiKey');
        this.openOtpDevice((err) => {
            this.appLogger.debug('YubiKey auto-open complete', err);
        });
    }

    openOtpDevice(callback) {
        this.openingOtpDevice = true;
        const device = new YubiKeyOtpModel();
        device.open((err) => {
            this.openingOtpDevice = false;
            if (!err) {
                this.addFile(device);
            }
            callback(err);
        });
        return device;
    }

    getMatchingOtpEntry(entry) {
        if (!this.settings.yubiKeyMatchEntries) {
            return null;
        }
        for (const file of this.files) {
            if (file.backend === 'otp-device') {
                const matchingEntry = file.getMatchingEntry(entry);
                if (matchingEntry) {
                    return matchingEntry;
                }
            }
        }
    }

    saveEncryptedPassword(file, params) {
        return TouchIdRecovery.savePassword(this, file, params, NativeModules);
    }

    getMemoryPassword(fileId) {
        return this.memoryPasswordStorage[fileId];
    }

    checkEncryptedPasswordsStorage() {
        if (this.settings.deviceOwnerAuth === 'file') {
            let changed = false;
            for (const fileInfo of this.fileInfos) {
                if (this.memoryPasswordStorage[fileInfo.id]) {
                    fileInfo.encryptedPassword = this.memoryPasswordStorage[fileInfo.id].value;
                    fileInfo.encryptedPasswordDate = this.memoryPasswordStorage[fileInfo.id].date;
                    changed = true;
                }
            }
            if (changed) {
                this.fileInfos.save();
            }
            for (const file of this.files) {
                if (this.memoryPasswordStorage[file.id]) {
                    file.encryptedPassword = this.memoryPasswordStorage[file.id].value;
                    file.encryptedPasswordDate = this.memoryPasswordStorage[file.id].date;
                }
            }
        } else if (this.settings.deviceOwnerAuth === 'memory') {
            let changed = false;
            for (const fileInfo of this.fileInfos) {
                if (fileInfo.encryptedPassword) {
                    this.memoryPasswordStorage[fileInfo.id] = {
                        value: fileInfo.encryptedPassword,
                        date: fileInfo.encryptedPasswordDate
                    };
                    fileInfo.encryptedPassword = null;
                    fileInfo.encryptedPasswordDate = null;
                    changed = true;
                }
            }
            if (changed) {
                this.fileInfos.save();
            }
        } else {
            let changed = false;
            for (const fileInfo of this.fileInfos) {
                if (fileInfo.encryptedPassword) {
                    fileInfo.encryptedPassword = null;
                    fileInfo.encryptedPasswordDate = null;
                    changed = true;
                }
            }
            if (changed) {
                this.fileInfos.save();
            }
            for (const file of this.files) {
                if (file.encryptedPassword) {
                    file.encryptedPassword = null;
                    file.encryptedPasswordDate = null;
                }
            }
            this.memoryPasswordStorage = {};
        }
    }

    unlockAnyFile(unlockRes, timeout) {
        this.rejectPendingFileUnlockPromise('Replaced with a new operation');
        Events.emit('show-open-view');
        return new Promise((resolve, reject) => {
            this.fileUnlockPromise = { resolve, reject, unlockRes };
            if (timeout) {
                const timer = setTimeout(
                    () => this.rejectPendingFileUnlockPromise('Timeout'),
                    timeout
                );
                this.fileUnlockPromise.resolve = (res) => {
                    clearTimeout(timer);
                    resolve(res);
                };
                this.fileUnlockPromise.reject = (err) => {
                    clearTimeout(timer);
                    reject(err);
                };
            }
            this.appLogger.info('Pending file unlock operation is set');
            Events.emit('unlock-message-changed', unlockRes);
        });
    }

    get unlockMessageRes() {
        return this.fileUnlockPromise?.unlockRes;
    }

    rejectPendingFileUnlockPromise(reason) {
        if (this.fileUnlockPromise) {
            this.appLogger.info('Cancel pending file unlock operation', reason);
            this.fileUnlockPromise.reject(new Error(reason));
            this.fileUnlockPromise = null;
            Events.emit('unlock-message-changed', null);
        }
    }

    mainWindowBlur() {
        if (!this.hardwareDecryptInProgress) {
            this.mainWindowBlurTimer = setTimeout(() => {
                // macOS emits focus-blur-focus event in a row when triggering auto-type from minimized state
                delete this.mainWindowBlurTimer;
                this.rejectPendingFileUnlockPromise('Main window blur');
            }, Timeouts.AutoTypeWindowFocusAfterBlur);
        }
    }

    mainWindowFocus() {
        if (this.mainWindowBlurTimer) {
            clearTimeout(this.mainWindowBlurTimer);
            this.mainWindowBlurTimer = null;
        }
    }

    mainWindowWillClose() {
        this.rejectPendingFileUnlockPromise('Main window will close');
    }

    hardwareDecryptStarted() {
        this.hardwareDecryptInProgress = true;
    }

    hardwareDecryptFinished() {
        this.hardwareDecryptInProgress = false;
        if (!Launcher.isAppFocused()) {
            this.rejectPendingFileUnlockPromise('App is not focused after hardware decrypt');
        }
    }
}

Object.assign(AppModel.prototype, AppModelFilterMixin);
Object.assign(AppModel.prototype, AppModelFileOpenMixin);
Object.assign(AppModel.prototype, AppModelSyncMixin);
Object.assign(AppModel.prototype, AppModelBackupMixin);

export { AppModel };
