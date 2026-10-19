import { expect } from 'chai';
import { IoBrowserCache } from 'storage/io-browser-cache';

function uniqueCacheName() {
    return `IoBrowserCacheTest-${Date.now()}-${Math.random()}`;
}

function createCache() {
    return new IoBrowserCache({
        cacheName: uniqueCacheName(),
        logger: {
            debug() {},
            error() {},
            ts() {
                return 0;
            }
        }
    });
}

function call(method, ...args) {
    return new Promise((resolve) => method(...args, (...callbackArgs) => resolve(callbackArgs)));
}

function deleteDatabase(cache) {
    if (cache.db) {
        cache.db.close();
    }
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(cache.cacheName);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
    });
}

function createLegacyDatabase(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = (e) => e.target.result.createObjectStore('files');
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = () => reject(request.error);
    });
}

describe('IoBrowserCache', () => {
    let cache;

    beforeEach(() => {
        cache = createCache();
    });

    afterEach(() => deleteDatabase(cache));

    it('keeps legacy cache records readable after adding recovery records', async () => {
        const data = new Uint8Array([1, 2, 3]).buffer;
        expect((await call(cache.save.bind(cache), 'legacy', data))[0]).to.equal(null);
        const [err, loaded] = await call(cache.load.bind(cache), 'legacy');
        expect(err).to.equal(null);
        expect(new Uint8Array(loaded)).to.eql(new Uint8Array([1, 2, 3]));
    });

    it('upgrades a legacy database once when initialization and recovery loading overlap', async () => {
        const legacyDb = await createLegacyDatabase(cache.cacheName);
        legacyDb.close();

        const [[initError], [listError, recoveries]] = await Promise.all([
            call(cache.initDb.bind(cache)),
            call(cache.listRecoveryInfos.bind(cache))
        ]);

        expect(initError).to.equal(undefined);
        expect(listError).to.equal(null);
        expect(recoveries).to.eql([]);
        expect(cache.db.objectStoreNames.contains('recovery')).to.equal(true);
    });

    it('persists encrypted cache bytes and file metadata in one recovery record', async () => {
        const data = new Uint8Array([7, 8, 9]).buffer;
        const fileInfo = { id: 'recovery', modified: true, editState: { version: 2 } };

        expect(
            (await call(cache.saveRecovery.bind(cache), 'recovery', data, fileInfo, 2))[0]
        ).to.equal(null);
        const [err, recovery] = await call(cache.loadRecovery.bind(cache), 'recovery');

        expect(err).to.equal(null);
        expect(new Uint8Array(recovery.data)).to.eql(new Uint8Array([7, 8, 9]));
        expect(recovery.fileInfo).to.eql(fileInfo);
        expect(recovery.recoveryVersion).to.equal(2);
    });

    it('restores recovery bytes after a cache restart when no legacy record exists', async () => {
        const data = new Uint8Array([4, 5, 6]).buffer;
        const fileInfo = { id: 'recovery', modified: true };
        await call(cache.saveRecovery.bind(cache), 'recovery', data, fileInfo, 1);
        cache.db.close();
        cache.db = null;

        const [err, loaded] = await call(cache.load.bind(cache), 'recovery');

        expect(err).to.equal(null);
        expect(new Uint8Array(loaded)).to.eql(new Uint8Array([4, 5, 6]));
    });

    it('prefers recovery bytes over a stale legacy cache record', async () => {
        await call(cache.save.bind(cache), 'recovery', new Uint8Array([1]).buffer);
        await call(
            cache.saveRecovery.bind(cache),
            'recovery',
            new Uint8Array([2]).buffer,
            { id: 'recovery', modified: true },
            2
        );

        const [err, loaded] = await call(cache.load.bind(cache), 'recovery');

        expect(err).to.equal(null);
        expect(new Uint8Array(loaded)).to.eql(new Uint8Array([2]));
    });

    it('rejects a cache write when IndexedDB aborts after the put request succeeds', async () => {
        const [err] = await call(cache.transaction.bind(cache), 'files', 'readwrite', (store) => {
            const request = store.put(new ArrayBuffer(1), 'aborted');
            request.addEventListener('success', () => request.transaction.abort());
            return request;
        });

        expect(err).to.not.equal(null);
    });

    it('does not retire a newer recovery record from an older completion', async () => {
        const fileInfo = { id: 'recovery', modified: true };
        await call(cache.saveRecovery.bind(cache), 'recovery', new ArrayBuffer(1), fileInfo, 3);

        const [err, result] = await call(cache.clearRecovery.bind(cache), 'recovery', 2);
        const [, recovery] = await call(cache.loadRecovery.bind(cache), 'recovery');

        expect(err).to.equal(null);
        expect(result).to.eql({ cleared: false });
        expect(recovery.recoveryVersion).to.equal(3);
    });

    it('removes legacy and recovery cache records together', async () => {
        await call(cache.save.bind(cache), 'removed', new Uint8Array([1]).buffer);
        await call(
            cache.saveRecovery.bind(cache),
            'removed',
            new Uint8Array([2]).buffer,
            { id: 'removed', modified: true },
            1
        );

        const [removeError] = await call(cache.remove.bind(cache), 'removed');
        const [, recovery] = await call(cache.loadRecovery.bind(cache), 'removed');
        const [, data] = await call(cache.load.bind(cache), 'removed');

        expect(removeError).to.equal(null);
        expect(recovery).to.equal(undefined);
        expect(data).to.equal(undefined);
    });
});
