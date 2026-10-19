import { expect } from 'chai';
import { thirdPartyStoragesAllowed } from 'storage';

describe('Storage registry', () => {
    it('offers third-party storages on the web and supporting launchers only, never on Android', () => {
        expect(thirdPartyStoragesAllowed(undefined, false)).to.equal(true);
        expect(thirdPartyStoragesAllowed({ thirdPartyStoragesSupported: true }, false)).to.equal(
            true
        );
        expect(thirdPartyStoragesAllowed({ thirdPartyStoragesSupported: false }, false)).to.equal(
            false
        );
        expect(thirdPartyStoragesAllowed(undefined, true)).to.equal(false);
    });
});
