import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { Keys } from 'const/keys';
import { Scrollable } from 'framework/views/scrollable';
import { StringFormat } from 'util/formatting/string-format';
import { SettingsSearchView } from 'views/settings/settings-search-view';
import template from 'templates/settings/settings.hbs';

class SettingsView extends View {
    parent = '.app__body';

    template = template;

    events = {
        'click .settings__back-button': 'returnToApp'
    };

    pendingTarget = null;

    constructor(model, options) {
        super(model, options);
        this.initScroll();
        this.listenTo(Events, 'set-page', this.setPage);
        this.onKey(Keys.DOM_VK_ESCAPE, this.returnToApp);
    }

    render() {
        super.render();
        this.createScroll({
            root: this.$el.find('.settings')[0],
            scroller: this.$el.find('.scroller')[0],
            bar: this.$el.find('.scroller__bar')[0]
        });
        this.pageEl = this.$el.find('.scroller');
        this.renderSearch();
    }

    renderSearch() {
        if (this.views.search) {
            this.views.search.remove();
        }
        this.views.search = new SettingsSearchView(undefined, {
            parent: this.$el.find('.settings__search-host')[0]
        });
        this.views.search.on('select', (entry) => this.openSearchResult(entry));
        this.views.search.on('query-changed', (query) => this.searchQueryChanged(query));
        this.views.search.render();
    }

    searchQueryChanged(query) {
        this.pageEl.toggleClass('hide', !!query);
        this.$el.find('.scroller__bar-wrapper').toggleClass('hide', !!query);
        if (!query) {
            this.pageResized();
        }
    }

    openSearchResult(entry) {
        this.pendingTarget = entry.target || null;
        const menuItem = this.findSettingsMenuItem(entry.page, entry.section);
        this.views.search.clear();
        if (menuItem) {
            this.model.menu.select({ item: menuItem });
        } else {
            Events.emit('set-page', {
                page: entry.page,
                section: entry.section,
                target: entry.target
            });
        }
    }

    findSettingsMenuItem(page, section) {
        const settingsMenu = this.model && this.model.menu && this.model.menu.menus.settings;
        if (!settingsMenu) {
            return null;
        }
        let pageFallback = null;
        for (const menuSection of settingsMenu) {
            if (!menuSection.items) {
                continue;
            }
            for (const item of menuSection.items) {
                if (item.page !== page) {
                    continue;
                }
                if (section && item.section === section) {
                    return item;
                }
                if (!pageFallback && (!item.section || item.section === 'top')) {
                    pageFallback = item;
                }
            }
        }
        return pageFallback;
    }

    setPage(e) {
        let { page, section, file } = e;
        const target = e.target || this.pendingTarget;
        this.pendingTarget = null;
        if (page === 'file' && file && file.backend === 'otp-device') {
            page = 'file-otp-device';
        }
        const module = require('./settings-' + page + '-view');
        const viewName = StringFormat.pascalCase(page);
        const SettingsPageView = module[`Settings${viewName}View`];
        if (this.views.page) {
            this.views.page.remove();
        }
        this.views.page = new SettingsPageView(file, { parent: this.pageEl[0] });
        this.views.page.appModel = this.model;
        this.views.page.render();
        this.file = file;
        this.page = page;
        this.pageResized();
        if (target) {
            this.highlightTarget(target);
        } else {
            this.scrollToSection(section);
        }
    }

    scrollToSection(section) {
        if (section && section !== 'top') {
            const scrollEl = this.views.page.el.querySelector(`#${section}`);
            if (scrollEl) {
                scrollEl.scrollIntoView({ block: 'start', inline: 'nearest' });
                return;
            }
        }
        this.pageEl.scrollTop(0);
    }

    highlightTarget(selector) {
        const pageEl = this.views.page && this.views.page.el;
        if (!pageEl || !selector) {
            return;
        }
        const el = pageEl.querySelector(selector);
        if (!el) {
            this.scrollToSection();
            return;
        }
        const advanced = pageEl.querySelector('.settings__general-advanced');
        if (
            advanced &&
            advanced.contains(el) &&
            advanced.classList.contains('hide') &&
            this.views.page.showAdvancedSettings
        ) {
            this.views.page.showAdvancedSettings();
        }
        const hit = el.closest('.settings__check-row, .settings__field, .settings__section') || el;
        pageEl
            .querySelectorAll('.settings__search-hit')
            .forEach((node) => node.classList.remove('settings__search-hit'));
        hit.classList.add('settings__search-hit');
        hit.scrollIntoView({ block: 'center', inline: 'nearest' });
        window.setTimeout(() => {
            hit.classList.remove('settings__search-hit');
        }, 2200);
    }

    returnToApp() {
        if (this.views.search && this.views.search.clear()) {
            this.views.search.focus();
            return;
        }
        Events.emit('toggle-settings', false);
    }
}

Object.assign(SettingsView.prototype, Scrollable);

export { SettingsView };
