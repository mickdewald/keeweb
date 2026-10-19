import { Storage } from 'storage';
import { FileInfoModel } from 'models/file-info-model';
import { IdGenerator } from 'util/generators/id-generator';
import { waitForPendingMutations } from 'models/file-mutation-tracker';
import * as SyncRecoverySnapshot from 'models/sync-recovery-snapshot';

const lockCacheCallbacks = new WeakMap();

const AppModelSyncLockCacheMixin = {
    cacheFileForLock(file, callback = () => {}) {
        if (file.demo) {
            return callback();
        }
        if (file.lockCacheInProgress) {
            lockCacheCallbacks.get(file).push(callback);
            return;
        }
        lockCacheCallbacks.set(file, [callback]);
        file.set({ lockCacheInProgress: true });
        const complete = (err) => {
            const callbacks = lockCacheCallbacks.get(file) || [];
            lockCacheCallbacks.delete(file);
            file.set({ lockCacheInProgress: false });
            callbacks.forEach((cb) => cb(err));
        };
        const saveToCache = () => {
            if (file.pendingMutations) {
                return waitForPendingMutations(file, saveToCache);
            }
            if (file.syncing) {
                file.once('change:syncing', (_file, syncing) => {
                    if (!syncing) {
                        Promise.resolve().then(saveToCache);
                    }
                });
                return;
            }
            let fileInfo = this.getFileInfo(file);
            if (!fileInfo) {
                const dt = new Date();
                fileInfo = new FileInfoModel({
                    id: IdGenerator.uuid(),
                    name: file.name,
                    storage: file.storage,
                    path: file.path,
                    opts: this.getStoreOpts(file),
                    modified: true,
                    editState: file.getLocalEditState(),
                    rev: null,
                    syncDate: dt,
                    openDate: dt,
                    backup: file.backup
                });
            }
            const editVersion = file.editVersion;
            const recoveryVersion = SyncRecoverySnapshot.getRecoveryVersion(file, editVersion);
            const settings = this.settings || {};
            const metadata = SyncRecoverySnapshot.fileInfoSnapshotForFile(
                fileInfo,
                file,
                settings,
                {
                    name: file.name,
                    storage: file.storage,
                    path: file.path,
                    opts: this.getStoreOpts(file),
                    modified: true,
                    editState: file.getLocalEditState(),
                    recoveryVersion,
                    syncDate: file.syncDate,
                    chalResp: file.chalResp
                }
            );
            file.getData((data, err) => {
                if (err) {
                    return complete(err);
                }
                if (file.pendingMutations || file.editVersion !== editVersion) {
                    return saveToCache();
                }
                SyncRecoverySnapshot.saveLockRecovery(
                    fileInfo,
                    file,
                    data,
                    metadata,
                    recoveryVersion,
                    (err) => {
                        if (err) {
                            return complete(err);
                        }
                        if (file.pendingMutations || file.editVersion !== editVersion) {
                            return saveToCache();
                        }
                        fileInfo.set(metadata);
                        file.lockCacheEditVersion = editVersion;
                        if (!this.fileInfos.get(fileInfo.id)) {
                            this.fileInfos.unshift(fileInfo);
                        }
                        if (!Storage.cache.saveRecovery) {
                            this.fileInfos.save();
                        }
                        complete();
                    }
                );
            });
        };
        saveToCache();
    }
};

export { AppModelSyncLockCacheMixin };
