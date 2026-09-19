import { expect } from 'chai';
import { AppView } from 'views/app-view';

describe('native Settings menu action', () => {
    it('opens general settings without requiring an unlocked file', () => {
        let page;
        AppView.prototype.showSettingsIfNotThere.call({
            views: {},
            toggleSettings: (value) => (page = value)
        });
        expect(page).to.equal('general');
    });

    it('keeps already open settings visible on repeated invocations', () => {
        AppView.prototype.showSettingsIfNotThere.call({
            views: { settings: {} },
            toggleSettings: () => {
                throw new Error('Settings must not toggle closed');
            }
        });
    });
});
