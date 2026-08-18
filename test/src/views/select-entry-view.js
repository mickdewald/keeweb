import { expect } from 'chai';
import $ from 'jquery';
import { Tip } from 'util/ui/tip';
import { SelectEntryView } from 'views/select/select-entry-view';

describe('SelectEntryView', () => {
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
