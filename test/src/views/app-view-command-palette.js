import { expect } from 'chai';
import { AppView } from 'views/app-view';
import { SelectEntryView } from 'views/select/select-entry-view';

describe('AppView command palette', () => {
    it('delegates an entry-selection result to the shared navigation path', () => {
        const entry = { id: 'target-entry' };
        const navigatedEntries = [];
        const view = {
            model: {
                files: { hasOpenFiles: () => true }
            },
            views: { cmdPalette: null },
            selectCmdPaletteEntry() {},
            navigateToEntry(selected) {
                navigatedEntries.push(selected);
            }
        };
        const previousRender = SelectEntryView.prototype.render;
        const previousRemove = SelectEntryView.prototype.remove;

        SelectEntryView.prototype.render = function () {
            return this;
        };
        SelectEntryView.prototype.remove = function () {
            this.emit('remove');
            this.removed = true;
        };

        try {
            AppView.prototype.showCmdPalette.call(view);
            view.views.cmdPalette.emit('result', { entry, select: true });
        } finally {
            SelectEntryView.prototype.render = previousRender;
            SelectEntryView.prototype.remove = previousRemove;
        }

        expect(navigatedEntries).to.deep.equal([entry]);
        expect(view.views.cmdPalette).to.equal(null);
    });
});
