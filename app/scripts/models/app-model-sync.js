import { Events } from 'framework/events';
import { Storage } from 'storage';
import { FileInfoModel } from 'models/file-info-model';
import { IdGenerator } from 'util/generators/id-generator';
import { Logger } from 'util/logger';
import { documentPathChangedDuringSync } from 'comp/platform/android/android-document-relink';
import { waitForPendingMutations } from 'models/file-mutation-tracker';
import * as SyncRecoverySnapshot from 'models/sync-recovery-snapshot';
import { AppModelSyncLockCacheMixin } from 'models/app-model-sync-lock-cache';
import { Locale } from 'util/locale';

const closedFileError = 'File is closed';

function isFileActive(file) {
    return file.active !== false;
}
const AppModelSyncMixin = {
    ...AppModelSyncLockCacheMixin,

    syncFile(file, options, callback) {
        if (file.demo) {
            return callback && callback();
        }
        if (file.pendingMutations) {
            return waitForPendingMutations(file, () => this.syncFile(file, options, callback));
        }
        if (file.syncing) {
            return callback && callback('Sync in progress');
        }
        if (file.lockCacheInProgress) {
            return callback && callback('Lock cache in progress');
        }
        if (!isFileActive(file)) {
            return callback && callback(closedFileError);
        }
        if (!options) {
            options = {};
        }
        const logger = new Logger('sync', file.name);
        const storage = options.storage || file.storage;
        let path = options.path || file.path;
        let opts = options.opts || file.opts;
        const updateDocumentCapability = (stat) => {
            if (storage === 'androiddoc' && typeof stat?.writable === 'boolean') {
                opts = { ...opts, writable: stat.writable };
                file.opts = opts;
            }
        };
        if (storage && Storage[storage].getPathForName && (!path || storage !== file.storage)) {
            path = Storage[storage].getPathForName(file.name);
        }
        const optionsForLogging = { ...options };
        if (optionsForLogging.opts && optionsForLogging.opts.password) {
            optionsForLogging.opts = { ...optionsForLogging.opts };
            optionsForLogging.opts.password = '***';
        }
        logger.info('Sync started', storage, path, optionsForLogging);
        let savedEditVersion = file.editVersion;
        let savedRecoveryVersion = null;
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
        const recoveryVersionAtSyncStart = fileInfo.recoveryVersion || null;
        file.setSyncProgress();
        const complete = (err) => {
            if (!isFileActive(file)) {
                return callback && callback(closedFileError);
            }
            if (
                documentPathChangedDuringSync({
                    storage,
                    syncPath: path,
                    currentPath: file.path
                })
            ) {
                logger.info('Document relinked while sync ran, restart at the replacement URI');
                file.set({ syncing: false });
                return this.syncFile(file, null, callback);
            }
            logger.info('Sync finished', err || 'no error');
            const recoveryVersionToClear = savedRecoveryVersion || recoveryVersionAtSyncStart;
            const staleSave =
                !err &&
                typeof savedEditVersion === 'number' &&
                savedEditVersion !== file.editVersion;
            const savedCurrentVersion = !staleSave;
            const recoveryVersionForMetadata =
                !err &&
                savedCurrentVersion &&
                fileInfo.recoveryVersion === recoveryVersionAtSyncStart
                    ? null
                    : savedRecoveryVersion ||
                      fileInfo.recoveryVersion ||
                      recoveryVersionAtSyncStart;
            fileInfo.set(
                SyncRecoverySnapshot.fileInfoSnapshotForFile(fileInfo, file, this.settings || {}, {
                    name: file.name,
                    storage,
                    path,
                    opts: this.getStoreOpts(file),
                    modified: !(savedCurrentVersion && !err),
                    editState: savedCurrentVersion && !err ? null : file.getLocalEditState(),
                    syncDate: file.syncDate,
                    chalResp: file.chalResp,
                    recoveryVersion: recoveryVersionForMetadata
                })
            );
            if (!this.fileInfos.get(fileInfo.id)) {
                this.fileInfos.unshift(fileInfo);
            }
            const fileInfosSaved = this.fileInfos.save();
            const finish = (finalErr) => {
                if (!isFileActive(file)) {
                    return callback?.(closedFileError);
                }
                if (finalErr) {
                    file.set({
                        modified: true,
                        dirty: true,
                        syncing: false,
                        syncError: finalErr ? finalErr.toString() : finalErr
                    });
                    return callback?.(finalErr);
                }
                file.setSyncComplete(path, storage, err ? err.toString() : null, {
                    editVersion: savedEditVersion
                });
                callback?.(err);
            };
            const afterFileInfosSaved = () => {
                if (!err && savedCurrentVersion && recoveryVersionToClear) {
                    SyncRecoverySnapshot.clearMatchingRecovery(
                        fileInfo,
                        recoveryVersionToClear,
                        finish
                    );
                } else {
                    finish();
                }
            };
            if (fileInfosSaved?.then) {
                fileInfosSaved.then(afterFileInfosSaved, finish);
            } else {
                afterFileInfosSaved();
            }
        };
        const saveCurrentDataToCache = (saveData) => {
            if (!isFileActive(file)) {
                return complete(closedFileError);
            }
            if (file.pendingMutations) {
                return waitForPendingMutations(file, () => saveCurrentDataToCache(saveData));
            }
            savedEditVersion = file.editVersion;
            const cacheSnapshot = SyncRecoverySnapshot.createNormalCacheSnapshot(
                this,
                fileInfo,
                file,
                storage,
                path,
                savedEditVersion
            );
            file.getData((data, err) => {
                if (err) {
                    return complete(err);
                }
                if (!isFileActive(file)) {
                    return complete(closedFileError);
                }
                if (file.pendingMutations || file.editVersion !== savedEditVersion) {
                    return saveCurrentDataToCache(saveData);
                }
                saveData(data, cacheSnapshot);
            });
        };
        if (!storage) {
            if (!file.modified && fileInfo.id === file.id) {
                logger.info('Local, not modified');
                return complete();
            }
            logger.info('Local, save to cache');
            saveCurrentDataToCache((data, cacheSnapshot) => {
                SyncRecoverySnapshot.saveNormalCacheSnapshot(
                    fileInfo,
                    file,
                    data,
                    cacheSnapshot.metadata,
                    cacheSnapshot.recoveryVersion,
                    (err, recoveryVersion) => {
                        savedRecoveryVersion = recoveryVersion || savedRecoveryVersion;
                        logger.info('Saved to cache', err || 'no error');
                        complete(err);
                        if (!err && isFileActive(file)) {
                            this.scheduleBackupFile(file, data);
                        }
                    }
                );
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
                    if (!isFileActive(file)) {
                        return complete(closedFileError);
                    }
                    if (err) {
                        return complete(err);
                    }
                    updateDocumentCapability(stat);
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
                            savedEditVersion = file.editVersion;
                            const cacheSnapshot = SyncRecoverySnapshot.createNormalCacheSnapshot(
                                this,
                                fileInfo,
                                file,
                                storage,
                                path,
                                savedEditVersion
                            );
                            SyncRecoverySnapshot.saveNormalCacheSnapshot(
                                fileInfo,
                                file,
                                data,
                                cacheSnapshot.metadata,
                                cacheSnapshot.recoveryVersion,
                                (err, recoveryVersion) => {
                                    savedRecoveryVersion = recoveryVersion || savedRecoveryVersion;
                                    if (err) {
                                        return complete(err);
                                    }
                                    logger.info('Complete after dirty cache save');
                                    complete();
                                }
                            );
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
                saveCurrentDataToCache((data, cacheSnapshot) => {
                    if (storage === 'file') {
                        logger.info('Saving to file storage');
                        saveToStorage(data);
                    } else if (!file.dirty && storage !== 'androiddoc') {
                        logger.info('Saving to storage, skip cache because not dirty');
                        saveToStorage(data);
                    } else if (this.settings.disableOfflineStorage && storage !== 'androiddoc') {
                        logger.info('Saving to storage because cache is disabled');
                        saveToStorage(data);
                    } else {
                        if (storage === 'androiddoc' && !Storage.cache.saveRecovery) {
                            return complete(
                                Object.assign(new Error(Locale.androiddocRecoveryUnavailable), {
                                    code: 'RECOVERY_UNAVAILABLE'
                                })
                            );
                        }
                        logger.info('Saving to cache');
                        SyncRecoverySnapshot.saveNormalCacheSnapshot(
                            fileInfo,
                            file,
                            data,
                            cacheSnapshot.metadata,
                            cacheSnapshot.recoveryVersion,
                            (err, recoveryVersion) => {
                                savedRecoveryVersion = recoveryVersion || savedRecoveryVersion;
                                if (err) {
                                    return complete(err);
                                }
                                logger.info('Saved to cache, saving to storage');
                                saveToStorage(data);
                            }
                        );
                    }
                });
            };
            logger.info('Stat file');
            Storage[storage].stat(path, opts, (err, stat) => {
                if (!isFileActive(file)) {
                    return complete(closedFileError);
                }
                if (!err) {
                    updateDocumentCapability(stat);
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
                        saveCurrentDataToCache((data, cacheSnapshot) => {
                            SyncRecoverySnapshot.saveNormalCacheSnapshot(
                                fileInfo,
                                file,
                                data,
                                cacheSnapshot.metadata,
                                cacheSnapshot.recoveryVersion,
                                (e, recoveryVersion) => {
                                    savedRecoveryVersion = recoveryVersion || savedRecoveryVersion;
                                    if (e) {
                                        logger.error('Error saving to cache', e);
                                    }
                                    logger.info(
                                        'Saved to cache, exit with error',
                                        err || 'no error'
                                    );
                                    complete(err);
                                }
                            );
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
