const MaxSuggestions = 6;
const ScriptTimeout = 60000;

const Browsers = [
    { name: 'Microsoft Edge', id: 'com.microsoft.edgemac' },
    { name: 'Google Chrome', id: 'com.google.Chrome' },
    { name: 'Brave', id: 'com.brave.Browser' },
    { name: 'Opera', id: 'com.operasoftware.Opera' },
    { name: 'Vivaldi', id: 'com.vivaldi.Vivaldi' },
    { name: 'Safari', id: 'com.apple.Safari', safari: true }
];

// Runs in osascript (JavaScript for Automation), not in the app.
// Only running browsers are asked, so the script never launches one.
const TabScript = `function run(argv) {
    var out = [];
    JSON.parse(argv[0]).forEach(function (b) {
        try {
            var app = Application(b.id);
            if (!app.running()) return;
            var windows = app.windows();
            for (var i = 0; i < windows.length && i < 8; i++) {
                try {
                    var w = windows[i];
                    if (!b.safari && w.mode() !== 'normal') continue;
                    var tab = b.safari ? w.currentTab() : w.activeTab();
                    out.push({
                        browser: b.name,
                        title: b.safari ? tab.name() : tab.title(),
                        url: tab.url()
                    });
                } catch (e) {
                    if (e.errorNumber === -1743) throw e;
                }
            }
        } catch (e) {
            if (e.errorNumber === -1743) out.push({ browser: b.name, denied: true });
        }
    });
    return JSON.stringify(out);
}`;

const TwoPartSuffixes = new Set(
    (
        'co.uk org.uk ac.uk gov.uk com.au net.au org.au co.nz co.jp ne.jp or.jp com.br com.mx ' +
        'com.tr com.cn com.hk com.sg com.tw co.kr co.in co.za co.at or.at com.ar com.pl co.il ' +
        'co.th com.ua'
    ).split(' ')
);

function parseUrl(value) {
    if (typeof value !== 'string' || !value.trim() || /[{}]/.test(value)) return null;
    try {
        const url = new URL(value.includes('://') ? value : `https://${value}`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
            return null;
        }
        return url.hostname ? url : null;
    } catch {
        return null;
    }
}

function siteKey(value) {
    const url = parseUrl(value);
    return url ? url.hostname.toLowerCase().replace(/^www\./, '') : null;
}

function siteLabel(host) {
    if (/^[\d.]+$/.test(host) || /[:\[\]]/.test(host)) return host;
    const parts = host.replace(/^www\./, '').split('.');
    if (parts.length < 2) return host;
    const suffix = parts.length > 2 && TwoPartSuffixes.has(parts.slice(-2).join('.')) ? 2 : 1;
    return parts[parts.length - suffix - 1];
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleFromTab(host, pageTitle) {
    const label = siteLabel(host);
    if (label === host) return host;
    const words = label.split('-').filter(Boolean);
    if (!words.length) return host;
    const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${words.map(escapeRegex).join('[\\s-]?')}(?![\\p{L}\\p{N}])`,
        'giu'
    );
    const spelled = (pageTitle || '').match(pattern)?.find((match) => /\p{Lu}/u.test(match));
    return spelled || words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function parseBrowserTabs(stdout) {
    const result = { tabs: [], denied: [] };
    let items;
    try {
        items = JSON.parse(stdout);
    } catch {
        return result;
    }
    if (!Array.isArray(items)) return result;
    for (const item of items) {
        if (!item || typeof item.browser !== 'string') continue;
        if (item.denied) {
            result.denied.push(item.browser);
        } else if (typeof item.url === 'string') {
            result.tabs.push({
                browser: item.browser,
                title: typeof item.title === 'string' ? item.title : '',
                url: item.url
            });
        }
    }
    return result;
}

// The path and query of a tab are dropped: they can carry session tokens.
function buildTabSuggestions(tabs, knownSites) {
    const suggestions = [];
    const seen = new Set();
    for (const tab of tabs) {
        const url = parseUrl(tab.url);
        const key = url && siteKey(tab.url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
            browser: tab.browser,
            title: titleFromTab(url.hostname, tab.title),
            url: url.origin + '/',
            host: url.hostname,
            exists: knownSites.has(key)
        });
        if (suggestions.length === MaxSuggestions) break;
    }
    return suggestions;
}

function readBrowserTabs(spawn) {
    return new Promise((resolve) => {
        spawn({
            cmd: '/usr/bin/osascript',
            args: ['-l', 'JavaScript', '-e', TabScript, JSON.stringify(Browsers)],
            options: { timeout: ScriptTimeout },
            noStdOutLogging: true,
            complete: (err, stdout) => resolve(parseBrowserTabs(err ? '' : stdout))
        });
    });
}

export { parseBrowserTabs, siteKey, titleFromTab, buildTabSuggestions, readBrowserTabs };
