// test/src/comp/platform/android-back-navigation.js
import { expect } from 'chai';
import {
    BackAction,
    decideBackAction,
    readBackState,
    performBackAction
} from 'comp/platform/android/android-back-navigation';

const none = {
    modalOpen: false,
    dropdownOpen: false,
    fieldActionsOpen: false,
    settingsOpen: false,
    panelOpen: false,
    detailsVisible: false,
    searchActive: false
};

describe('Android back navigation', () => {
    it('closes overlays before navigating', () => {
        expect(decideBackAction({ ...none, modalOpen: true, detailsVisible: true })).to.equal(
            BackAction.CloseModal
        );
        expect(decideBackAction({ ...none, dropdownOpen: true })).to.equal(
            BackAction.CloseDropdown
        );
        expect(
            decideBackAction({ ...none, fieldActionsOpen: true, detailsVisible: true })
        ).to.equal(BackAction.CloseFieldActions);
    });

    it('goes from details to the list, then clears search', () => {
        expect(decideBackAction({ ...none, detailsVisible: true, searchActive: true })).to.equal(
            BackAction.ShowList
        );
        expect(decideBackAction({ ...none, searchActive: true })).to.equal(BackAction.ClearSearch);
    });

    it('leaves settings and panels after overlays and before details or search', () => {
        const busy = { ...none, detailsVisible: true, searchActive: true };
        expect(decideBackAction({ ...busy, settingsOpen: true })).to.equal(
            BackAction.ShowWorkspace
        );
        expect(decideBackAction({ ...busy, settingsOpen: true, modalOpen: true })).to.equal(
            BackAction.CloseModal
        );
        expect(decideBackAction({ ...busy, panelOpen: true })).to.equal(BackAction.ClosePanel);
        expect(decideBackAction({ ...busy, panelOpen: true, dropdownOpen: true })).to.equal(
            BackAction.CloseDropdown
        );
    });

    it('never finishes the app: the fallback is moving to the background', () => {
        expect(decideBackAction(none)).to.equal(BackAction.Background);
        expect(Object.values(BackAction)).to.not.include('exit');
    });

    it('reads the state from the DOM', () => {
        const root = document.createElement('div');
        root.innerHTML = `<div class="app app--details-visible"><div class="details__field-mobile-actions"></div>
            <input class="list__search-field" value="abc"></div>`;
        document.body.appendChild(root);
        try {
            expect(readBackState(root)).to.eql({
                ...none,
                fieldActionsOpen: true,
                detailsVisible: true,
                searchActive: true
            });
        } finally {
            root.remove();
        }
    });

    it('reads open settings and a panel with a back button from the DOM', () => {
        const root = document.createElement('div');
        root.innerHTML = `<div class="app__body"><div class="settings"></div>
            <div class="app__panel"><div class="gen-ps"><div class="back-button"></div></div></div></div>`;
        document.body.appendChild(root);
        try {
            expect(readBackState(root)).to.eql({ ...none, settingsOpen: true, panelOpen: true });
            root.querySelector('.app__panel').classList.add('hide');
            root.querySelector('.settings').remove();
            expect(readBackState(root)).to.eql(none);
        } finally {
            root.remove();
        }
    });

    it('returns from settings through toggle-settings', () => {
        const emitted = [];
        performBackAction(BackAction.ShowWorkspace, {
            events: { emit: (...a) => emitted.push(a) }
        });
        expect(emitted).to.eql([['toggle-settings']]);
    });

    it("closes a panel through the panel's own back button", () => {
        const root = document.createElement('div');
        root.innerHTML = `<div class="app__panel"><div class="back-button"></div></div>`;
        let clicked = 0;
        root.querySelector('.back-button').addEventListener('click', () => clicked++);
        performBackAction(BackAction.ClosePanel, { root });
        expect(clicked).to.equal(1);
    });

    it('moves the task to the background for the fallback action', () => {
        const calls = [];
        performBackAction(BackAction.Background, {
            app: { minimizeApp: () => calls.push('minimize') }
        });
        expect(calls).to.eql(['minimize']);
    });

    it('emits toggle-details(false) to return to the list', () => {
        const emitted = [];
        performBackAction(BackAction.ShowList, { events: { emit: (...a) => emitted.push(a) } });
        expect(emitted).to.eql([['toggle-details', false]]);
    });
});
