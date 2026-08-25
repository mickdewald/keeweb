import { expect } from 'chai';
import $ from 'jquery';
import { Tip } from 'util/ui/tip';
import { Locale } from 'util/locale';
import { SelectEntryView } from 'views/select/select-entry-view';

describe('SelectEntryView', () => {
    it('selects the active command-palette entry when Enter is pressed', () => {
        const entry = { id: 'target-entry', password: 'secret' };
        const view = Object.create(SelectEntryView.prototype);
        const results = [];

        view.model = { isAutoType: false };
        view.result = entry;
        view.on('result', (value) => {
            results.push(value);
        });

        view.enterPressed();

        expect(results).to.deep.equal([{ entry, select: true }]);
    });

    it('selects the clicked command-palette entry through the same result contract', () => {
        const entry = { id: 'target-entry', password: 'secret' };
        const row = document.createElement('div');
        row.className = 'select-entry__item';
        row.dataset.id = entry.id;
        const view = Object.create(SelectEntryView.prototype);
        const results = [];
        const previousDollar = window.$;

        view.model = { isAutoType: false };
        view.entries = new Map([[entry.id, entry]]);
        view.on('result', (value) => results.push(value));

        window.$ = $;
        try {
            view.itemClicked({ target: row });
        } finally {
            if (previousDollar === undefined) {
                delete window.$;
            } else {
                window.$ = previousDollar;
            }
        }

        expect(results).to.deep.equal([{ entry, select: true }]);
    });

    it('opens a passwordless command-palette entry when Enter is pressed', () => {
        const entry = { id: 'passwordless-entry', password: '' };
        const view = Object.create(SelectEntryView.prototype);
        const results = [];

        view.model = { isAutoType: false };
        view.result = entry;
        view.on('result', (value) => results.push(value));

        view.enterPressed();

        expect(results).to.deep.equal([{ entry, select: true }]);
    });

    it('keeps the command palette open when Enter is pressed without a match', () => {
        const view = Object.create(SelectEntryView.prototype);
        const results = [];
        let hint;

        view.model = { isAutoType: false };
        view.result = null;
        view.showPaletteHint = (value) => {
            hint = value;
        };
        view.on('result', (value) => results.push(value));

        view.enterPressed();

        expect(results).to.deep.equal([]);
        expect(hint).to.equal(Locale.cmdPaletteNoMatch);
    });

    it('cancels the command palette without selecting an entry', () => {
        const view = Object.create(SelectEntryView.prototype);
        const results = [];

        view.result = { id: 'target-entry' };
        view.on('result', (value) => results.push(value));

        view.escPressed();

        expect(results).to.deep.equal([null]);
    });

    it('preserves AutoType Enter and modifier-Enter result contracts', () => {
        const entry = { id: 'target-entry' };
        const view = Object.create(SelectEntryView.prototype);
        const results = [];

        view.model = { isAutoType: true };
        view.result = entry;
        view.on('result', (value) => results.push(value));

        view.enterPressed();
        view.actionEnterPressed();
        view.optEnterPressed();

        expect(results).to.deep.equal([
            { entry, sequence: undefined },
            { entry, sequence: '{PASSWORD}' },
            { entry, sequence: '{USERNAME}' }
        ]);
    });

    it('preserves the AutoType Shift-Enter options path without selecting', () => {
        const entry = { id: 'target-entry' };
        const root = document.createElement('div');
        root.innerHTML = `<div class="select-entry__item" data-id="${entry.id}"></div>`;
        const view = Object.create(SelectEntryView.prototype);
        const results = [];
        let optionsEntryId;
        const event = {};

        view.result = entry;
        view.$el = $(root);
        view.showItemOptions = (item, receivedEvent) => {
            optionsEntryId = item.data('id');
            expect(receivedEvent).to.equal(event);
        };
        view.on('result', (value) => results.push(value));

        view.shiftEnterPressed(event);

        expect(optionsEntryId).to.equal(entry.id);
        expect(results).to.deep.equal([]);
    });

    it('removes visible row tooltips before replacing filtered results', () => {
        const previousTipEnabled = Tip.enabled;
        const previousDollar = window.$;
        const root = document.createElement('div');
        root.innerHTML =
            '<div class="select-entry__items"><div class="scroller">' +
            '<div class="result" title="stale command palette tooltip">result</div>' +
            '</div><div class="scroller__bar"></div></div>';
        document.body.appendChild(root);

        Tip.enabled = true;
        window.$ = $;
        Tip.createTips(root);
        const result = root.querySelector('.result');
        const tip = result._tip;
        tip.show();

        const view = {
            model: { filter: { getEntries: () => [] } },
            $el: $(root),
            syncActiveResult() {},
            buildItemsHtml: () => '',
            createScroll() {}
        };

        let tooltipRemained;
        try {
            SelectEntryView.prototype.refreshItems.call(view);
            tooltipRemained = [...document.querySelectorAll('.tip')].some(
                (el) => el.textContent === 'stale command palette tooltip'
            );
        } finally {
            tip.destroy();
            root.remove();
            Tip.enabled = previousTipEnabled;
            if (previousDollar === undefined) {
                delete window.$;
            } else {
                window.$ = previousDollar;
            }
        }

        expect(tooltipRemained).to.equal(false);
    });
});
