import { expect } from 'chai';
import {
    parseBrowserTabs,
    siteKey,
    titleFromTab,
    buildTabSuggestions,
    readBrowserTabs
} from 'comp/browser/browser-tabs';

describe('BrowserTabs', () => {
    it('derives the entry title from the host', () => {
        expect(titleFromTab('www.kaufland.de', '')).to.eql('Kaufland');
        expect(titleFromTab('accounts.google.com', 'Sign in')).to.eql('Google');
        expect(titleFromTab('www.amazon.co.uk', '')).to.eql('Amazon');
        expect(titleFromTab('deutsche-bank.de', '')).to.eql('Deutsche Bank');
        expect(titleFromTab('192.168.1.1', 'Router')).to.eql('192.168.1.1');
        expect(titleFromTab('localhost', 'Dev')).to.eql('localhost');
    });

    it('takes the spelling of the site name from the page title', () => {
        expect(titleFromTab('github.com', 'Sign in to GitHub · GitHub')).to.eql('GitHub');
        expect(titleFromTab('my.dkb.de', 'DKB Banking')).to.eql('DKB');
        expect(titleFromTab('www.kaufland.de', 'Anmelden | kaufland.de')).to.eql('Kaufland');
        expect(titleFromTab('deutsche-bank.de', 'Login – Deutsche Bank')).to.eql('Deutsche Bank');
        expect(titleFromTab('a.b.example.com', 'Counterexample page')).to.eql('Example');
    });

    it('normalizes hosts for comparison', () => {
        expect(siteKey('https://www.Kaufland.de/path?token=1')).to.eql('kaufland.de');
        expect(siteKey('kaufland.de')).to.eql('kaufland.de');
        expect(siteKey('ftp://kaufland.de')).to.eql(null);
        expect(siteKey('https://user:pass@kaufland.de')).to.eql(null);
        expect(siteKey('{REF:U@I:123}')).to.eql(null);
        expect(siteKey('')).to.eql(null);
    });

    it('parses the script output and drops malformed items', () => {
        const parsed = parseBrowserTabs(
            JSON.stringify([
                { browser: 'Microsoft Edge', title: 'Kaufland', url: 'https://www.kaufland.de/x' },
                { browser: 'Safari', denied: true },
                { browser: 'Opera', title: 5, url: 'https://opera.com' },
                { title: 'No browser', url: 'https://example.com' },
                'junk'
            ])
        );
        expect(parsed.tabs).to.eql([
            { browser: 'Microsoft Edge', title: 'Kaufland', url: 'https://www.kaufland.de/x' },
            { browser: 'Opera', title: '', url: 'https://opera.com' }
        ]);
        expect(parsed.denied).to.eql(['Safari']);
        expect(parseBrowserTabs('not json')).to.eql({ tabs: [], denied: [] });
        expect(parseBrowserTabs('{"a":1}')).to.eql({ tabs: [], denied: [] });
    });

    it('builds suggestions without paths, duplicates or non-web tabs', () => {
        const suggestions = buildTabSuggestions(
            [
                {
                    browser: 'Microsoft Edge',
                    title: 'Anmelden | Kaufland',
                    url: 'https://www.kaufland.de/login?session=secret#frag'
                },
                { browser: 'Safari', title: 'Kaufland', url: 'https://kaufland.de/' },
                { browser: 'Microsoft Edge', title: 'New Tab', url: 'edge://newtab/' },
                { browser: 'Safari', title: 'File', url: 'file:///tmp/secret.html' },
                { browser: 'Safari', title: 'GitHub', url: 'https://github.com/login' },
                { browser: 'Safari', title: 'Dev', url: 'http://localhost:8085/' }
            ],
            new Set(['github.com'])
        );
        expect(suggestions).to.eql([
            {
                browser: 'Microsoft Edge',
                title: 'Kaufland',
                url: 'https://www.kaufland.de/',
                host: 'www.kaufland.de',
                exists: false
            },
            {
                browser: 'Safari',
                title: 'GitHub',
                url: 'https://github.com/',
                host: 'github.com',
                exists: true
            },
            {
                browser: 'Safari',
                title: 'localhost',
                url: 'http://localhost:8085/',
                host: 'localhost',
                exists: false
            }
        ]);
    });

    it('limits the number of suggestions', () => {
        const tabs = [];
        for (let i = 0; i < 20; i++) {
            tabs.push({ browser: 'Safari', title: '', url: `https://site${i}.com/` });
        }
        expect(buildTabSuggestions(tabs, new Set()).length).to.eql(6);
    });

    it('reads tabs through osascript and survives failures', async () => {
        const calls = [];
        const spawn = (config) => {
            calls.push(config);
            config.complete(
                null,
                JSON.stringify([{ browser: 'Safari', title: 'A', url: 'https://a.com/' }]),
                0
            );
        };
        const result = await readBrowserTabs(spawn);
        expect(result.tabs).to.eql([{ browser: 'Safari', title: 'A', url: 'https://a.com/' }]);
        expect(calls[0].cmd).to.eql('/usr/bin/osascript');
        expect(calls[0].args.slice(0, 2)).to.eql(['-l', 'JavaScript']);
        expect(JSON.parse(calls[0].args[calls[0].args.length - 1])).to.be.an('array');

        const failing = (config) => config.complete(new Error('boom'));
        expect(await readBrowserTabs(failing)).to.eql({ tabs: [], denied: [] });
        const nonZero = (config) => config.complete(null, 'garbage', 1);
        expect(await readBrowserTabs(nonZero)).to.eql({ tabs: [], denied: [] });
    });
});
