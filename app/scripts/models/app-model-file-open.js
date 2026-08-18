import { Events } from 'framework/events';
import { Storage } from 'storage';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';
import { NativeModules } from 'comp/launcher/native-modules';
import { Timeouts } from 'const/timeouts';
import { FileInfoModel } from 'models/file-info-model';
import { FileModel } from 'models/file-model';
import { IdGenerator } from 'util/generators/id-generator';
import { Locale } from 'util/locale';
import { Logger } from 'util/logger';
import debounce from 'lodash/debounce';

const AppModelFileOpenMixin = {
    createDemoFile() {
        if (!this.files.getByName('Demo')) {
            const demoFile = new FileModel({ id: IdGenerator.uuid() });
            demoFile.openDemo(() => {
                this.addFile(demoFile);
            });
            return true;
        } else {
            return false;
        }
    },

    createNewFile(name, callback) {
        if (!name) {
            for (let i = 0; ; i++) {
                name = Locale.openNewFile + (i || '');
                if (!this.files.getByName(name) && !this.fileInfos.getByName(name)) {
                    break;
                }
            }
        }
        const newFile = new FileModel({ id: IdGenerator.uuid() });
        newFile.create(name, () => {
            this.addFile(newFile);
            callback?.(newFile);
        });
    },

    openFile(params, callback) {
        const logger = new Logger('open', params.name);
        logger.info('File open request');

        const fileInfo = params.id
            ? this.fileInfos.get(params.id)
            : this.fileInfos.getMatch(params.storage, params.name, params.path);

        if (!params.opts && fileInfo && fileInfo.opts) {
            params.opts = fileInfo.opts;
        }

        if (fileInfo && fileInfo.modified) {
            logger.info('Open file from cache because it is modified');
            this.openFileFromCache(
                params,
                (err, file) => {
                    if (!err && file) {
                        logger.info('Sync just opened modified file');
                        setTimeout(() => this.syncFile(file), 0);
                    }
                    callback(err);
                },
                fileInfo
            );
        } else if (params.fileData) {
            logger.info('Open file from supplied content');
            if (params.storage === 'file') {
                Storage.file.stat(params.path, null, (err, stat) => {
                    if (err) {
                        return callback(err);
                    }
                    params.rev = stat.rev;
                    this.openFileWithData(params, callback, fileInfo, params.fileData);
                });
            } else {
                this.openFileWithData(params, callback, fileInfo, params.fileData, true);
            }
        } else if (!params.storage) {
            logger.info('Open file from cache as main storage');
            this.openFileFromCache(params, callback, fileInfo);
        } else if (
            fileInfo &&
            fileInfo.openDate &&
            fileInfo.rev === params.rev &&
            fileInfo.storage !== 'file' &&
            !this.settings.disableOfflineStorage
        ) {
            logger.info('Open file from cache because it is latest');
            this.openFileFromCache(
                params,
                (err, file) => {
                    if (err) {
                        if (err.name === 'KdbxError' || err.ykError) {
                            return callback(err);
                        }
                        logger.info(
                            'Error loading file from cache, trying to open from storage',
                            err
                        );
                        this.openFileFromStorage(params, callback, fileInfo, logger, true);
                    } else {
                        callback(err, file);
                    }
                },
                fileInfo
            );
        } else if (
            !fileInfo ||
            !fileInfo.openDate ||
            params.storage === 'file' ||
            this.settings.disableOfflineStorage
        ) {
            this.openFileFromStorage(params, callback, fileInfo, logger);
        } else {
            logger.info('Open file from cache, will sync after load', params.storage);
            this.openFileFromCache(
                params,
                (err, file) => {
                    if (!err && file) {
                        logger.info('Sync just opened file');
                        setTimeout(() => this.syncFile(file), 0);
                        callback(err);
                    } else {
                        if (err.name === 'KdbxError' || err.ykError) {
                            return callback(err);
                        }
                        logger.info(
                            'Error loading file from cache, trying to open from storage',
                            err
                        );
                        this.openFileFromStorage(params, callback, fileInfo, logger, true);
                    }
                },
                fileInfo
            );
        }
    },

    openFileFromCache(params, callback, fileInfo) {
        Storage.cache.load(fileInfo.id, null, (err, data) => {
            if (!data) {
                err = Locale.openFileNoCacheError;
            }
            new Logger('open', params.name).info('Loaded file from cache', err);
            if (err) {
                callback(err);
            } else {
                this.openFileWithData(params, callback, fileInfo, data);
            }
        });
    },

    openFileFromStorage(params, callback, fileInfo, logger, noCache) {
        logger.info('Open file from storage', params.storage);
        const storage = Storage[params.storage];
        const storageLoad = () => {
            logger.info('Load from storage');
            storage.load(params.path, params.opts, (err, data, stat) => {
                if (err) {
                    if (fileInfo && fileInfo.openDate && !this.settings.disableOfflineStorage) {
                        logger.info('Open file from cache because of storage load error', err);
                        this.openFileFromCache(params, callback, fileInfo);
                    } else {
                        logger.info('Storage load error', err);
                        callback(err);
                    }
                } else {
                    logger.info('Open file from content loaded from storage');
                    params.fileData = data;
                    params.rev = (stat && stat.rev) || null;
                    const needSaveToCache = storage.name !== 'file';
                    this.openFileWithData(params, callback, fileInfo, data, needSaveToCache);
                }
            });
        };
        const cacheRev = (fileInfo && fileInfo.rev) || null;
        if (cacheRev && storage.stat) {
            logger.info('Stat file');
            storage.stat(params.path, params.opts, (err, stat) => {
                if (
                    !noCache &&
                    fileInfo &&
                    storage.name !== 'file' &&
                    (err || (stat && stat.rev === cacheRev)) &&
                    !this.settings.disableOfflineStorage
                ) {
                    logger.info(
                        'Open file from cache because ' + (err ? 'stat error' : 'it is latest'),
                        err
                    );
                    this.openFileFromCache(params, callback, fileInfo);
                } else if (stat) {
                    logger.info(
                        'Open file from storage (' + stat.rev + ', local ' + cacheRev + ')'
                    );
                    storageLoad();
                } else {
                    logger.info('Stat error', err);
                    callback(err);
                }
            });
        } else {
            storageLoad();
        }
    },

    openFileWithData(params, callback, fileInfo, data, updateCacheOnSuccess) {
        const logger = new Logger('open', params.name);
        let needLoadKeyFile = false;
        if (!params.keyFileData && fileInfo && fileInfo.keyFileName) {
            params.keyFileName = fileInfo.keyFileName;
            if (this.settings.rememberKeyFiles === 'data' && fileInfo.keyFileHash) {
                params.keyFileData = FileModel.createKeyFileWithHash(fileInfo.keyFileHash);
            } else if (this.settings.rememberKeyFiles === 'path' && fileInfo.keyFilePath) {
                params.keyFilePath = fileInfo.keyFilePath;
                if (Storage.file.enabled) {
                    needLoadKeyFile = true;
                }
            }
        } else if (params.keyFilePath && !params.keyFileData && !fileInfo) {
            needLoadKeyFile = true;
        }
        const file = new FileModel({
            id: fileInfo ? fileInfo.id : IdGenerator.uuid(),
            name: params.name,
            storage: params.storage,
            path: params.path,
            keyFileName: params.keyFileName,
            keyFilePath: params.keyFilePath,
            backup: fileInfo?.backup || null,
            chalResp: params.chalResp
        });
        if (params.encryptedPassword) {
            file.encryptedPassword = fileInfo.encryptedPassword;
            file.encryptedPasswordDate = fileInfo?.encryptedPasswordDate || new Date();
        }
        const openComplete = (err) => {
            if (err) {
                return callback(err);
            }
            if (this.files.get(file.id)) {
                return callback('Duplicate file id');
            }
            if (fileInfo && fileInfo.modified) {
                if (fileInfo.editState) {
                    logger.info('Loaded local edit state');
                    file.setLocalEditState(fileInfo.editState);
                }
                logger.info('Mark file as modified');
                file.modified = true;
            }
            if (fileInfo) {
                file.syncDate = fileInfo.syncDate;
            }
            if (updateCacheOnSuccess && !this.settings.disableOfflineStorage) {
                logger.info('Save loaded file to cache');
                Storage.cache.save(file.id, null, params.fileData);
            }
            const rev = params.rev || (fileInfo && fileInfo.rev);
            this.setFileOpts(file, params.opts);
            this.addToLastOpenFiles(file, rev);
            this.addFile(file);
            callback(null, file);
            this.fileOpened(file, data, params);
        };
        const open = () => {
            file.open(params.password, data, params.keyFileData, openComplete);
        };
        if (needLoadKeyFile) {
            Storage.file.load(params.keyFilePath, {}, (err, data) => {
                if (err) {
                    logger.info('Storage load error', err);
                    callback(err);
                } else {
                    params.keyFileData = data;
                    open();
                }
            });
        } else {
            open();
        }
    },

    importFileWithXml(params, callback) {
        const logger = new Logger('import', params.name);
        logger.info('File import request with supplied xml');
        const file = new FileModel({
            id: IdGenerator.uuid(),
            name: params.name,
            storage: params.storage,
            path: params.path
        });
        file.importWithXml(params.fileXml, (err) => {
            logger.info('Import xml complete ' + (err ? 'with error' : ''), err);
            if (err) {
                return callback(err);
            }
            this.addFile(file);
            this.fileOpened(file);
        });
    },

    addToLastOpenFiles(file, rev) {
        this.appLogger.debug(
            'Add last open file',
            file.id,
            file.name,
            file.storage,
            file.path,
            rev
        );
        const dt = new Date();
        const fileInfo = new FileInfoModel({
            id: file.id,
            name: file.name,
            storage: file.storage,
            path: file.path,
            opts: this.getStoreOpts(file),
            modified: file.modified,
            editState: file.getLocalEditState(),
            rev,
            syncDate: file.syncDate || dt,
            openDate: dt,
            backup: file.backup,
            chalResp: file.chalResp
        });
        switch (this.settings.rememberKeyFiles) {
            case 'data':
                fileInfo.set({
                    keyFileName: file.keyFileName || null,
                    keyFileHash: file.getKeyFileHash()
                });
                break;
            case 'path':
                fileInfo.set({
                    keyFileName: file.keyFileName || null,
                    keyFilePath: file.keyFilePath || null
                });
        }
        if (this.settings.deviceOwnerAuth === 'file' && file.encryptedPassword) {
            const maxDate = new Date(file.encryptedPasswordDate);
            maxDate.setMinutes(maxDate.getMinutes() + this.settings.deviceOwnerAuthTimeoutMinutes);
            if (maxDate > new Date()) {
                fileInfo.encryptedPassword = file.encryptedPassword;
                fileInfo.encryptedPasswordDate = file.encryptedPasswordDate;
            }
        }
        this.fileInfos.remove(file.id);
        this.fileInfos.unshift(fileInfo);
        this.fileInfos.save();
    },

    getStoreOpts(file) {
        const opts = file.opts;
        const storage = file.storage;
        if (Storage[storage] && Storage[storage].fileOptsToStoreOpts && opts) {
            return Storage[storage].fileOptsToStoreOpts(opts, file);
        }
        return null;
    },

    setFileOpts(file, opts) {
        const storage = file.storage;
        if (Storage[storage] && Storage[storage].storeOptsToFileOpts && opts) {
            file.opts = Storage[storage].storeOptsToFileOpts(opts, file);
        }
    },

    fileOpened(file, data, params) {
        if (file.storage === 'file') {
            Storage.file.watch(
                file.path,
                debounce(() => {
                    this.syncFile(file);
                }, Timeouts.FileChangeSync)
            );
        }
        if (file.isKeyChangePending(true)) {
            Events.emit('key-change-pending', { file });
        }
        const backup = file.backup;
        if (data && backup && backup.enabled && backup.pending) {
            this.scheduleBackupFile(file, data);
        }
        if (this.settings.yubiKeyAutoOpen) {
            if (
                this.attachedYubiKeysCount > 0 &&
                !this.files.some((f) => f.backend === 'otp-device')
            ) {
                this.tryOpenOtpDeviceInBackground();
            }
        }
        if (this.settings.deviceOwnerAuth) {
            if (!params) {
                return;
            }
            if (TouchIdRecovery.isRequired()) {
                if (!params.encryptedPassword && TouchIdRecovery.isRequired(file.id)) {
                    return TouchIdRecovery.recover(this, file, params, NativeModules)
                        .then(() => this.appLogger.info('Touch ID reconnected'))
                        .catch((error) => {
                            this.appLogger.error('Error reconnecting Touch ID', error);
                            TouchIdRecovery.showFailedAlert();
                        });
                }
                return;
            }
            return this.saveEncryptedPassword(file, params);
        }
    },

    fileClosed(file) {
        if (file.storage === 'file') {
            Storage.file.unwatch(file.path);
        }
    },

    removeFileInfo(id) {
        Storage.cache.remove(id);
        this.fileInfos.remove(id);
        this.fileInfos.save();
    },

    getFileInfo(file) {
        return (
            this.fileInfos.get(file.id) ||
            this.fileInfos.getMatch(file.storage, file.name, file.path)
        );
    }
};

export { AppModelFileOpenMixin };
