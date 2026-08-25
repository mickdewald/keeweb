import { expect } from 'chai';
import { Events } from 'framework/events';
import { AppView } from 'views/app-view';

function entriesContaining(entry) {
    return {
        get(id) {
            return entry?.id === id ? entry : undefined;
        }
    };
}

function navigationFixture(authoritativeEntry, visibleEntry = authoritativeEntry) {
    const calls = [];
    return {
        calls,
        view: {
            model: {
                files: [],
                getEntriesByFilter() {
                    return entriesContaining(authoritativeEntry);
                },
                getEntries() {
                    return entriesContaining(visibleEntry);
                },
                menu: {
                    allItemsItem: { id: 'all-items' },
                    select() {
                        calls.push('menu-select');
                    }
                },
                setFilter() {
                    calls.push('set-filter');
                }
            },
            showEntries() {
                calls.push('showEntries');
            },
            restoreWorkspaceView() {
                calls.push('restoreWorkspaceView');
            }
        }
    };
}

describe('AppView entry navigation lifecycle', () => {
    it('ignores a missing entry without changing workspace state', () => {
        const { view, calls } = navigationFixture(undefined);
        let error;

        try {
            AppView.prototype.navigateToEntry.call(view, null);
        } catch (caught) {
            error = caught;
        }

        expect(error).to.equal(undefined);
        expect(calls).to.deep.equal([]);
    });

    it('ignores an entry removed by sync without changing workspace state', () => {
        const staleEntry = { id: 'removed-entry' };
        const { view, calls } = navigationFixture(undefined);
        const selectedEntries = [];
        const listener = (entry) => selectedEntries.push(entry);

        Events.on('select-entry', listener);
        try {
            AppView.prototype.navigateToEntry.call(view, staleEntry);
        } finally {
            Events.off('select-entry', listener);
        }

        expect(calls).to.deep.equal([]);
        expect(selectedEntries).to.deep.equal([]);
    });

    it('selects the current entry object after a background reload', () => {
        const staleEntry = { id: 'reloaded-entry', revision: 'stale' };
        const currentEntry = { id: staleEntry.id, revision: 'current' };
        const { view } = navigationFixture(currentEntry);
        const selectedEntries = [];
        const listener = (entry) => selectedEntries.push(entry);

        Events.on('select-entry', listener);
        try {
            AppView.prototype.navigateToEntry.call(view, staleEntry);
        } finally {
            Events.off('select-entry', listener);
        }

        expect(selectedEntries).to.deep.equal([currentEntry]);
    });
});
