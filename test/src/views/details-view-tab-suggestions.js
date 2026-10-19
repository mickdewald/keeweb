import { expect } from 'chai';
import { DetailsViewTabSuggestions } from 'views/details/details-view-tab-suggestions';

function viewFor(model) {
    const view = Object.create(DetailsViewTabSuggestions);
    view.rendered = 0;
    view.model = model;
    view.appModel = { files: [] };
    view.renderTabSuggestions = () => view.rendered++;
    return view;
}

describe('DetailsViewTabSuggestions', () => {
    const tabs = [{ title: 'Kaufland', url: 'https://www.kaufland.de/', host: 'www.kaufland.de' }];

    it('offers the open tabs for the entry that was just created', async () => {
        const entry = { id: '1' };
        const view = viewFor(entry);
        await view.loadTabSuggestions(entry, async () => ({ suggestions: tabs }));
        expect(view.tabSuggestions).to.eql({ entry, tabs });
        expect(view.rendered).to.eql(1);
    });

    it('offers nothing without tabs or when another entry is shown meanwhile', async () => {
        const entry = { id: '1' };
        const view = viewFor(entry);
        await view.loadTabSuggestions(entry, async () => ({ suggestions: [] }));
        expect(view.tabSuggestions).to.eql(null);

        const pending = view.loadTabSuggestions(entry, async () => ({ suggestions: tabs }));
        view.model = { id: '2' };
        await pending;
        expect(view.tabSuggestions).to.eql(null);
        expect(view.rendered).to.eql(0);
    });

    it('ignores a click when the suggestions belong to another entry', () => {
        const view = viewFor({ id: '2' });
        view.tabSuggestions = { entry: { id: '1' }, tabs };
        view.entryUpdated = () => {
            throw new Error('must not update');
        };
        const el = { dataset: { tab: '0' } };
        view.tabSuggestionClick({ target: { closest: () => el } });
        expect(view.tabSuggestions.tabs).to.eql(tabs);
    });
});
