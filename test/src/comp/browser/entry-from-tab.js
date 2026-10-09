import { expect } from 'chai';
import { Events } from 'framework/events';
import {
    collectKnownSites,
    mostUsedUserName,
    tabEntryFields,
    fillEntryFromTab,
    attachWebsiteIcon
} from 'comp/browser/entry-from-tab';

function fileWith(entries, props = {}) {
    const file = { active: true, db: {}, iconsAdded: [], ...props };
    file.forEachEntry = (filter, callback) => entries.forEach(callback);
    file.getEntry = (id) => entries.find((entry) => entry.id === id);
    file.addCustomIcon = (data) => {
        file.iconsAdded.push(data);
        return 'icon-' + file.iconsAdded.length;
    };
    for (const entry of entries) {
        entry.file = file;
        entry.setCustomIcon = (id) => (entry.customIconId = id);
    }
    return file;
}

describe('EntryFromTab', () => {
    it('collects the sites that already have an entry', () => {
        const files = [
            fileWith([
                { id: '1', url: 'https://www.kaufland.de/login' },
                { id: '2', url: 'github.com' },
                { id: '3', url: '' }
            ]),
            fileWith([{ id: '4', url: 'https://closed.example.com' }], { active: false })
        ];
        expect([...collectKnownSites(files)]).to.eql(['kaufland.de', 'github.com']);
    });

    it('picks the most used user name', () => {
        const files = [
            fileWith([
                { id: '1', user: 'rare@example.com' },
                { id: '2', user: 'main@example.com' },
                { id: '3', user: '' }
            ]),
            fileWith([{ id: '4', user: 'main@example.com' }])
        ];
        expect(mostUsedUserName(files)).to.eql('main@example.com');
        expect(mostUsedUserName([fileWith([])])).to.eql('');
    });

    it('fills the fields of a new entry with a protected generated password', () => {
        const files = [fileWith([{ id: '1', user: 'main@example.com' }])];
        const fields = tabEntryFields(
            { title: 'Kaufland', url: 'https://www.kaufland.de/', host: 'www.kaufland.de' },
            files,
            () => 'generated'
        );
        expect(fields.Title).to.eql('Kaufland');
        expect(fields.URL).to.eql('https://www.kaufland.de/');
        expect(fields.UserName).to.eql('main@example.com');
        expect(fields.Password.isProtected).to.eql(true);
        expect(fields.Password.getText()).to.eql('generated');
    });

    it('generates a password with the default preset', () => {
        const fields = tabEntryFields({ title: 'A', url: 'https://a.com/' }, []);
        expect(fields.Password.getText().length).to.be.greaterThan(7);
    });

    it('fills a new empty entry from a tab', () => {
        const files = [fileWith([{ id: '1', user: 'main@example.com' }])];
        const set = {};
        const entry = {
            title: '',
            user: '',
            password: { byteLength: 0 },
            setField: (name, value) => (set[name] = value)
        };
        fillEntryFromTab(
            entry,
            { title: 'Kaufland', url: 'https://www.kaufland.de/' },
            files,
            () => 'generated'
        );
        expect(Object.keys(set)).to.eql(['Title', 'URL', 'UserName', 'Password']);
        expect(set.Title).to.eql('Kaufland');
        expect(set.URL).to.eql('https://www.kaufland.de/');
        expect(set.UserName).to.eql('main@example.com');
        expect(set.Password.getText()).to.eql('generated');
    });

    it('keeps what the user already typed into the entry', () => {
        const files = [fileWith([{ id: '1', user: 'main@example.com' }])];
        const set = {};
        const entry = {
            title: 'My shop',
            user: 'me',
            password: { byteLength: 8 },
            setField: (name, value) => (set[name] = value)
        };
        let generated = false;
        fillEntryFromTab(
            entry,
            { title: 'Kaufland', url: 'https://www.kaufland.de/' },
            files,
            () => {
                generated = true;
                return 'x';
            }
        );
        expect(set).to.eql({ URL: 'https://www.kaufland.de/' });
        expect(generated).to.eql(false);
    });

    it('sets the downloaded website icon and announces it', async () => {
        const entry = { id: '1', url: 'https://www.kaufland.de/' };
        const file = fileWith([entry]);
        const events = [];
        const listener = (e) => events.push(e.entry);
        Events.on('entry-icon-loaded', listener);
        try {
            const hosts = [];
            const done = await attachWebsiteIcon(entry, async (host) => {
                hosts.push(host);
                return 'data:image/png;base64,AAAA';
            });
            expect(done).to.eql(true);
            expect(hosts).to.eql(['www.kaufland.de']);
            expect(file.iconsAdded).to.eql(['AAAA']);
            expect(entry.customIconId).to.eql('icon-1');
            expect(events).to.eql([entry]);
        } finally {
            Events.off('entry-icon-loaded', listener);
        }
    });

    it('uses the entry of the reloaded file', async () => {
        const stale = { id: '1', url: 'https://www.kaufland.de/' };
        const file = fileWith([stale]);
        const fresh = { id: '1', url: stale.url, setCustomIcon: (id) => (fresh.customIconId = id) };
        file.getEntry = () => fresh;
        expect(await attachWebsiteIcon(stale, async () => 'data:image/png;base64,AAAA')).to.eql(
            true
        );
        expect(fresh.customIconId).to.eql('icon-1');
        expect(stale.customIconId).to.eql(undefined);
    });

    it('leaves the entry alone when the icon is unavailable or the entry changed', async () => {
        const ok = async () => 'data:image/png;base64,AAAA';
        const failing = async () => {
            throw new Error('Icon unavailable');
        };

        const entry = { id: '1', url: 'https://www.kaufland.de/' };
        const file = fileWith([entry]);
        expect(await attachWebsiteIcon(entry, failing)).to.eql(false);

        const local = { id: '2', url: 'http://localhost:8085/' };
        fileWith([local]);
        let asked = false;
        expect(await attachWebsiteIcon(local, async () => (asked = true))).to.eql(false);
        expect(asked).to.eql(false);

        const changedUrl = attachWebsiteIcon(entry, ok);
        entry.url = 'https://other.example.com/';
        expect(await changedUrl).to.eql(false);

        entry.url = 'https://www.kaufland.de/';
        const gotIcon = attachWebsiteIcon(entry, ok);
        entry.customIconId = 'chosen-by-user';
        expect(await gotIcon).to.eql(false);
        expect(entry.customIconId).to.eql('chosen-by-user');

        delete entry.customIconId;
        const removed = attachWebsiteIcon(entry, ok);
        file.getEntry = () => undefined;
        expect(await removed).to.eql(false);

        file.getEntry = () => entry;
        const closed = attachWebsiteIcon(entry, ok);
        file.active = false;
        expect(await closed).to.eql(false);
        expect(file.iconsAdded).to.eql([]);
    });
});
