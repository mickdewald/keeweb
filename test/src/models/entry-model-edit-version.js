import { expect } from 'chai';
import { EntryModel } from 'models/entry-model';

function createModel() {
    const file = {
        historyMaxItems: 0,
        editVersion: 0,
        pendingMutations: 0,
        set(values) {
            Object.assign(this, values);
        },
        setModified() {
            this.editVersion++;
        },
        db: {
            createBinary() {
                return Promise.resolve('binary');
            }
        }
    };
    const model = new EntryModel();
    model.entry = {
        fields: new Map(),
        binaries: new Map(),
        times: { update() {} },
        pushHistory() {}
    };
    model.file = file;
    model._fillByEntry = () => {};
    return { model, file };
}

describe('EntryModel edit version', () => {
    it('marks every edit, even when the entry is already unsaved', () => {
        const { model, file } = createModel();
        model.unsaved = true;

        model.setField('Title', 'first');
        model.setField('UserName', 'second');

        expect(file.editVersion).to.equal(2);
    });

    it('releases a pending attachment mutation when binary creation rejects', async () => {
        const { model, file } = createModel();
        file.db.createBinary = () => Promise.reject(new Error('binary failed'));

        let err;
        try {
            await model.addAttachment('report.pdf', new Uint8Array([1]));
        } catch (e) {
            err = e;
        }

        expect(err.message).to.equal('binary failed');
        expect(file.pendingMutations).to.equal(0);
        expect(model.entry.binaries.size).to.equal(0);
    });

    it('releases a pending attachment mutation when applying the binary throws', async () => {
        const { model, file } = createModel();
        model._entryModified = () => {
            throw new Error('apply failed');
        };

        let err;
        try {
            await model.addAttachment('report.pdf', new Uint8Array([1]));
        } catch (e) {
            err = e;
        }

        expect(err.message).to.equal('apply failed');
        expect(file.pendingMutations).to.equal(0);
        expect(model.entry.binaries.size).to.equal(0);
    });

    it('marks an attachment only after its binary was added', async () => {
        const { model, file } = createModel();
        let resolveBinary;
        file.db.createBinary = () =>
            new Promise((resolve) => {
                resolveBinary = resolve;
            });

        const adding = model.addAttachment('report.pdf', new Uint8Array([1]));
        expect(file.pendingMutations).to.equal(1);
        expect(file.editVersion).to.equal(0);
        expect(model.entry.binaries.size).to.equal(0);

        resolveBinary('binary');
        await adding;

        expect(file.pendingMutations).to.equal(0);
        expect(file.editVersion).to.equal(1);
        expect(model.entry.binaries.get('report.pdf')).to.equal('binary');
    });
});
