import { Launcher } from 'comp/launcher';
import { Features } from 'util/features';
import { Locale } from 'util/locale';
import { readBrowserTabs, buildTabSuggestions } from 'comp/browser/browser-tabs';
import { collectKnownSites } from 'comp/browser/entry-from-tab';

const TabOptionPrefix = 'tab:';
const TabAccessOption = 'tab-access';
const AutomationSettingsUrl =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

function canReadBrowserTabs() {
    return !!Launcher && Features.isDesktop && Features.isMac;
}

function createTabOptions({ tabs, denied }, files) {
    const suggestions = buildTabSuggestions(tabs, collectKnownSites(files));
    const options = suggestions.map((tab, ix) => ({
        value: TabOptionPrefix + ix,
        icon: 'globe',
        text: tab.title,
        hint: [tab.host, tab.browser, tab.exists ? Locale.searchTabExists : null]
            .filter(Boolean)
            .join(' · ')
    }));
    if (!options.length && denied.length) {
        options.push({
            value: TabAccessOption,
            icon: 'lock',
            text: Locale.searchTabAccess.replace('{}', denied.join(', '))
        });
    }
    return { suggestions, options };
}

async function loadTabOptions(files) {
    if (!canReadBrowserTabs()) {
        return { suggestions: [], options: [] };
    }
    return createTabOptions(await readBrowserTabs((config) => Launcher.spawn(config)), files);
}

function openTabAccessSettings() {
    Launcher.spawn({ cmd: '/usr/bin/open', args: [AutomationSettingsUrl] });
}

export {
    TabOptionPrefix,
    TabAccessOption,
    createTabOptions,
    loadTabOptions,
    openTabAccessSettings
};
