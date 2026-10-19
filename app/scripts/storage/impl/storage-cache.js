import { IoBrowserCache } from 'storage/io-browser-cache';
import { StorageBase } from 'storage/storage-base';

class StorageCache extends StorageBase {
    name = 'cache';
    enabled = IoBrowserCache.enabled;
    system = true;

    io = null;

    init() {
        if (this.io) {
            return this;
        }
        super.init();
        this.io = new IoBrowserCache({
            cacheName: 'FilesCache',
            logger: this.logger
        });
        return this;
    }

    save(id, opts, data, callback) {
        this.io.save(id, data, callback);
    }

    load(id, opts, callback) {
        this.io.load(id, callback);
    }

    saveRecovery(id, opts, data, fileInfo, recoveryVersion, callback) {
        this.io.saveRecovery(id, data, fileInfo, recoveryVersion, callback);
    }

    loadRecovery(id, opts, callback) {
        this.io.loadRecovery(id, callback);
    }

    listRecoveryInfos(opts, callback) {
        this.io.listRecoveryInfos(callback);
    }

    clearRecovery(id, opts, recoveryVersion, callback) {
        this.io.clearRecovery(id, recoveryVersion, callback);
    }

    remove(id, opts, callback) {
        this.io.remove(id, callback);
    }
}

export { StorageCache };
