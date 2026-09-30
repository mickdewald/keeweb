// app/scripts/comp/platform/android/android-back-navigation.js
import { Events } from 'framework/events';
import { Keys } from 'const/keys';

const PANEL_BACK = '.app__panel:not(.hide) .back-button';

const BackAction = {
    CloseModal: 'close-modal',
    CloseDropdown: 'close-dropdown',
    CloseFieldActions: 'close-field-actions',
    ShowWorkspace: 'show-workspace',
    ClosePanel: 'close-panel',
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
    // Settings (incl. About) and panels such as the generator presets are screens of their own.
    if (state.settingsOpen) {
        return BackAction.ShowWorkspace;
    }
    if (state.panelOpen) {
        return BackAction.ClosePanel;
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
        settingsOpen: !!root.querySelector('.settings'),
        panelOpen: !!root.querySelector(PANEL_BACK),
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
        case BackAction.ShowWorkspace:
            // Back to the workspace, or to the open screen when no file is open.
            events.emit('toggle-settings');
            break;
        case BackAction.ClosePanel:
            root.querySelector(PANEL_BACK).click();
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
