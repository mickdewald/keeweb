import { expect } from 'chai';
import { FileInfoCollection } from 'collections/file-info-collection';
import { SettingsStore } from 'comp/settings/settings-store';
import { Logger } from 'util/logger';

function waitForPromiseRejections() {
    return Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve)));
}

describe('settings save errors', () => {
    let originalLoggerError;
    let originalFileInfosToJson;

    beforeEach(() => {
        originalLoggerError = Logger.prototype.error;
        originalFileInfosToJson = FileInfoCollection.toJSON;
    });

    afterEach(() => {
        Logger.prototype.error = originalLoggerError;
        FileInfoCollection.toJSON = originalFileInfosToJson;
    });

    it('observes rejected discarded settings and file-info writes', async () => {
        const settingsError = new Error('settings write failed');
        const fileInfosError = new Error('file-info write failed');
        const loggedErrors = [];
        const unhandledErrors = [];
        const onUnhandledRejection = (event) => {
            event.preventDefault();
            unhandledErrors.push(event.reason);
        };
        Logger.prototype.error = (_message, error) => loggedErrors.push(error);
        FileInfoCollection.toJSON = () => {
            throw fileInfosError;
        };

        window.addEventListener('unhandledrejection', onUnhandledRejection);
        try {
            SettingsStore.save('settings-save-errors', {
                toJSON() {
                    throw settingsError;
                }
            });
            FileInfoCollection.save();

            await waitForPromiseRejections();

            expect(loggedErrors).to.eql([settingsError, fileInfosError]);
            expect(unhandledErrors).to.eql([]);
        } finally {
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        }
    });

    it('keeps successful settings writes unchanged', async () => {
        const key = 'settings-save-errors-success';
        const storageKey = 'settingsSaveErrorsSuccess';
        const previousValue = localStorage[storageKey];

        try {
            await SettingsStore.save(key, { saved: true });
            expect(localStorage[storageKey]).to.equal(JSON.stringify({ saved: true }));
        } finally {
            if (previousValue === undefined) {
                delete localStorage[storageKey];
            } else {
                localStorage[storageKey] = previousValue;
            }
        }
    });

    it('keeps direct settings and critical file-info writes rejectable', async () => {
        const settingsError = new Error('settings write failed');
        const fileInfosError = new Error('file-info write failed');
        Logger.prototype.error = () => {};
        FileInfoCollection.toJSON = () => {
            throw fileInfosError;
        };

        let error;
        try {
            await SettingsStore.save('settings-save-errors', {
                toJSON() {
                    throw settingsError;
                }
            });
        } catch (err) {
            error = err;
        }
        expect(error).to.equal(settingsError);

        error = undefined;
        try {
            await FileInfoCollection.save();
        } catch (err) {
            error = err;
        }
        expect(error).to.equal(fileInfosError);
    });
});
