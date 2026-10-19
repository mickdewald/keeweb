const idb = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

const IoBrowserCache = function (config) {
    this.db = null;
    this.cacheName = config.cacheName;
    this.logger = config.logger;
    this.initCallbacks = [];
    this.initializing = false;
};

Object.assign(IoBrowserCache.prototype, {
    initDb(callback) {
        if (this.db) {
            return callback && callback();
        }
        if (callback) {
            this.initCallbacks.push(callback);
        }
        if (this.initializing) {
            return;
        }
        this.initializing = true;
        let finished = false;
        const finish = (err) => {
            if (finished) {
                return;
            }
            finished = true;
            this.initializing = false;
            const callbacks = this.initCallbacks;
            this.initCallbacks = [];
            callbacks.forEach((cb) => cb(err));
        };
        const open = (version) => {
            let req;
            try {
                req =
                    version === undefined
                        ? idb.open(this.cacheName)
                        : idb.open(this.cacheName, version);
            } catch (e) {
                this.logger.error('Error opening indexed db', e);
                finish(e);
                return;
            }
            req.onerror = () => {
                const err = req.error || new Error('IndexedDB open failed');
                this.logger.error('Error opening indexed db', err);
                finish(err);
            };
            req.onblocked = () => {
                const err = new Error('IndexedDB upgrade blocked by another open connection');
                this.logger.error('Error opening indexed db', err);
                finish(err);
            };
            req.onsuccess = (e) => {
                if (finished) {
                    e.target.result.close();
                    return;
                }
                const db = e.target.result;
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) {
                        this.db = null;
                    }
                };
                if (db.objectStoreNames.contains('recovery')) {
                    this.db = db;
                    finish();
                } else {
                    db.close();
                    open(db.version + 1);
                }
            };
            req.onupgradeneeded = (e) => this.createStores(e.target.result);
        };
        open();
    },

    createStores(db) {
        if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files');
        }
        if (!db.objectStoreNames.contains('recovery')) {
            db.createObjectStore('recovery');
        }
    },

    transaction(storeName, mode, action, callback) {
        this.initDb((err) => {
            if (err) {
                return callback && callback(err);
            }
            try {
                const ts = this.logger.ts();
                const storeNames = Array.isArray(storeName) ? storeName : [storeName];
                const tx = this.db.transaction(storeNames, mode);
                const request = action(tx.objectStore(storeNames[0]), tx);
                let completed = false;
                const complete = (error, result) => {
                    if (completed) {
                        return;
                    }
                    completed = true;
                    if (error) {
                        this.logger.error(`Error using cache ${storeName}`, error);
                    } else {
                        this.logger.debug(`Cache ${storeName} complete`, this.logger.ts(ts));
                    }
                    if (callback) {
                        callback(error, result);
                    }
                };
                tx.oncomplete = () => complete(null, request && request.result);
                tx.onerror = () =>
                    complete(
                        tx.error ||
                            (request && request.error) ||
                            new Error('IndexedDB transaction failed')
                    );
                tx.onabort = () =>
                    complete(
                        tx.error ||
                            (request && request.error) ||
                            new Error('IndexedDB transaction aborted')
                    );
                request.onerror = () => {
                    // The transaction event reports the durable outcome.
                };
            } catch (e) {
                this.logger.error(`Error using cache ${storeName}`, e);
                if (callback) {
                    callback(e);
                }
            }
        });
    },

    save(id, data, callback) {
        this.logger.debug('Save', id);
        this.transaction('files', 'readwrite', (store) => store.put(data, id), callback);
    },

    load(id, callback) {
        this.logger.debug('Load', id);
        this.loadRecovery(id, (recoveryError, recovery) => {
            if (recoveryError || recovery !== undefined) {
                return callback && callback(recoveryError, recovery && recovery.data);
            }
            this.transaction('files', 'readonly', (store) => store.get(id), callback);
        });
    },

    saveRecovery(id, data, fileInfo, recoveryVersion, callback) {
        this.logger.debug('Save recovery', id);
        this.transaction(
            'recovery',
            'readwrite',
            (store) => store.put({ data, fileInfo, recoveryVersion }, id),
            callback
        );
    },

    loadRecovery(id, callback) {
        this.logger.debug('Load recovery', id);
        this.transaction('recovery', 'readonly', (store) => store.get(id), callback);
    },

    listRecoveryInfos(callback) {
        this.logger.debug('List recovery metadata');
        this.transaction(
            'recovery',
            'readonly',
            (store) => store.getAll(),
            (err, recoveries) => {
                if (err) {
                    return callback && callback(err);
                }
                if (callback) {
                    callback(
                        null,
                        recoveries.map(({ fileInfo, recoveryVersion }) => ({
                            fileInfo,
                            recoveryVersion
                        }))
                    );
                }
            }
        );
    },

    clearRecovery(id, recoveryVersion, callback) {
        this.logger.debug('Clear recovery', id);
        this.initDb((initError) => {
            if (initError) {
                return callback && callback(initError);
            }
            try {
                const tx = this.db.transaction(['recovery'], 'readwrite');
                const store = tx.objectStore('recovery');
                const getRequest = store.get(id);
                let cleared = false;
                let completed = false;
                const complete = (err) => {
                    if (!completed) {
                        completed = true;
                        if (err) {
                            cleared = false;
                        }
                        if (callback) {
                            callback(err, { cleared });
                        }
                    }
                };
                tx.oncomplete = () => complete(null);
                tx.onerror = tx.onabort = () =>
                    complete(
                        tx.error ||
                            getRequest.error ||
                            new Error('IndexedDB recovery transaction failed')
                    );
                getRequest.onsuccess = () => {
                    if (
                        getRequest.result &&
                        getRequest.result.recoveryVersion === recoveryVersion
                    ) {
                        cleared = true;
                        store.delete(id);
                    }
                };
            } catch (e) {
                this.logger.error('Error clearing recovery', id, e);
                if (callback) {
                    callback(e, { cleared: false });
                }
            }
        });
    },

    remove(id, callback) {
        this.logger.debug('Remove', id);
        this.transaction(
            ['files', 'recovery'],
            'readwrite',
            (store, tx) => {
                tx.objectStore('recovery').delete(id);
                return store.delete(id);
            },
            callback
        );
    }
});

export { IoBrowserCache };
