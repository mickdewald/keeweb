import { expect } from 'chai';
import {
    relinkDocument,
    documentPathChangedDuringSync
} from 'comp/platform/android/android-document-relink';

function setup() {
    const fileInfos = [
        { id: 'a', storage: 'androiddoc', path: 'content://old' },
        { id: 'b', storage: 'androiddoc', path: 'content://other' }
    ];
    let saves = 0;
    fileInfos.save = () => saves++;
    const file = {
        id: 'a',
        storage: 'androiddoc',
        path: 'content://old',
        modified: false,
        set(values) {
            Object.assign(this, values);
        }
    };
    const synced = [];
    const forgotten = [];
    const appModel = { fileInfos, files: [file], syncFile: (f) => synced.push(f.id) };
    const storage = { name: 'androiddoc', forget: (p) => forgotten.push(p) };
    return { appModel, storage, fileInfos, file, synced, forgotten, saves: () => saves };
}

describe('relinkDocument', () => {
    it('recognizes an Android document location changed while a sync still holds the old URI', () => {
        expect(
            documentPathChangedDuringSync({
                storage: 'androiddoc',
                syncPath: 'content://old',
                currentPath: 'content://new'
            })
        ).to.equal(true);
        expect(
            documentPathChangedDuringSync({
                storage: 'gdrive',
                syncPath: 'content://old',
                currentPath: 'content://new'
            })
        ).to.equal(false);
    });

    it('points the existing FileInfo and open file at the new URI and syncs', () => {
        const t = setup();
        const res = relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://new',
            opts: { writable: true }
        });
        expect(t.fileInfos.length).to.equal(2);
        expect(t.fileInfos.map((fi) => fi.path)).to.eql(['content://new', 'content://other']);
        expect(t.saves()).to.equal(1);
        expect(t.file.path).to.equal('content://new');
        expect(t.file.opts).to.eql({ writable: true });
        expect(t.fileInfos[0].opts).to.eql({ writable: true });
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
        expect(t.file.modified).to.equal(false);
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

    it('rejects a replacement URI already used by another document', () => {
        const t = setup();
        const res = relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://other'
        });
        expect(res).to.eql({ rejected: 'duplicate' });
        expect(t.fileInfos.map((fi) => fi.path)).to.eql(['content://old', 'content://other']);
        expect(t.file.path).to.equal('content://old');
        expect(t.saves()).to.equal(0);
        expect(t.synced).to.eql([]);
    });

    it('defers relinking until an old-path sync completion has fully unwound', async () => {
        const t = setup();
        let resume;
        t.file.syncing = true;
        t.file.once = (event, callback) => {
            expect(event).to.equal('change:syncing');
            resume = callback;
        };
        const res = relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://new'
        });
        expect(res).to.eql({ pending: 1 });
        expect(t.fileInfos[0].path).to.equal('content://old');
        expect(t.synced).to.eql([]);

        t.file.syncing = false;
        resume(t.file, false);

        // The old completion continues synchronously after it emits change:syncing.
        t.file.path = 'content://old';
        t.fileInfos[0].path = 'content://old';
        expect(t.synced).to.eql([]);

        await Promise.resolve();

        expect(t.fileInfos[0].path).to.equal('content://new');
        expect(t.file.path).to.equal('content://new');
        expect(t.file.modified).to.equal(true);
        expect(t.synced).to.eql(['a']);
    });

    it('deduplicates deferred relinks from repeated requests during one sync', async () => {
        const t = setup();
        const resumes = [];
        t.file.syncing = true;
        t.file.once = (_event, callback) => resumes.push(callback);

        relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://new'
        });
        relinkDocument({
            appModel: t.appModel,
            storage: t.storage,
            oldPath: 'content://old',
            newPath: 'content://new'
        });

        t.file.syncing = false;
        resumes.forEach((resume) => resume(t.file, false));
        await Promise.resolve();

        expect(t.synced).to.eql(['a']);
    });
});
