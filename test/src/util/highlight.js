import { expect } from 'chai';
import { highlightText } from 'hbs-helpers/highlight';

describe('highlight helper', () => {
    it('returns escaped text without terms', () => {
        expect(highlightText('a <b>', null)).to.eql('a &lt;b&gt;');
    });

    it('wraps a case-insensitive match', () => {
        expect(highlightText('Google Pay', ['google'])).to.eql(
            '<mark class="search-hl">Google</mark> Pay'
        );
    });

    it('highlights every occurrence', () => {
        expect(highlightText('go go', ['go'])).to.eql(
            '<mark class="search-hl">go</mark> <mark class="search-hl">go</mark>'
        );
    });

    it('merges overlapping matches from multiple terms', () => {
        expect(highlightText('keeweb', ['keew', 'eweb'])).to.eql(
            '<mark class="search-hl">keeweb</mark>'
        );
    });

    it('escapes html inside and outside matches', () => {
        expect(highlightText('<google>', ['google'])).to.eql(
            '&lt;<mark class="search-hl">google</mark>&gt;'
        );
    });

    it('returns escaped text when nothing matches', () => {
        expect(highlightText('KeeWeb', ['xyz'])).to.eql('KeeWeb');
    });
});
