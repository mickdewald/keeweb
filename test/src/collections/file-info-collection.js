import { expect } from 'chai';
import { FileInfoCollection } from 'collections/file-info-collection';
import { SettingsStore } from 'comp/settings/settings-store';
import { Storage } from 'storage';

describe('FileInfoCollection', () => {
    let originalLoad;
    let originalSave;
    let originalCache;

    beforeEach(() => {
        originalLoad = SettingsStore.load;
        originalSave = SettingsStore.save;
        originalCache = Storage.cache;
    });

    afterEach(() => {
        SettingsStore.load = originalLoad;
        SettingsStore.save = originalSave;
        Storage.cache = originalCache;
    });

    it('returns the persistence rejection to a caller that must keep a lock open', async () => {
        const quotaError = new Error('QuotaExceededError');
        SettingsStore.save = () => Promise.reject(quotaError);

        let error;
        try {
            await FileInfoCollection.save();
        } catch (err) {
            error = err;
        }
        expect(error).to.equal(quotaError);
    });

    it('uses recovery metadata when a local settings mirror is missing or stale', async () => {
        SettingsStore.load = () => Promise.resolve([{ id: 'same', name: 'stale' }]);
        Storage.cache = {
            init() {},
            listRecoveryInfos(_opts, callback) {
                callback(null, [
                    { fileInfo: { id: 'same', name: 'recovered', modified: true } },
                    { fileInfo: { id: 'new', name: 'new recovery', modified: true } }
                ]);
            }
        };
        const collection = new FileInfoCollection.constructor();

        await collection.load();

        expect(collection.map((fileInfo) => fileInfo.name)).to.eql(['recovered', 'new recovery']);
    });

    it('rejects startup when recovery metadata cannot be enumerated', async () => {
        const recoveryError = new Error('IndexedDB unavailable');
        SettingsStore.load = () => Promise.resolve(undefined);
        Storage.cache = {
            init() {},
            listRecoveryInfos(_opts, callback) {
                callback(recoveryError);
            }
        };
        const collection = new FileInfoCollection.constructor();
        let error;

        try {
            await collection.load();
        } catch (err) {
            error = err;
        }

        expect(error).to.equal(recoveryError);
    });
});
