import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { SettingsFileView } from 'views/settings/settings-file-view';
import { AndroidPlatform } from 'comp/platform/android/android-platform';

describe('SettingsFileView key-file selection', () => {
    it('reads the selected browser Blob before applying the key file', async () => {
        const file = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            },
            setKeyFile(data, name) {
                this.selected = { data, name };
                return Promise.resolve();
            }
        };
        const view = { model: file, keyFileSelectionId: 0, renderKeyFileSelect() {} };
        const selectedFile = new File([new Uint8Array([107, 101, 121])], 'picked.key');

        SettingsFileView.prototype.fileSelected.call(view, { target: { files: [selectedFile] } });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(file.selected.name).to.equal('picked.key');
        expect(new Uint8Array(file.selected.data)).to.eql(new Uint8Array([107, 101, 121]));
        expect(file.pendingMutations).to.equal(0);
    });

    it('releases the pending key-file mutation when FileReader construction throws', () => {
        const OriginalFileReader = window.FileReader;
        class ThrowingFileReader {
            constructor() {
                throw new Error('reader unavailable');
            }
        }
        window.FileReader = ThrowingFileReader;
        const file = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            }
        };
        const view = { model: file, keyFileSelectionId: 0 };

        try {
            SettingsFileView.prototype.fileSelected.call(view, {
                target: { files: [{ name: 'picked.key' }] }
            });
            expect(file.pendingMutations).to.equal(0);
        } finally {
            window.FileReader = OriginalFileReader;
        }
    });

    it('applies a generated key file only after Android verifies its external export', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        const originalGenerate = kdbxweb.Credentials.createRandomKeyFile;
        let completeExport;
        const exported = new Promise((resolve) => (completeExport = resolve));
        const file = {
            name: 'Main',
            path: 'content://document/main',
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            },
            setKeyFile(data, name) {
                this.selected = { data, name };
                return Promise.resolve();
            }
        };
        const view = { model: file, keyFileSelectionId: 0, renderKeyFileSelect() {} };
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({ exportNew: () => exported });
        kdbxweb.Credentials.createRandomKeyFile = () => Promise.resolve(new Uint8Array([1, 2, 3]));

        try {
            SettingsFileView.prototype.generateKeyFile.call(view);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(file.selected).to.equal(undefined);
            expect(file.pendingMutations).to.equal(1);

            completeExport({ uri: 'content://document/new', name: 'Main.key', rev: 'r1' });
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(file.selected.name).to.equal('Generated');
            expect(file.pendingMutations).to.equal(0);
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
            kdbxweb.Credentials.createRandomKeyFile = originalGenerate;
        }
    });

    it('preserves the current key factor when Android key-file export is canceled', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        const originalGenerate = kdbxweb.Credentials.createRandomKeyFile;
        const file = {
            name: 'Main',
            pendingMutations: 0,
            currentKeyFile: 'current',
            set(values) {
                Object.assign(this, values);
            },
            setKeyFile() {
                throw new Error('must not replace the current factor');
            }
        };
        const view = { model: file, keyFileSelectionId: 0, renderKeyFileSelect() {} };
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({ exportNew: () => Promise.reject({ code: 'CANCELED' }) });
        kdbxweb.Credentials.createRandomKeyFile = () => Promise.resolve(new Uint8Array([1]));

        try {
            SettingsFileView.prototype.generateKeyFile.call(view);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(file.currentKeyFile).to.equal('current');
            expect(file.pendingMutations).to.equal(0);
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
            kdbxweb.Credentials.createRandomKeyFile = originalGenerate;
        }
    });

    it('does not apply Android key-file picker data after the active file changed', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        let resolvePicker;
        const selected = new Promise((resolve) => (resolvePicker = resolve));
        const file = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            },
            setKeyFile(data, name) {
                this.selected = { data, name };
                return Promise.resolve();
            }
        };
        const view = {
            model: file,
            keyFileSelectionId: 0,
            renderKeyFileSelect() {},
            $el: { find: () => ({ click() {} }) }
        };
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({ pickRead: () => selected });

        try {
            SettingsFileView.prototype.triggerSelectFile.call(view);
            expect(file.pendingMutations).to.equal(1);
            await Promise.resolve();

            view.model = {
                setKeyFile() {
                    throw new Error('retargeted');
                }
            };
            resolvePicker({ data: btoa('key'), name: 'picked.key' });
            await selected;
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(file.selected).to.equal(undefined);
            expect(file.pendingMutations).to.equal(0);
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
        }
    });

    it('ignores a stale file read after resetting the key file and releases its pending mutation', async () => {
        const readers = [];
        const OriginalFileReader = window.FileReader;
        class TestFileReader {
            constructor() {
                readers.push(this);
            }

            readAsArrayBuffer() {}
        }
        window.FileReader = TestFileReader;

        let setKeyFileCalls = 0;
        let resetKeyFileCalls = 0;
        const model = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            },
            setKeyFile() {
                setKeyFileCalls++;
                return Promise.resolve();
            },
            resetKeyFile() {
                resetKeyFileCalls++;
                return Promise.resolve();
            }
        };
        const view = {
            model,
            keyFileSelectionId: 0,
            selectOldKeyFile: SettingsFileView.prototype.selectOldKeyFile,
            renderKeyFileSelect() {}
        };

        try {
            SettingsFileView.prototype.fileSelected.call(view, {
                target: { files: [{ name: 'stale.key' }] }
            });
            expect(model.pendingMutations).to.equal(1);

            SettingsFileView.prototype.keyFileChange.call(view, { target: { value: 'old' } });
            await Promise.resolve();
            readers[0].onload({ target: { result: new ArrayBuffer(1) } });
            await Promise.resolve();

            expect(resetKeyFileCalls).to.equal(1);
            expect(setKeyFileCalls).to.equal(0);
            expect(model.pendingMutations).to.equal(0);
        } finally {
            window.FileReader = OriginalFileReader;
        }
    });
});
