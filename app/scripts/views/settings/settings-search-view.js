import { View } from 'framework/views/view';
import { Keys } from 'const/keys';
import { searchSettings } from 'comp/settings/settings-search';
import template from 'templates/settings/settings-search.hbs';

class SettingsSearchView extends View {
    template = template;

    events = {
        'input .settings__search-field': 'inputChanged',
        'keydown .settings__search-field': 'inputKeyDown',
        'click .settings__search-icon-clear': 'clearClicked',
        'click .settings__search-result': 'resultClicked'
    };

    query = '';
    results = [];
    activeIndex = 0;

    render() {
        super.render({
            query: this.query,
            results: this.results,
            activeIndex: this.activeIndex
        });
        this.inputEl = this.el.querySelector('.settings__search-field');
        return this;
    }

    inputChanged(e) {
        this.setQuery(e.target.value);
    }

    inputKeyDown(e) {
        if (!this.query) {
            return;
        }
        if (e.which === Keys.DOM_VK_DOWN) {
            e.preventDefault();
            this.moveActive(1);
        } else if (e.which === Keys.DOM_VK_UP) {
            e.preventDefault();
            this.moveActive(-1);
        } else if (e.which === Keys.DOM_VK_RETURN || e.which === Keys.DOM_VK_ENTER) {
            e.preventDefault();
            this.activateCurrent();
        }
    }

    resultClicked(e) {
        const button = e.target.closest('.settings__search-result');
        if (!button) {
            return;
        }
        const entry = this.results.find((result) => result.id === button.dataset.id);
        if (entry) {
            this.selectResult(entry);
        }
    }

    clearClicked() {
        this.clear();
        this.focus();
    }

    setQuery(query) {
        this.query = query || '';
        this.results = searchSettings(this.query);
        this.activeIndex = 0;
        this.render();
        this.emit('query-changed', this.query);
        this.focus({ restoreValue: true });
    }

    clear() {
        if (!this.query && !this.results.length) {
            return false;
        }
        this.query = '';
        this.results = [];
        this.activeIndex = 0;
        this.render();
        this.emit('query-changed', this.query);
        return true;
    }

    moveActive(delta) {
        if (!this.results.length) {
            return;
        }
        this.activeIndex = (this.activeIndex + delta + this.results.length) % this.results.length;
        this.render();
        this.focus({ restoreValue: true });
        const active = this.el.querySelector('.settings__search-result--active');
        if (active) {
            active.scrollIntoView({ block: 'nearest' });
        }
    }

    activateCurrent() {
        const entry = this.results[this.activeIndex];
        if (entry) {
            this.selectResult(entry);
        }
    }

    selectResult(entry) {
        this.emit('select', entry);
    }

    focus(options = {}) {
        if (!this.inputEl) {
            return;
        }
        this.inputEl.focus();
        if (options.restoreValue) {
            const value = this.inputEl.value;
            this.inputEl.setSelectionRange(value.length, value.length);
        }
    }
}

export { SettingsSearchView };
