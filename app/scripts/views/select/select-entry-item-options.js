import { StringFormat } from 'util/formatting/string-format';
import { Locale } from 'util/locale';
import { ExtraUrlFieldName } from 'models/entry-model';

function buildItemOptions(entry) {
    const options = [];

    if (entry.fields.otp) {
        options.push({
            value: '{TOTP}',
            icon: 'clock',
            text: Locale.autoTypeSelectionOtp
        });
    }
    if (entry.user) {
        options.push({
            value: '{USERNAME}',
            icon: 'user',
            text: StringFormat.capFirst(Locale.user)
        });
    }
    if (entry.password) {
        options.push({
            value: '{PASSWORD}',
            icon: 'key',
            text: StringFormat.capFirst(Locale.password)
        });
    }

    for (const field of Object.keys(entry.fields)) {
        if (field !== 'otp' && !field.startsWith(ExtraUrlFieldName)) {
            options.push({
                value: `{S:${field}}`,
                icon: 'th-list',
                text: field
            });
        }
    }

    return options;
}

function itemOptionsPosition(itemEl, event) {
    if (event && event.button === 2) {
        return {
            top: event.pageY,
            left: event.pageX
        };
    }
    const targetElRect = itemEl[0].getBoundingClientRect();
    return {
        top: targetElRect.bottom,
        right: targetElRect.right
    };
}

export { buildItemOptions, itemOptionsPosition };
