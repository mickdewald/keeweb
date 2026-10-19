import { expect } from 'chai';
import { shouldRegisterServiceWorker } from 'comp/app/updater';

describe('Updater service worker gate', () => {
    const base = {
        launcher: null,
        isAndroid: false,
        serviceWorker: {},
        beta: false,
        devMode: false
    };

    it('registers only in production web browsers', () => {
        expect(shouldRegisterServiceWorker(base)).to.equal(true);
        expect(shouldRegisterServiceWorker({ ...base, launcher: {} })).to.equal(false);
        expect(shouldRegisterServiceWorker({ ...base, isAndroid: true })).to.equal(false);
        expect(shouldRegisterServiceWorker({ ...base, serviceWorker: null })).to.equal(false);
        expect(shouldRegisterServiceWorker({ ...base, beta: true })).to.equal(false);
        expect(shouldRegisterServiceWorker({ ...base, devMode: true })).to.equal(false);
    });
});
