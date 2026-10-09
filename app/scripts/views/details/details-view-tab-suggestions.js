import { fillEntryFromTab, attachWebsiteIcon } from 'comp/browser/entry-from-tab';
import { loadTabOptions } from 'views/list-search-tab-options';
import template from 'templates/details/details-tab-suggestions.hbs';

const DetailsViewTabSuggestions = {
    loadTabSuggestions(entry, load = loadTabOptions) {
        this.tabSuggestions = null;
        return load(this.appModel.files).then(({ suggestions }) => {
            if (this.model === entry && suggestions.length) {
                this.tabSuggestions = { entry, tabs: suggestions };
                this.renderTabSuggestions();
            }
        });
    },

    // Inserted next to the header instead of re-rendering the view: the title of a new
    // entry is being edited while the tabs arrive.
    renderTabSuggestions() {
        this.$el.find('.details__tab-suggestions').remove();
        const state = this.tabSuggestions;
        if (state && state.entry === this.model && !this.model.url) {
            this.$el.find('.details__header').after(template({ tabs: state.tabs }));
            this.pageResized();
        }
    },

    tabSuggestionClick(e) {
        const el = e.target.closest('.details__tab-suggestion');
        const tab = this.tabSuggestions?.tabs[el.dataset.tab];
        if (!tab || this.tabSuggestions.entry !== this.model) {
            return;
        }
        this.tabSuggestions = null;
        fillEntryFromTab(this.model, tab, this.appModel.files);
        this.entryUpdated();
        attachWebsiteIcon(this.model);
    }
};

export { DetailsViewTabSuggestions };
