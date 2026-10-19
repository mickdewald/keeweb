import { expect } from 'chai';
import { canSaveToAndroidDocument } from 'comp/platform/android/android-storage-actions';

describe('Android storage actions', () => {
    it('offers Save to Android document only for an Android document already open', () => {
        expect(canSaveToAndroidDocument('androiddoc', 'androiddoc')).to.equal(true);
        expect(canSaveToAndroidDocument('webdav', 'androiddoc')).to.equal(false);
        expect(canSaveToAndroidDocument('webdav', 'dropbox')).to.equal(true);
    });
});
