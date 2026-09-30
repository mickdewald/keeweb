// app/scripts/comp/platform/android/android-back-navigation.js
import { Events } from 'framework/events';
import { Keys } from 'const/keys';

const BackAction = {
    CloseModal: 'close-modal',
    CloseDropdown: 'close-dropdown',
    CloseFieldActions: 'close-field-actions',
    ShowList: 'show-list',
    ClearSearch: 'clear-search',
    Background: 'background'
};

function decideBackAction(state) {
    if (state.modalOpen) {
        return BackAction.CloseModal;
    }
    if (state.dropdownOpen) {
        return BackAction.CloseDropdown;
    }
    if (state.fieldActionsOpen) {
        return BackAction.CloseFieldActions;
    }
    if (state.detailsVisible) {
        return BackAction.ShowList;
    }
    if (state.searchActive) {
        return BackAction.ClearSearch;
    }
    return BackAction.Background;
}

function readBackState(root = document) {
    const search = root.querySelector('.list__search-field');
    return {
        modalOpen: !!root.querySelector('.modal:not(.modal--hidden)'),
        dropdownOpen: !!root.querySelector('.dropdown'),
        fieldActionsOpen: !!root.querySelector('.details__field-mobile-actions'),
        detailsVisible: !!root.querySelector('.app.app--details-visible'),
        searchActive: !!(search && search.value)
    };
}

function pressEscape() {
    $(document).trigger(
        $.Event('keydown', { keyCode: Keys.DOM_VK_ESCAPE, which: Keys.DOM_VK_ESCAPE })
    );
}

function performBackAction(action, { app, events = Events, root = document } = {}) {
    switch (action) {
        case BackAction.CloseModal:
        case BackAction.CloseDropdown:
            pressEscape();
            break;
        case BackAction.CloseFieldActions:
            events.emit('click', { target: root.body || document.body });
            break;
        case BackAction.ShowList:
            events.emit('toggle-details', false);
            break;
        case BackAction.ClearSearch: {
            const input = root.querySelector('.list__search-field');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.blur();
            break;
        }
        case BackAction.Background:
            app.minimizeApp();
            break;
    }
}

export { BackAction, decideBackAction, readBackState, performBackAction };
