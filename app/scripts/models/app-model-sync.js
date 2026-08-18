import { Events } from 'framework/events';
import { Storage } from 'storage';
import { FileInfoModel } from 'models/file-info-model';
import { IdGenerator } from 'util/generators/id-generator';
import { Logger } from 'util/logger';

const AppModelSyncMixin = {
    syncFile(file, options, callback) {
        if (file.demo) {
            return callback && callback();
        }
        if (file.syncing) {
            return callback && callback('Sync in progress');
        }
        if (!file.active) {
            return callback && callback('File is closed');
        }
        if (!options) {
            options = {};
        }
        const logger = new Logger('sync', file.name);
        const storage = options.storage || file.storage;
        let path = options.path || file.path;
        const opts = options.opts || file.opts;
        if (storage && Storage[storage].getPathForName && (!path || storage !== file.storage)) {
            path = Storage[storage].getPathForName(file.name);
        }
        const optionsForLogging = { ...options };
        if (optionsForLogging.opts && optionsForLogging.opts.password) {
            optionsForLogging.opts = { ...optionsForLogging.opts };
            optionsForLogging.opts.password = '***';
        }
        logger.info('Sync started', storage, path, optionsForLogging);
        let fileInfo = this.getFileInfo(file);
        if (!fileInfo) {
            logger.info('Create new file info');
            const dt = new Date();
            fileInfo = new FileInfoModel({
                id: IdGenerator.uuid(),
                name: file.name,
                storage: file.storage,
                path: file.path,
                opts: this.getStoreOpts(file),
                modified: file.modified,
                editState: null,
                rev: null,
                syncDate: dt,
                openDate: dt,
                backup: file.backup
            });
        }
        file.setSyncProgress();
        const complete = (err) => {
            if (!file.active) {
                return callback && callback('File is closed');
            }
            logger.info('Sync finished', err || 'no error');
            file.setSyncComplete(path, storage, err ? err.toString() : null);
            fileInfo.set({
                name: file.name,
                storage,
                path,
                opts: this.getStoreOpts(file),
                modified: file.dirty ? fileInfo.modified : file.modified,
                editState: file.dirty ? fileInfo.editState : file.getLocalEditState(),
                syncDate: file.syncDate,
                chalResp: file.chalResp
            });
            if (this.settings.rememberKeyFiles === 'data') {
                fileInfo.set({
                    keyFileName: file.keyFileName || null,
                    keyFileHash: file.getKeyFileHash()
                });
            }
            if (!this.fileInfos.get(fileInfo.id)) {
                this.fileInfos.unshift(fileInfo);
            }
            this.fileInfos.save();
            if (callback) {
                callback(err);
            }
        };
        if (!storage) {
            if (!file.modified && fileInfo.id === file.id) {
                logger.info('Local, not modified');
                return complete();
            }
            logger.info('Local, save to cache');
            file.getData((data, err) => {
                if (err) {
                    return complete(err);
                }
                Storage.cache.save(fileInfo.id, null, data, (err) => {
                    logger.info('Saved to cache', err || 'no error');
                    complete(err);
                    if (!err) {
                        this.scheduleBackupFile(file, data);
                    }
                });
            });
        } else {
            const maxLoadLoops = 3;
            let loadLoops = 0;
            const loadFromStorageAndMerge = () => {
                if (++loadLoops === maxLoadLoops) {
                    return complete('Too many load attempts');
                }
                logger.info('Load from storage, attempt ' + loadLoops);
                Storage[storage].load(path, opts, (err, data, stat) => {
                    logger.info('Load from storage', stat, err || 'no error');
                    if (!file.active) {
                        return complete('File is closed');
                    }
                    if (err) {
                        return complete(err);
                    }
                    file.mergeOrUpdate(data, options.remoteKey, (err) => {
                        logger.info('Merge complete', err || 'no error');
                        this.refresh();
                        if (err) {
                            if (err.code === 'InvalidKey') {
                                logger.info('Remote key changed, request to enter new key');
                                Events.emit('remote-key-changed', { file });
                            }
                            return complete(err);
                        }
                        if (stat && stat.rev) {
                            logger.info('Update rev in file info');
                            fileInfo.rev = stat.rev;
                        }
                        file.syncDate = new Date();
                        if (file.modified) {
                            logger.info('Updated sync date, saving modified file');
                            saveToCacheAndStorage();
                        } else if (file.dirty) {
                            if (this.settings.disableOfflineStorage) {
                                logger.info('File is dirty and cache is disabled');
                                return complete(err);
                            }
                            logger.info('Saving not modified dirty file to cache');
                            Storage.cache.save(fileInfo.id, null, data, (err) => {
                                if (err) {
                                    return complete(err);
                                }
                                file.dirty = false;
                                logger.info('Complete, remove dirty flag');
                                complete();
                            });
                        } else {
                            logger.info('Complete, no changes');
                            complete();
                        }
                    });
                });
            };
            const saveToStorage = (data) => {
                logger.info('Save data to storage');
                const storageRev = fileInfo.storage === storage ? fileInfo.rev : undefined;
                Storage[storage].save(
                    path,
                    opts,
                    data,
                    (err, stat) => {
                        if (err && err.revConflict) {
                            logger.info('Save rev conflict, reloading from storage');
                            loadFromStorageAndMerge();
                        } else if (err) {
                            logger.info('Error saving data to storage');
                            complete(err);
                        } else {
                            if (stat && stat.rev) {
                                logger.info('Update rev in file info');
                                fileInfo.rev = stat.rev;
                            }
                            if (stat && stat.path) {
                                logger.info('Update path in file info', stat.path);
                                file.path = stat.path;
                                fileInfo.path = stat.path;
                                path = stat.path;
                            }
                            file.syncDate = new Date();
                            logger.info('Save to storage complete, update sync date');
                            this.scheduleBackupFile(file, data);
                            complete();
                        }
                    },
                    storageRev
                );
            };
            const saveToCacheAndStorage = () => {
                logger.info('Getting file data for saving');
                file.getData((data, err) => {
                    if (err) {
                        return complete(err);
                    }
                    if (storage === 'file') {
                        logger.info('Saving to file storage');
                        saveToStorage(data);
                    } else if (!file.dirty) {
                        logger.info('Saving to storage, skip cache because not dirty');
                        saveToStorage(data);
                    } else if (this.settings.disableOfflineStorage) {
                        logger.info('Saving to storage because cache is disabled');
                        saveToStorage(data);
                    } else {
                        logger.info('Saving to cache');
                        Storage.cache.save(fileInfo.id, null, data, (err) => {
                            if (err) {
                                return complete(err);
                            }
                            file.dirty = false;
                            logger.info('Saved to cache, saving to storage');
                            saveToStorage(data);
                        });
                    }
                });
            };
            logger.info('Stat file');
            Storage[storage].stat(path, opts, (err, stat) => {
                if (!file.active) {
                    return complete('File is closed');
                }
                if (err) {
                    if (err.notFound) {
                        logger.info('File does not exist in storage, creating');
                        saveToCacheAndStorage();
                    } else if (file.dirty) {
                        if (this.settings.disableOfflineStorage) {
                            logger.info('Stat error, dirty, cache is disabled', err || 'no error');
                            return complete(err);
                        }
                        logger.info('Stat error, dirty, save to cache', err || 'no error');
                        file.getData((data, e) => {
                            if (e) {
                                logger.error('Error getting file data', e);
                                return complete(err);
                            }
                            Storage.cache.save(fileInfo.id, null, data, (e) => {
                                if (e) {
                                    logger.error('Error saving to cache', e);
                                }
                                if (!e) {
                                    file.dirty = false;
                                }
                                logger.info('Saved to cache, exit with error', err || 'no error');
                                complete(err);
                            });
                        });
                    } else {
                        logger.info('Stat error, not dirty', err || 'no error');
                        complete(err);
                    }
                } else if (stat.rev === fileInfo.rev) {
                    if (file.modified) {
                        logger.info('Stat found same version, modified, saving');
                        saveToCacheAndStorage();
                    } else {
                        logger.info('Stat found same version, not modified');
                        complete();
                    }
                } else {
                    logger.info('Found new version, loading from storage');
                    loadFromStorageAndMerge();
                }
            });
        }
    },

    deleteAllCachedFiles() {
        for (const fileInfo of this.fileInfos) {
            if (fileInfo.storage && !fileInfo.modified) {
                Storage.cache.remove(fileInfo.id);
            }
        }
    },

    clearStoredKeyFiles() {
        for (const fileInfo of this.fileInfos) {
            fileInfo.set({
                keyFileName: null,
                keyFilePath: null,
                keyFileHash: null
            });
        }
        this.fileInfos.save();
    },

    unsetKeyFile(fileId) {
        const fileInfo = this.fileInfos.get(fileId);
        fileInfo.set({
            keyFileName: null,
            keyFilePath: null,
            keyFileHash: null
        });
        this.fileInfos.save();
    }
};

export { AppModelSyncMixin };
