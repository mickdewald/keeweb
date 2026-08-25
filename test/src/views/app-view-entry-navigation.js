import { expect } from 'chai';
import { Events } from 'framework/events';
import { AppView } from 'views/app-view';

function entriesContaining(entry, visible) {
    return {
        get(id) {
            return visible && id === entry.id ? entry : undefined;
        }
    };
}

function currentEntryModel(entry, properties) {
    return {
        files: [],
        getEntriesByFilter: () => entriesContaining(entry, true),
        ...properties
    };
}

function recordSelectedEntry(calls, receiveEntry) {
    const listener = (entry) => {
        calls.push('select-entry');
        receiveEntry(entry);
    };
    Events.on('select-entry', listener);
    return () => Events.off('select-entry', listener);
}

describe('AppView entry navigation', () => {
    it('returns to the workspace before selecting an already visible entry', () => {
        const entry = { id: 'target-entry' };
        const calls = [];
        const menuSelections = [];
        const resetFilters = [];
        let selectedEntry;
        const view = {
            model: currentEntryModel(entry, {
                getEntries() {
                    calls.push('getEntries:visible');
                    return entriesContaining(entry, true);
                },
                menu: {
                    allItemsItem: { id: 'all-items' },
                    select(selection) {
                        menuSelections.push(selection);
                    }
                },
                setFilter(filter) {
                    resetFilters.push(filter);
                }
            }),
            showEntries() {
                calls.push('showEntries');
            },
            restoreWorkspaceView() {
                calls.push('restoreWorkspaceView');
            }
        };
        const removeListener = recordSelectedEntry(calls, (selected) => {
            selectedEntry = selected;
        });

        try {
            AppView.prototype.navigateToEntry?.call(view, entry);
        } finally {
            removeListener();
        }

        expect(calls).to.deep.equal([
            'showEntries',
            'restoreWorkspaceView',
            'getEntries:visible',
            'select-entry'
        ]);
        expect(menuSelections).to.deep.equal([]);
        expect(resetFilters).to.deep.equal([]);
        expect(selectedEntry).to.equal(entry);
    });

    it('selects All Items when the restored workspace hides the destination', () => {
        const entry = { id: 'target-entry' };
        const calls = [];
        const menuSelections = [];
        const resetFilters = [];
        const allItemsItem = { id: 'all-items' };
        let visible = false;
        let selectedEntry;
        const view = {
            model: currentEntryModel(entry, {
                filter: { trash: true },
                sort: 'updated',
                getEntries() {
                    calls.push(visible ? 'getEntries:visible' : 'getEntries:hidden');
                    return entriesContaining(entry, visible);
                },
                menu: {
                    allItemsItem,
                    select(selection) {
                        calls.push('menu:all-items');
                        menuSelections.push(selection);
                        visible = true;
                    }
                },
                setFilter(filter) {
                    resetFilters.push(filter);
                }
            }),
            showEntries() {
                calls.push('showEntries');
            },
            restoreWorkspaceView() {
                calls.push('restoreWorkspaceView');
                expect(this.model.filter).to.deep.equal({ trash: true });
                expect(this.model.sort).to.equal('updated');
            }
        };
        const removeListener = recordSelectedEntry(calls, (selected) => {
            selectedEntry = selected;
        });

        try {
            AppView.prototype.navigateToEntry?.call(view, entry);
        } finally {
            removeListener();
        }

        expect(calls).to.deep.equal([
            'showEntries',
            'restoreWorkspaceView',
            'getEntries:hidden',
            'menu:all-items',
            'getEntries:visible',
            'select-entry'
        ]);
        expect(menuSelections).to.deep.equal([{ item: allItemsItem }]);
        expect(resetFilters).to.deep.equal([]);
        expect(selectedEntry).to.equal(entry);
    });

    it('clears an attachment filter only when All Items still hides the destination', () => {
        const entry = { id: 'target-entry' };
        const calls = [];
        const menuSelections = [];
        const resetFilters = [];
        const allItemsItem = { id: 'all-items' };
        let visible = false;
        let selectedEntry;
        const view = {
            model: currentEntryModel(entry, {
                getEntries() {
                    calls.push(visible ? 'getEntries:visible' : 'getEntries:hidden');
                    return entriesContaining(entry, visible);
                },
                menu: {
                    allItemsItem,
                    select(selection) {
                        calls.push('menu:all-items');
                        menuSelections.push(selection);
                    }
                },
                setFilter(filter) {
                    calls.push('filter:no-attachments');
                    resetFilters.push(filter);
                    visible = true;
                }
            }),
            showEntries() {
                calls.push('showEntries');
            },
            restoreWorkspaceView() {
                calls.push('restoreWorkspaceView');
            }
        };
        const removeListener = recordSelectedEntry(calls, (selected) => {
            selectedEntry = selected;
        });

        try {
            AppView.prototype.navigateToEntry?.call(view, entry);
        } finally {
            removeListener();
        }

        expect(calls).to.deep.equal([
            'showEntries',
            'restoreWorkspaceView',
            'getEntries:hidden',
            'menu:all-items',
            'getEntries:hidden',
            'filter:no-attachments',
            'select-entry'
        ]);
        expect(menuSelections).to.deep.equal([{ item: allItemsItem }]);
        expect(resetFilters).to.deep.equal([{ attachments: false }]);
        expect(selectedEntry).to.equal(entry);
    });

    it('navigates from a transient view without saved workspace state', () => {
        const entry = { id: 'target-entry' };
        const calls = [];
        let selectedEntry;
        const view = {
            model: currentEntryModel(entry, {
                getEntries: () => entriesContaining(entry, true),
                menu: { allItemsItem: { id: 'all-items' } }
            }),
            showEntries() {
                calls.push('showEntries');
            },
            restoreWorkspaceView() {
                calls.push('restoreWorkspaceView:none');
                return false;
            }
        };
        const removeListener = recordSelectedEntry(calls, (selected) => {
            selectedEntry = selected;
        });

        try {
            AppView.prototype.navigateToEntry?.call(view, entry);
        } finally {
            removeListener();
        }

        expect(calls).to.deep.equal([
            'showEntries',
            'restoreWorkspaceView:none',
            'select-entry'
        ]);
        expect(selectedEntry).to.equal(entry);
    });

    it('restores the workspace before navigating from Password Health', () => {
        const entry = { id: 'weak-entry' };
        const workspaceFilter = { tag: 'saved-tag' };
        let filterWhenSelected;
        let selectionCount = 0;
        const model = currentEntryModel(entry, {
            filter: workspaceFilter,
            sort: 'title',
            activeEntryId: 'saved-entry',
            files: { hasOpenFiles: () => true },
            menu: { menus: { app: [] } },
            setFilter(filter) {
                this.filter = filter;
            },
            getEntries: () => entriesContaining(entry, true)
        });
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
        const listener = () => {
            selectionCount++;
            filterWhenSelected = model.filter;
        };

        Events.on('select-entry', listener);
        try {
            AppView.prototype.showPasswordHealth.call(view);
            model.filter = { trash: true };
            model.sort = 'updated';
            model.activeEntryId = 'deleted-entry';
            view.views.panel.emit('select', entry);
        } finally {
            Events.off('select-entry', listener);
        }

        expect(filterWhenSelected.tag).to.equal(workspaceFilter.tag);
        expect(filterWhenSelected.trash).to.equal(undefined);
        expect(selectionCount).to.equal(1);
        expect(model.sort).to.equal('title');
        expect(view.workspaceReturnState).to.equal(null);
    });
});
