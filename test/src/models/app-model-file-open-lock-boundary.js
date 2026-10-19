import { expect } from 'chai';
import { AppModelFileOpenMixin } from 'models/app-model-file-open';
import { FileModel } from 'models/file-model';
import { Storage } from 'storage';

describe('AppModelFileOpenMixin background lock boundary', () => {
    function appModelForDelayedAdds() {
        const added = [];
        return {
            ...AppModelFileOpenMixin,
            settings: {},
            files: { getByName: () => false, get: () => false },
            fileInfos: { getByName: () => false },
            backgroundLockGeneration: 0,
            backgroundLockActive: false,
            addFile(file) {
                added.push(file);
            },
            added
        };
    }

    it('rejects a delayed open result after the background lock generation changes', () => {
        const originalOpen = FileModel.prototype.open;
        let finishOpen;
        FileModel.prototype.open = function (_password, _data, _keyFileData, callback) {
            finishOpen = () => callback();
        };
        const added = [];
        const callbacks = [];
        const appModel = {
            ...AppModelFileOpenMixin,
            settings: {},
            files: { get: () => false },
            fileInfos: { remove() {}, unshift() {}, save() {} },
            backgroundLockGeneration: 0,
            addToLastOpenFiles() {},
            addFile(file) {
                added.push(file);
            },
            fileOpened() {}
        };

        try {
            appModel.openFileWithData(
                {
                    name: 'Main',
                    storage: null,
                    path: '',
                    password: null,
                    fileData: new Uint8Array([1]).buffer
                },
                (err, file) => callbacks.push({ err, file }),
                null,
                new Uint8Array([1]).buffer
            );
            appModel.backgroundLockGeneration = 1;
            appModel.backgroundLockActive = true;
            finishOpen();

            expect(added).to.eql([]);
            expect(callbacks).to.have.length(1);
            expect(callbacks[0].err).to.equal('Workspace locked');
        } finally {
            FileModel.prototype.open = originalOpen;
        }
    });

    it('uses the generation captured before provider load and closes the obsolete opened file', () => {
        const originalOpen = FileModel.prototype.open;
        const originalStorage = Storage.testdoc;
        let finishLoad;
        let openedFile;
        FileModel.prototype.open = function (_password, _data, _keyFileData, callback) {
            openedFile = this;
            this.db = { opened: true };
            callback();
        };
        Storage.testdoc = {
            load(_path, _opts, callback) {
                finishLoad = () =>
                    callback(null, new Uint8Array([1]).buffer, { rev: 'provider-rev' });
            }
        };
        const added = [];
        const callbacks = [];
        const appModel = {
            ...AppModelFileOpenMixin,
            settings: {},
            files: { get: () => false },
            fileInfos: { getMatch: () => null, remove() {}, unshift() {}, save() {} },
            backgroundLockGeneration: 0,
            backgroundLockActive: false,
            getStoreOpts: () => null,
            setFileOpts() {},
            addToLastOpenFiles() {},
            addFile(file) {
                added.push(file);
            },
            fileOpened() {}
        };

        try {
            appModel.openFile(
                { name: 'Main', storage: 'testdoc', path: 'content://doc', opts: {} },
                (err, file) => callbacks.push({ err, file })
            );
            appModel.backgroundLockGeneration = 1;
            appModel.backgroundLockActive = false;
            finishLoad();

            expect(added).to.eql([]);
            expect(callbacks).to.have.length(1);
            expect(callbacks[0].err).to.equal('Workspace locked');
            expect(openedFile.db).to.equal(null);
            expect(openedFile.active).to.equal(false);
        } finally {
            FileModel.prototype.open = originalOpen;
            if (originalStorage) {
                Storage.testdoc = originalStorage;
            } else {
                delete Storage.testdoc;
            }
        }
    });

    it('does not add a demo file if its async open completes after the lock boundary changes', () => {
        const originalOpenDemo = FileModel.prototype.openDemo;
        let finishOpenDemo;
        let openedFile;
        FileModel.prototype.openDemo = function (callback) {
            openedFile = this;
            this.db = { opened: true };
            finishOpenDemo = callback;
        };
        const appModel = appModelForDelayedAdds();

        try {
            expect(appModel.createDemoFile()).to.equal(true);
            appModel.backgroundLockGeneration = 1;
            finishOpenDemo();

            expect(appModel.added).to.eql([]);
            expect(openedFile.db).to.equal(null);
            expect(openedFile.active).to.equal(false);
        } finally {
            FileModel.prototype.openDemo = originalOpenDemo;
        }
    });

    it('does not add a new empty file if creation completes after the lock boundary changes', () => {
        const originalCreate = FileModel.prototype.create;
        let finishCreate;
        let createdFile;
        const callbacks = [];
        FileModel.prototype.create = function (_name, callback) {
            createdFile = this;
            this.db = { opened: true };
            finishCreate = callback;
        };
        const appModel = appModelForDelayedAdds();

        try {
            appModel.createNewFile('New', (file) => callbacks.push(file));
            appModel.backgroundLockGeneration = 1;
            finishCreate();

            expect(appModel.added).to.eql([]);
            expect(callbacks).to.eql([null]);
            expect(createdFile.db).to.equal(null);
            expect(createdFile.active).to.equal(false);
        } finally {
            FileModel.prototype.create = originalCreate;
        }
    });

    it('rejects imported XML if import completes after the lock boundary changes', () => {
        const originalImport = FileModel.prototype.importWithXml;
        let finishImport;
        let importedFile;
        const callbacks = [];
        FileModel.prototype.importWithXml = function (_xml, callback) {
            importedFile = this;
            this.db = { opened: true };
            finishImport = () => callback();
        };
        const appModel = appModelForDelayedAdds();

        try {
            appModel.importFileWithXml(
                { name: 'Import', storage: null, path: '', fileXml: '<xml />' },
                (err) => callbacks.push(err || null)
            );
            appModel.backgroundLockGeneration = 1;
            finishImport();

            expect(appModel.added).to.eql([]);
            expect(callbacks).to.eql(['Workspace locked']);
            expect(importedFile.db).to.equal(null);
            expect(importedFile.active).to.equal(false);
        } finally {
            FileModel.prototype.importWithXml = originalImport;
        }
    });
});
