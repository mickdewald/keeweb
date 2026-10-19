import { expect } from 'chai';
import { Storage } from 'storage';
import { AppModelFileOpenMixin } from 'models/app-model-file-open';

describe('AppModel.removeFileInfo', () => {
    let cache;
    beforeEach(() => {
        cache = Storage.cache;
        Storage.cache = { remove() {} };
    });
    afterEach(() => {
        Storage.cache = cache;
        delete Storage.testdoc;
    });

    function ctx(infos) {
        const fileInfos = [...infos];
        fileInfos.get = (id) => fileInfos.find((fi) => fi.id === id);
        fileInfos.remove = (id) => fileInfos.splice(fileInfos.indexOf(fileInfos.get(id)), 1);
        fileInfos.save = () => {};
        return { fileInfos };
    }

    it('lets the storage forget a document no other recent file uses', () => {
        const forgotten = [];
        Storage.testdoc = { forget: (p) => forgotten.push(p) };
        const c = ctx([
            { id: 'a', storage: 'testdoc', path: 'content://a' },
            { id: 'b', storage: 'testdoc', path: 'content://shared' },
            { id: 'c', storage: 'testdoc', path: 'content://shared' }
        ]);
        AppModelFileOpenMixin.removeFileInfo.call(c, 'a');
        AppModelFileOpenMixin.removeFileInfo.call(c, 'b');
        expect(forgotten).to.eql(['content://a']);
        expect(c.fileInfos.map((fi) => fi.id)).to.eql(['c']);
    });
});
