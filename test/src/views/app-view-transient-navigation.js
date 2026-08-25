import { expect } from 'chai';
import { AppView } from 'views/app-view';
import { ListSearchView } from 'views/list-search-view';
import { MenuModel } from 'models/menu/menu-model';
import { Events } from 'framework/events';

function workspaceState() {
    return {
        filter: {
            text: 'bank',
            textLower: 'bank',
            tag: 'Finance',
            advanced: { title: true, notes: false }
        },
        sort: 'title',
        activeEntryId: 'bank-entry'
    };
}

function appViewWithTrashOpen() {
    const trashItem = { filterKey: 'trash', filterValue: true };
    const workspaceItem = { filterKey: 'tag', filterValue: 'Finance' };
    const state = workspaceState();
    state.menuSelection = { item: workspaceItem };
    const selectedItems = [];
    const view = Object.assign(Object.create(AppView.prototype), {
        model: {
            filter: { trash: true },
            sort: 'updated',
            activeEntryId: 'deleted-entry',
            menu: {
                trashItem,
                select({ item }) {
                    selectedItems.push(item);
                }
            },
            setFilter(filter) {
                this.filter = filter;
            }
        },
        views: {},
        workspaceReturnState: state,
        showEntries() {}
    });
    return { selectedItems, state, trashItem, view, workspaceItem };
}

describe('AppView transient navigation', () => {
    it('shows a programmatically restored search term in the search field', () => {
        let searchValue = '';
        const chain = {
            length: 0,
            toggleClass() {
                return this;
            },
            attr() {
                return this;
            }
        };
        const view = {
            inputEl: {
                val(value) {
                    if (arguments.length) {
                        searchValue = value;
                    }
                    return searchValue;
                }
            },
            model: {},
            sortIcons: {},
            advancedSearchEnabled: false,
            hideSearchOptions() {},
            $el: { find: () => chain }
        };

        ListSearchView.prototype.filterChanged.call(view, {
            filter: { text: 'Bank' },
            sort: 'title'
        });

        expect(searchValue).to.equal('Bank');
    });

    it('returns from Trash to the complete previous workspace view', () => {
        const { selectedItems, state, trashItem, view, workspaceItem } = appViewWithTrashOpen();

        AppView.prototype.menuSelect.call(view, { item: trashItem });

        expect(view.model.filter).to.deep.equal(state.filter);
        expect(view.model.sort).to.equal(state.sort);
        expect(view.model.activeEntryId).to.equal(state.activeEntryId);
        expect(selectedItems).to.deep.equal([workspaceItem]);
    });

    it('restores the active workspace item in the real menu model', () => {
        const menu = new MenuModel();
        const view = Object.assign(Object.create(AppView.prototype), {
            model: {
                filter: { trash: true },
                sort: 'updated',
                activeEntryId: 'deleted-entry',
                menu,
                setFilter(filter) {
                    this.filter = filter;
                }
            },
            views: {},
            workspaceReturnState: {
                ...workspaceState(),
                menuSelection: { item: menu.allItemsItem }
            },
            showEntries() {}
        });

        menu.select({ item: menu.trashItem });
        expect(menu.allItemsItem.active).to.equal(false);

        AppView.prototype.menuSelect.call(view, { item: menu.trashItem });

        expect(menu.allItemsItem.active).to.equal(true);
        expect(view.model.filter).to.deep.equal(workspaceState().filter);
    });

    it('switches back to the app menu before opening Trash from Settings', () => {
        const trashItem = { filterKey: 'trash', filterValue: true };
        let menuMode = 'settings';
        let modeAtSelection;
        const view = Object.assign(Object.create(AppView.prototype), {
            model: {
                filter: { text: 'Bank' },
                sort: 'title',
                activeEntryId: 'bank-entry',
                files: { hasOpenFiles: () => true },
                menu: {
                    trashItem,
                    menus: { app: [] },
                    select() {
                        modeAtSelection = menuMode;
                    }
                }
            },
            views: { settings: {} },
            showEntries() {
                menuMode = 'app';
                this.views.settings = null;
            }
        });

        AppView.prototype.menuSelect.call(view, { item: trashItem });

        expect(modeAtSelection).to.equal('app');
    });

    it('applies a normal workspace shortcut after leaving the real Settings menu', () => {
        const menu = new MenuModel();
        menu.setMenu('settings');
        let emittedFilter;
        const onFilter = (filter) => {
            emittedFilter = filter;
        };
        Events.once('set-filter', onFilter);
        const view = Object.assign(Object.create(AppView.prototype), {
            model: { menu },
            views: { settings: {} },
            workspaceReturnState: workspaceState(),
            showEntries() {
                menu.setMenu('app');
                this.views.settings = null;
            }
        });

        AppView.prototype.menuSelect.call(view, { item: menu.allItemsItem });

        expect(menu.sections).to.equal(menu.menus.app);
        expect(emittedFilter).to.deep.equal({ '*': null });
        expect(view.workspaceReturnState).to.equal(null);
    });

    it('leaves the real Settings menu before restoring its workspace selection', () => {
        const menu = new MenuModel();
        menu.setMenu('settings');
        const state = { ...workspaceState(), menuSelection: { item: menu.allItemsItem } };
        const view = Object.assign(Object.create(AppView.prototype), {
            model: {
                menu,
                filter: { trash: true },
                setFilter(filter) {
                    this.filter = filter;
                }
            },
            views: { settings: {} },
            workspaceReturnState: state,
            showEntries() {
                menu.setMenu('app');
                this.views.settings = null;
            }
        });

        AppView.prototype.returnToWorkspace.call(view);

        expect(menu.sections).to.equal(menu.menus.app);
        expect(menu.allItemsItem.active).to.equal(true);
        expect(view.model.filter).to.deep.equal(state.filter);
    });

    it('keeps the original return target across transient views', () => {
        const menu = new MenuModel();
        const original = workspaceState();
        const view = Object.assign(Object.create(AppView.prototype), {
            model: {
                ...original,
                menu,
                files: { hasOpenFiles: () => true }
            },
            workspaceReturnState: null
        });

        AppView.prototype.rememberWorkspaceView.call(view);
        const remembered = view.workspaceReturnState;
        view.model.filter = { trash: true };
        AppView.prototype.rememberWorkspaceView.call(view);

        expect(view.workspaceReturnState).to.equal(remembered);
        expect(view.workspaceReturnState.filter).to.deep.equal(original.filter);
    });

    it('clears the return target after a deliberate normal workspace selection', () => {
        const menu = new MenuModel();
        const view = Object.assign(Object.create(AppView.prototype), {
            model: { menu },
            views: {},
            workspaceReturnState: workspaceState()
        });

        AppView.prototype.menuSelect.call(view, { item: menu.allItemsItem });

        expect(view.workspaceReturnState).to.equal(null);
    });

    it('returns from Settings to the workspace view saved before Trash', () => {
        const { state, view } = appViewWithTrashOpen();
        view.views.settings = { page: 'general' };
        view.model.files = { hasOpenFiles: () => true };

        AppView.prototype.toggleSettings.call(view, false);

        expect(view.model.filter).to.deep.equal(state.filter);
        expect(view.model.sort).to.equal(state.sort);
        expect(view.model.activeEntryId).to.equal(state.activeEntryId);
    });

    it('returns from Health to the workspace view that was active when Health opened', () => {
        const state = workspaceState();
        const model = {
            filter: state.filter,
            sort: state.sort,
            activeEntryId: state.activeEntryId,
            files: { hasOpenFiles: () => true },
            setFilter(filter) {
                this.filter = filter;
            }
        };
        const view = Object.assign(Object.create(AppView.prototype), {
            model,
            views: {},
            hideOpenFile() {},
            hideSettings() {},
            hideKeyChange() {},
            showEntries() {},
            showPanelView(panel) {
                this.views.panel = panel;
            }
        });

        AppView.prototype.showPasswordHealth.call(view);
        model.filter = { trash: true };
        model.sort = 'updated';
        model.activeEntryId = 'deleted-entry';
        view.views.panel.emit('close');

        expect(model.filter).to.deep.equal(state.filter);
        expect(model.sort).to.equal(state.sort);
        expect(model.activeEntryId).to.equal(state.activeEntryId);
    });

    it('keeps the existing no-open-file Settings return behavior', () => {
        let showedLastOpenFile = false;
        let toggledMore = false;
        const view = Object.assign(Object.create(AppView.prototype), {
            model: { files: { hasOpenFiles: () => false }, menu: {} },
            views: {
                settings: { page: 'general' },
                open: { toggleMore: () => (toggledMore = true) }
            },
            showLastOpenFile() {
                showedLastOpenFile = true;
            }
        });

        AppView.prototype.toggleSettings.call(view, false);

        expect(showedLastOpenFile).to.equal(true);
        expect(toggledMore).to.equal(true);
    });
});
