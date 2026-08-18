import { expect } from 'chai';
import { AppView } from 'views/app-view';

describe('AppView command palette', () => {
    it('selects an opened command-palette entry through the visible list', () => {
        const entry = { id: 'target-entry' };
        let selectedEntry;
        const view = {
            model: {
                getEntries() {
                    return { get: (id) => (id === entry.id ? entry : undefined) };
                }
            },
            views: {
                list: {
                    selectItem(item) {
                        selectedEntry = item;
                    }
                }
            }
        };

        AppView.prototype.selectCmdPaletteEntry?.call(view, entry);

        expect(selectedEntry).to.equal(entry);
    });
});
