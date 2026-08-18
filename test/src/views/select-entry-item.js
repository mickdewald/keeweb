import { expect } from 'chai';
import 'hbs-helpers/highlight';
import template from 'templates/select/select-entry-item.hbs';

describe('select entry item', () => {
    it('highlights search terms in the title, user, and url', () => {
        const html = template({
            id: 'entry-1',
            title: 'Example account',
            user: 'mail@example.com',
            url: 'https://example.com',
            searchTerms: ['example']
        });

        expect(html.match(/<mark class="search-hl">Example<\/mark>/g)).to.have.length(1);
        expect(html.match(/<mark class="search-hl">example<\/mark>/g)).to.have.length(2);
    });

    it('keeps complete values available when cells are visually truncated', () => {
        const container = document.createElement('table');
        container.innerHTML = template({
            id: 'entry-1',
            title: 'A very long account title',
            user: 'long-user@example.com',
            url: 'https://example.com/a/very/long/path'
        });

        expect(container.querySelector('.select-entry__item-title-cell').title).to.equal(
            'A very long account title'
        );
        expect(container.querySelector('.select-entry__item-user-cell').title).to.equal(
            'long-user@example.com'
        );
        expect(container.querySelector('.select-entry__item-url-cell').title).to.equal(
            'https://example.com/a/very/long/path'
        );
    });
});
