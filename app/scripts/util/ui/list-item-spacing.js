import { DefaultAppSettings } from 'const/default-app-settings';

function normalizeListItemSpacing(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(24, Math.round(value)))
        : DefaultAppSettings.listItemSpacing;
}

export { normalizeListItemSpacing };
