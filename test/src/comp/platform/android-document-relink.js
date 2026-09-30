import { expect } from 'chai';
import { relinkDocument } from 'comp/platform/android/android-document-relink';

function setup() {
    const fileInfos = [
        { id: 'a', storage: 'androiddoc', path: 'content://old' },
        { id: 'b', storage: 'androiddoc', path: 'content://other' }
    ];
    let saves = 0;
    fileInfos.save = () => saves++;
    const file = { id: 'a', storage: 'androiddoc', path: 'content://old' };
    const synced = [];
    const forgotten = [];
    const appModel = { fileInfos, files: [file], syncFile: (f) => synced.push(f.id) };
    const storage = { name: 'androiddoc', forget: (p) => forgotten.push(p) };
    return { appModel, storage, fileInfos, file, synced, forgotten, saves: () => saves };
}

describe('relinkDocument', () => {
    it('points the existing FileInfo and open file at the new URI and syncs', () => {
        const t = setup();
        const res = relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://new'
        });
        expect(t.fileInfos.length).to.equal(2);
        expect(t.fileInfos.map((fi) => fi.path)).to.eql(['content://new', 'content://other']);
        expect(t.saves()).to.equal(1);
        expect(t.file.path).to.equal('content://new');
        expect(t.forgotten).to.eql(['content://old']);
        expect(t.synced).to.eql(['a']);
        expect(res).to.eql({ fileInfos: 1, files: 1 });
    });

    it('keeps the grant when the same document is picked again', () => {
        const t = setup();
        relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://old'
        });
        expect(t.forgotten).to.eql([]);
        expect(t.synced).to.eql(['a']);
    });

    it('updates only the FileInfo when the file is not open', () => {
        const t = setup();
        t.appModel.files = [];
        relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://new'
        });
        expect(t.fileInfos[0].path).to.equal('content://new');
        expect(t.synced).to.eql([]);
    });
});
