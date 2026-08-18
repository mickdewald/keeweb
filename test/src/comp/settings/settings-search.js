import { expect } from 'chai';
import { searchSettings } from 'comp/settings/settings-search';

const locale = {
    settings: 'Settings',
    setGenAppearance: 'Appearance',
    setGenColorfulIcons: 'Colorful custom icons in the list',
    setGenTheme: 'Theme',
    setGenLock: 'Auto lock'
};

const englishLocale = {
    setGenAppearance: 'Appearance',
    setGenColorfulIcons: 'Colorful custom icons in the list',
    setGenTheme: 'Theme',
    setGenLock: 'Auto lock'
};

const catalog = [
    {
        id: 'colorful-icons',
        page: 'general',
        section: 'appearance',
        target: '#settings__general-colorful-icons',
        titleKey: 'setGenColorfulIcons',
        categoryKey: 'setGenAppearance',
        keywords: ['colorful', 'farbig', 'bunt', 'symbole']
    },
    {
        id: 'theme',
        page: 'general',
        section: 'appearance',
        target: '.settings__general-themes',
        titleKey: 'setGenTheme',
        categoryKey: 'setGenAppearance',
        keywords: ['dark']
    },
    {
        id: 'lock',
        page: 'general',
        section: 'lock',
        target: '#lock',
        titleKey: 'setGenLock',
        categoryKey: 'setGenLock',
        keywords: ['lock']
    }
];

function search(query) {
    return searchSettings(query, { locale, englishLocale, catalog });
}

describe('settings search', () => {
    it('returns nothing for an empty query', () => {
        expect(search('')).to.eql([]);
        expect(search('   ')).to.eql([]);
    });

    it('finds colorful icons by the setting title', () => {
        const results = search('colorful');
        expect(results.map((result) => result.id)).to.eql(['colorful-icons']);
        expect(results[0].path).to.eql('Appearance');
    });

    it('finds colorful icons by german keywords', () => {
        const results = search('farbig');
        expect(results.map((result) => result.id)).to.include('colorful-icons');
    });

    it('finds colorful icons in the live catalog', () => {
        const results = searchSettings('colorful icons', {
            locale,
            englishLocale
        });
        expect(results[0].id).to.eql('colorful-icons');
    });

    it('requires every query word to match', () => {
        expect(search('colorful lock').map((result) => result.id)).to.eql([]);
        expect(search('auto lock').map((result) => result.id)).to.eql(['lock']);
    });

    it('ranks a title match above a category match', () => {
        const results = search('appearance');
        expect(results[0].id).to.not.eql('lock');
        expect(results.map((result) => result.id)).to.include('colorful-icons');
    });
});
