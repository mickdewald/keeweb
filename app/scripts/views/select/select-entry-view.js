import { View, DefaultTemplateOptions } from 'framework/views/view';
import { Events } from 'framework/events';
import { Shortcuts } from 'comp/app/shortcuts';
import { KeyHandler } from 'comp/browser/key-handler';
import { Keys } from 'const/keys';
import { AppSettingsModel } from 'models/app-settings-model';
import { EntryPresenter } from 'presenters/entry-presenter';
import { StringFormat } from 'util/formatting/string-format';
import { UrlFormat } from 'util/formatting/url-format';
import { Locale } from 'util/locale';
import { Tip } from 'util/ui/tip';
import { Scrollable } from 'framework/views/scrollable';
import { DropdownView } from 'views/dropdown-view';
import { buildItemOptions, itemOptionsPosition } from 'views/select/select-entry-item-options';
import template from 'templates/select/select-entry.hbs';
import itemTemplate from 'templates/select/select-entry-item.hbs';

class SelectEntryView extends View {
    parent = 'body';
    modal = 'select-entry';

    template = template;

    itemTemplate = itemTemplate;

    events = {
        'click .select-entry__header-filter-clear': 'clearFilterText',
        'click .select-entry__item': 'itemClicked',
        'contextmenu .select-entry__item': 'itemRightClicked',
        'click .select-entry__filter': 'filterClicked',
        'click .select-entry__cancel-btn': 'cancelClicked',
        'mousedown .select-entry__panel-resize': 'resizeMouseDown',
        'input .select-entry__search-field': 'searchInput',
        'click': 'backgroundClick'
    };

    result = null;
    entries = null;

    constructor(model) {
        super(model);
        this.initScroll();
        this.listenTo(Events, 'main-window-blur', this.mainWindowBlur);
        if (this.model.isAutoType) {
            this.listenTo(Events, 'keypress:select-entry', this.keyPressed);
        }
        this.setupKeys();
    }

    setupKeys() {
        this.onKey(Keys.DOM_VK_ESCAPE, this.escPressed, false, 'select-entry');
        this.onKey(Keys.DOM_VK_RETURN, this.enterPressed, false, 'select-entry');
        if (this.model.isAutoType) {
            this.onKey(
                Keys.DOM_VK_RETURN,
                this.actionEnterPressed,
                KeyHandler.SHORTCUT_ACTION,
                'select-entry'
            );
            this.onKey(
                Keys.DOM_VK_RETURN,
                this.optEnterPressed,
                KeyHandler.SHORTCUT_OPT,
                'select-entry'
            );
            this.onKey(
                Keys.DOM_VK_RETURN,
                this.shiftEnterPressed,
                KeyHandler.SHORTCUT_SHIFT,
                'select-entry'
            );
            this.onKey(
                Keys.DOM_VK_O,
                this.openKeyPressed,
                KeyHandler.SHORTCUT_ACTION,
                'select-entry'
            );
            this.onKey(Keys.DOM_VK_BACK_SPACE, this.backSpacePressed, false, 'select-entry');
        }
        this.onKey(Keys.DOM_VK_UP, this.upPressed, false, 'select-entry');
        this.onKey(Keys.DOM_VK_DOWN, this.downPressed, false, 'select-entry');
    }

    render() {
        const noColor = AppSettingsModel.colorfulIcons ? '' : 'grayscale';

        this.entries = this.model.filter.getEntries();
        this.syncActiveResult();
        const itemsHtml = this.buildItemsHtml(noColor);

        const filters = [];
        if (this.model.filter.url) {
            const shortUrl = UrlFormat.presentAsShortUrl(this.model.filter.url);
            filters.push({
                id: 'url',
                type: StringFormat.capFirst(Locale.website),
                text: shortUrl,
                active: this.model.filter.useUrl
            });

            filters.push({
                id: 'subdomains',
                type: StringFormat.capFirst(Locale.selectEntrySubdomains),
                active: this.model.filter.useUrl && this.model.filter.subdomains
            });
        }
        if (this.model.filter.title) {
            filters.push({
                id: 'title',
                type: StringFormat.capFirst(Locale.title),
                text: this.model.filter.title,
                active: this.model.filter.useTitle
            });
        }
        if (this.model.filter.text) {
            filters.push({
                id: 'text',
                type: StringFormat.capFirst(Locale.selectEntryContains),
                text: this.model.filter.text,
                active: true
            });
        }

        super.render({
            isAutoType: this.model.isAutoType,
            searchText: this.model.filter.text,
            topMessage: this.model.topMessage,
            filters,
            itemsHtml,
            actionSymbol: Shortcuts.actionShortcutSymbol(true),
            altSymbol: Shortcuts.altShortcutSymbol(true),
            shiftSymbol: Shortcuts.shiftShortcutSymbol(true),
            keyEnter: Locale.keyEnter,
            keyEsc: Locale.keyEsc
        });

        if (this.model.isAutoType) {
            document.activeElement.blur();
        } else {
            const panel = this.$el.find('.select-entry__panel')[0];
            if (panel && AppSettingsModel.cmdPaletteWidth) {
                panel.style.width = AppSettingsModel.cmdPaletteWidth + 'px';
            }
            this.focusSearchField();
        }

        this.createScroll({
            root: this.$el.find('.select-entry__items')[0],
            scroller: this.$el.find('.scroller')[0],
            bar: this.$el.find('.scroller__bar')[0]
        });
    }

    buildItemsHtml(noColor) {
        const presenter = new EntryPresenter(null, noColor, this.result?.id);
        presenter.itemOptions = this.model.itemOptions;
        presenter.searchTerms = this.model.filter.text
            ? this.model.filter.text.toLowerCase().split(/\s+/).filter(Boolean)
            : null;
        let itemsHtml = '';
        this.entries.forEach((entry) => {
            presenter.present(entry);
            itemsHtml += this.itemTemplate(presenter, DefaultTemplateOptions);
        });
        return itemsHtml;
    }

    syncActiveResult() {
        if (!this.result || !this.entries.includes(this.result)) {
            this.result = this.entries[0];
        }
    }

    focusSearchField() {
        const input = this.$el.find('.select-entry__search-field')[0];
        if (!input) {
            return;
        }
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
    }

    searchInput(e) {
        this.model.filter.text = e.target.value;
        this.showPaletteHint(this.model.topMessage);
        this.refreshItems();
    }

    refreshItems() {
        const noColor = AppSettingsModel.colorfulIcons ? '' : 'grayscale';
        this.entries = this.model.filter.getEntries();
        this.syncActiveResult();
        const itemsHtml = this.buildItemsHtml(noColor);
        const scroller = this.$el.find('.select-entry__items .scroller');
        Tip.destroyTips(scroller[0]);
        if (itemsHtml) {
            scroller.html(`<table class="select-entry__table">${itemsHtml}</table>`);
        } else {
            scroller.html(
                `<div class="select-entry__empty-title muted-color">${Locale.autoTypeNoMatches}</div>`
            );
        }
        Tip.createTips(scroller[0]);
        this.createScroll({
            root: this.$el.find('.select-entry__items')[0],
            scroller: this.$el.find('.scroller')[0],
            bar: this.$el.find('.scroller__bar')[0]
        });
    }

    showPaletteHint(msg) {
        const footer = this.$el.find('.select-entry__footer');
        if (footer.length) {
            footer.text(msg);
        }
    }

    resizeMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        const panel = this.$el.find('.select-entry__panel')[0];
        if (!panel) {
            return;
        }
        const rect = panel.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const onMove = (moveEvent) => {
            const width = Math.min(
                Math.max(2 * Math.abs(moveEvent.clientX - centerX), 480),
                window.innerWidth - 48
            );
            panel.style.width = width + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            AppSettingsModel.cmdPaletteWidth = Math.round(panel.getBoundingClientRect().width);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    backgroundClick(e) {
        const hasPanel = this.$el.find('.select-entry__panel').length;
        if (hasPanel && !e.target.closest('.select-entry__panel')) {
            this.cancelAndClose();
        }
    }

    cancelAndClose() {
        this.result = null;
        this.emit('result', this.result);
    }

    closeWithResult(sequence) {
        this.emit('result', {
            entry: this.result,
            sequence
        });
    }

    closeWithSelection() {
        this.emit('result', {
            entry: this.result,
            select: true
        });
    }

    escPressed() {
        this.cancelAndClose();
    }

    enterPressed() {
        if (!this.model.isAutoType && !this.result) {
            this.showPaletteHint(Locale.cmdPaletteNoMatch);
            return;
        }
        if (!this.model.isAutoType) {
            this.closeWithSelection();
            return;
        }
        this.closeWithResult();
    }

    actionEnterPressed() {
        this.closeWithResult('{PASSWORD}');
    }

    optEnterPressed() {
        this.closeWithResult('{USERNAME}');
    }

    openKeyPressed() {
        this.emit('show-open-files');
    }

    shiftEnterPressed(e) {
        const activeItem = this.$el.find('.select-entry__item[data-id="' + this.result.id + '"]');
        this.showItemOptions(activeItem, e);
    }

    upPressed(e) {
        e.preventDefault();
        const activeIndex = this.entries.indexOf(this.result) - 1;
        if (activeIndex >= 0) {
            this.result = this.entries[activeIndex];
            this.highlightActive();
        }
    }

    downPressed(e) {
        e.preventDefault();
        const activeIndex = this.entries.indexOf(this.result) + 1;
        if (activeIndex < this.entries.length) {
            this.result = this.entries[activeIndex];
            this.highlightActive();
        }
    }

    highlightActive() {
        this.$el.find('.select-entry__item').removeClass('select-entry__item--active');
        const activeItem = this.$el.find('.select-entry__item[data-id="' + this.result.id + '"]');
        activeItem.addClass('select-entry__item--active');
        const itemRect = activeItem[0].getBoundingClientRect();
        const listRect = this.scroller[0].getBoundingClientRect();
        if (itemRect.top < listRect.top) {
            this.scroller[0].scrollTop += itemRect.top - listRect.top;
        } else if (itemRect.bottom > listRect.bottom) {
            this.scroller[0].scrollTop += itemRect.bottom - listRect.bottom;
        }
    }

    mainWindowBlur() {
        this.emit('result', undefined);
    }

    keyPressed(e) {
        if (e.which && e.which !== Keys.DOM_VK_RETURN) {
            this.model.filter.text += String.fromCharCode(e.which);
            this.render();
        }
    }

    backSpacePressed() {
        if (this.model.filter.text) {
            this.model.filter.text = this.model.filter.text.substr(
                0,
                this.model.filter.text.length - 1
            );
            this.render();
        }
    }

    clearFilterText() {
        this.model.filter.text = '';
        this.render();
    }

    itemClicked(e) {
        const itemEl = $(e.target).closest('.select-entry__item');
        const optionsClicked = $(e.target).closest('.select-entry__item-options').length;

        if (optionsClicked) {
            this.showItemOptions(itemEl, e);
        } else {
            const id = itemEl.data('id');
            this.result = this.entries.get(id);
            if (this.model.isAutoType) {
                this.closeWithResult();
            } else {
                this.closeWithSelection();
            }
        }
    }

    itemRightClicked(e) {
        const itemEl = $(e.target).closest('.select-entry__item');
        this.showItemOptions(itemEl, e);
    }

    showItemOptions(itemEl, event) {
        if (event) {
            event.stopImmediatePropagation();
        }
        if (!this.model.itemOptions) {
            return;
        }

        const id = itemEl.data('id');
        const entry = this.entries.get(id);

        if (this.views.optionsDropdown) {
            this.hideItemOptionsDropdown();
            if (this.result && this.result.id === entry.id) {
                return;
            }
        }

        this.result = entry;
        if (!itemEl.hasClass('select-entry__item--active')) {
            this.highlightActive();
        }

        const view = new DropdownView({ selectedOption: 0 });
        this.listenTo(view, 'cancel', this.hideItemOptionsDropdown);
        this.listenTo(view, 'select', this.itemOptionsDropdownSelect);

        view.render({
            position: itemOptionsPosition(itemEl, event),
            options: buildItemOptions(entry)
        });

        this.views.optionsDropdown = view;
    }

    hideItemOptionsDropdown() {
        if (this.views.optionsDropdown) {
            this.views.optionsDropdown.remove();
            delete this.views.optionsDropdown;
        }
    }

    itemOptionsDropdownSelect(e) {
        this.hideItemOptionsDropdown();
        const sequence = e.item;
        this.closeWithResult(sequence);
    }

    showAndGetResult() {
        this.render();
        return new Promise((resolve) => {
            this.once('result', (result) => {
                this.remove();
                resolve(result);
            });
        });
    }

    filterClicked(e) {
        const filterEl = e.target.closest('.select-entry__filter');
        const filter = filterEl.dataset.filter;
        const active = filterEl.dataset.active !== 'true';

        switch (filter) {
            case 'url':
                this.model.filter.useUrl = active;
                break;
            case 'subdomains':
                this.model.filter.subdomains = active;
                if (active) {
                    this.model.filter.useUrl = true;
                }
                break;
            case 'title':
                this.model.filter.useTitle = active;
                break;
            case 'text':
                if (!active) {
                    this.model.filter.text = '';
                }
                break;
        }

        this.render();
    }

    cancelClicked() {
        this.cancelAndClose();
    }
}

Object.assign(SelectEntryView.prototype, Scrollable);

export { SelectEntryView };
