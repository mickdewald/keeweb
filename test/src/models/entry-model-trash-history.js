import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { EntryModelTrashHistoryMixin } from 'models/entry-model-trash-history';

function createFixture({ previousParent = 'original', deleteOriginal = false, directEntry = false } = {}) {
    const db = kdbxweb.Kdbx.create(
        new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString('')),
        'Restore fixture'
    );
    const root = db.getDefaultGroup();
    const original = db.createGroup(root);
    original.name = 'Original';
    const nested = db.createGroup(original);
    nested.name = 'Nested';
    const entry = db.createEntry(directEntry ? original : nested);
    entry.fields.set('Title', 'Entry to restore');

    db.remove(entry);
    if (deleteOriginal) {
        db.remove(original);
    }
    if (previousParent === 'missing') {
        entry.previousParentGroup = kdbxweb.KdbxUuid.random();
    } else if (previousParent === 'bin') {
        entry.previousParentGroup = db.meta.recycleBinUuid;
    }

    const file = {
        db,
        setModified() {},
        reload() {}
    };
    const model = {
        entry,
        file
    };

    EntryModelTrashHistoryMixin.restoreFromTrash.call(model);

    return { db, entry, root, original, nested, trash: db.getGroup(db.meta.recycleBinUuid) };
}

function isInTrash(group, trash) {
    for (let current = group; current; current = current.parentGroup) {
        if (current.uuid.equals(trash.uuid)) {
            return true;
        }
    }
    return false;
}

describe('EntryModel trash restore', () => {
    it('restores to the remembered original group', () => {
        const { entry, nested, trash } = createFixture();

        expect(entry.parentGroup).to.equal(nested);
        expect(isInTrash(entry.parentGroup, trash)).to.equal(false);
    });

    it('falls back to the default group when the remembered group is missing', () => {
        const { entry, root, trash } = createFixture({ previousParent: 'missing' });

        expect(entry.parentGroup).to.equal(root);
        expect(isInTrash(entry.parentGroup, trash)).to.equal(false);
    });

    it('falls back to the default group when the remembered group is the recycle bin', () => {
        const { entry, root, trash } = createFixture({ previousParent: 'bin' });

        expect(entry.parentGroup).to.equal(root);
        expect(isInTrash(entry.parentGroup, trash)).to.equal(false);
    });

    it('falls back to the default group when the remembered group is a direct recycle-bin child', () => {
        const { entry, root, trash } = createFixture({ deleteOriginal: true, directEntry: true });

        expect(entry.parentGroup).to.equal(root);
        expect(isInTrash(entry.parentGroup, trash)).to.equal(false);
    });

    it('falls back to the default group when the remembered group is deeply inside the recycle bin', () => {
        const { entry, root, trash } = createFixture({ deleteOriginal: true });

        expect(entry.parentGroup).to.equal(root);
        expect(isInTrash(entry.parentGroup, trash)).to.equal(false);
    });
});
