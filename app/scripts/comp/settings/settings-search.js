import BaseLocale from 'locales/base.json';
import { Locale } from 'util/locale';
import { SettingsSearchCatalog } from 'comp/settings/settings-search-catalog';

function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/[{}]/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokensOf(value) {
    return normalize(value).split(' ').filter(Boolean);
}

function localeText(locale, key) {
    if (!key) {
        return '';
    }
    return locale && locale[key] != null ? locale[key] : '';
}

function isVisible(entry) {
    return typeof entry.visible !== 'function' || entry.visible();
}

function scoreEntry(entry, queryTokens, queryText, locale, englishLocale) {
    const title = localeText(locale, entry.titleKey);
    const category = localeText(locale, entry.categoryKey);
    const englishTitle = localeText(englishLocale, entry.titleKey);
    const englishCategory = localeText(englishLocale, entry.categoryKey);
    const keywordText = (entry.keywords || []).join(' ');
    const haystack = normalize(
        [title, category, englishTitle, englishCategory, keywordText, entry.id].join(' ')
    );

    if (queryTokens.some((token) => !haystack.includes(token))) {
        return null;
    }

    const titleNorm = normalize(title);
    const categoryNorm = normalize(category);
    let score = 10;

    if (titleNorm.includes(queryText)) {
        score += 100;
    }
    if (titleNorm.startsWith(queryTokens[0])) {
        score += 40;
    }
    if (categoryNorm.includes(queryText)) {
        score += 20;
    }
    for (const token of queryTokens) {
        if (titleNorm.includes(token)) {
            score += 15;
        } else if (categoryNorm.includes(token)) {
            score += 8;
        } else {
            score += 3;
        }
    }

    return {
        ...entry,
        title,
        path: category && category !== title ? category : localeText(locale, 'settings'),
        score
    };
}

function searchSettings(query, options = {}) {
    const locale = options.locale || Locale;
    const englishLocale = options.englishLocale || BaseLocale;
    const catalog = options.catalog || SettingsSearchCatalog;
    const queryText = normalize(query);
    if (!queryText) {
        return [];
    }
    const queryTokens = tokensOf(queryText);
    return catalog
        .filter(isVisible)
        .map((entry) => scoreEntry(entry, queryTokens, queryText, locale, englishLocale))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

export { searchSettings, normalize };
