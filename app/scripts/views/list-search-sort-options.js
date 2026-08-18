import { StringFormat } from 'util/formatting/string-format';
import { Locale } from 'util/locale';

function addArrow(str) {
    return str.replace('{}', '→');
}

function createSortOptions() {
    return [
        {
            value: 'title',
            icon: 'sort-alpha-down',
            loc: () => StringFormat.capFirst(Locale.title) + ' ' + addArrow(Locale.searchAZ)
        },
        {
            value: '-title',
            icon: 'sort-alpha-down-alt',
            loc: () => StringFormat.capFirst(Locale.title) + ' ' + addArrow(Locale.searchZA)
        },
        {
            value: 'website',
            icon: 'sort-alpha-down',
            loc: () => StringFormat.capFirst(Locale.website) + ' ' + addArrow(Locale.searchAZ)
        },
        {
            value: '-website',
            icon: 'sort-alpha-down-alt',
            loc: () => StringFormat.capFirst(Locale.website) + ' ' + addArrow(Locale.searchZA)
        },
        {
            value: 'user',
            icon: 'sort-alpha-down',
            loc: () => StringFormat.capFirst(Locale.user) + ' ' + addArrow(Locale.searchAZ)
        },
        {
            value: '-user',
            icon: 'sort-alpha-down-alt',
            loc: () => StringFormat.capFirst(Locale.user) + ' ' + addArrow(Locale.searchZA)
        },
        {
            value: 'created',
            icon: 'sort-numeric-down',
            loc: () => Locale.searchCreated + ' ' + addArrow(Locale.searchON)
        },
        {
            value: '-created',
            icon: 'sort-numeric-down-alt',
            loc: () => Locale.searchCreated + ' ' + addArrow(Locale.searchNO)
        },
        {
            value: 'updated',
            icon: 'sort-numeric-down',
            loc: () => Locale.searchUpdated + ' ' + addArrow(Locale.searchON)
        },
        {
            value: '-updated',
            icon: 'sort-numeric-down-alt',
            loc: () => Locale.searchUpdated + ' ' + addArrow(Locale.searchNO)
        },
        {
            value: '-attachments',
            icon: 'sort-amount-down',
            loc: () => Locale.searchAttachments
        },
        { value: '-rank', icon: 'sort-amount-down', loc: () => Locale.searchRank }
    ];
}

export { createSortOptions };
