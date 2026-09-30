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
