import { Launcher } from 'comp/launcher';
import { Features } from 'util/features';
import { Locale } from 'util/locale';
import { readBrowserTabs, buildTabSuggestions } from 'comp/browser/browser-tabs';
import { collectKnownSites } from 'comp/browser/entry-from-tab';

const TabOptionPrefix = 'tab:';
const TabAccessOption = 'tab-access';
const TabReadMaxAge = 3000;
const CreateMenuMaxWidth = 340;
const AutomationSettingsUrl =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

function canReadBrowserTabs() {
    return !!Launcher && Features.isDesktop && Features.isMac;
}

function createTabOptions({ tabs, denied }, files) {
    const suggestions = buildTabSuggestions(tabs, collectKnownSites(files));
    // the browser only tells tabs apart when more than one browser has some
    const showBrowser = new Set(suggestions.map((tab) => tab.browser)).size > 1;
    const options = suggestions.map((tab, ix) => ({
        value: TabOptionPrefix + ix,
        icon: 'globe',
        text: tab.title,
        hint: [
            tab.host,
            showBrowser ? tab.browser : null,
            tab.exists ? Locale.searchTabExists : null
        ]
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

// One read serves the hover over "+", the menu and the new entry opened from it.
function createTabReader(read, now = Date.now) {
    let pending = null;
    let startedAt = 0;
    return () => {
        if (!pending || now() - startedAt > TabReadMaxAge) {
            startedAt = now();
            pending = read();
        }
        return pending;
    };
}

const readTabs = createTabReader(() => readBrowserTabs((config) => Launcher.spawn(config)));

function preloadTabOptions() {
    if (canReadBrowserTabs()) {
        readTabs();
    }
}

async function loadTabOptions(files) {
    if (!canReadBrowserTabs()) {
        return { suggestions: [], options: [] };
    }
    return createTabOptions(await readTabs(), files);
}

// Tabs may arrive after the menu is open: they go below the fixed items and the width stays
// the same, so nothing moves under the pointer. `accept` tells whether the menu is still open.
function addTabOptions(view, config, files, accept, load = loadTabOptions) {
    return load(files).then((tabs) => {
        if (tabs.options.length && accept(tabs.suggestions)) {
            view.render({ ...config, options: config.options.concat(tabs.options) });
        }
    });
}

function openTabAccessSettings() {
    Launcher.spawn({ cmd: '/usr/bin/open', args: [AutomationSettingsUrl] });
}

export {
    TabOptionPrefix,
    TabAccessOption,
    createTabOptions,
    createTabReader,
    CreateMenuMaxWidth,
    preloadTabOptions,
    loadTabOptions,
    addTabOptions,
    openTabAccessSettings
};
