import { expect } from 'chai';
import { GroupModel } from 'models/group-model';

function recycleBinGroup() {
    const recycleBinUuid = { id: 'bin' };
    const group = Object.create(GroupModel.prototype);
    group.file = { db: { meta: { recycleBinUuid, entryTemplatesGroup: null } } };
    group.group = {
        uuid: {
            equals(other) {
                return other === recycleBinUuid;
            }
        },
        enableSearching: true,
        enableAutoType: true
    };
    return group;
}

describe('GroupModel trash visibility', () => {
    it('hides the recycle bin from normal lists and tag filters', () => {
        const group = recycleBinGroup();
        expect(group.matches({ tag: 'Lizenz' })).to.be.false;
        expect(group.matches({})).to.be.false;
    });

    it('still shows the recycle bin when the trash filter is active', () => {
        const group = recycleBinGroup();
        expect(group.matches({ trash: true })).to.be.true;
    });

    it('shows a recycle bin with searching disabled when viewing trash', () => {
        const group = recycleBinGroup();
        group.group.enableSearching = false;
        expect(group.matches({ trash: true })).to.be.true;
        expect(group.matches({})).to.be.false;
    });

    it('keeps the recycle bin in the object map used to open trash', () => {
        const group = recycleBinGroup();
        expect(group.matches({ includeDisabled: true })).to.be.true;
    });
});
