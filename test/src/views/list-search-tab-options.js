import { expect } from 'chai';
import { createTabOptions, createTabReader, addTabOptions } from 'views/list-search-tab-options';

function fileWith(urls) {
    const entries = urls.map((url) => ({ url }));
    return { active: true, db: {}, forEachEntry: (filter, callback) => entries.forEach(callback) };
}

describe('ListSearchTabOptions', () => {
    const edge = { browser: 'Microsoft Edge', title: 'Kaufland', url: 'https://www.kaufland.de/x' };
    const safari = { browser: 'Safari', title: 'GitHub', url: 'https://github.com/login' };

    it('shows the host and names the browser only when several have tabs', () => {
        const single = createTabOptions({ tabs: [edge], denied: [] }, [fileWith([])]);
        expect(single.options).to.eql([
            { value: 'tab:0', icon: 'globe', text: 'Kaufland', hint: 'www.kaufland.de' }
        ]);
        expect(single.suggestions[0].url).to.eql('https://www.kaufland.de/');

        const several = createTabOptions({ tabs: [edge, safari], denied: [] }, [
            fileWith(['https://github.com/'])
        ]);
        expect(several.options.map((option) => option.hint)).to.eql([
            'www.kaufland.de · Microsoft Edge',
            'github.com · Safari · already saved'
        ]);
    });

    it('offers the system setting when every browser refused access', () => {
        const denied = createTabOptions({ tabs: [], denied: ['Microsoft Edge'] }, []);
        expect(denied.options.length).to.eql(1);
        expect(denied.options[0].value).to.eql('tab-access');
        expect(denied.options[0].text).to.contain('Microsoft Edge');
        expect(createTabOptions({ tabs: [], denied: [] }, []).options).to.eql([]);
    });

    it('appends the tabs to an open menu and keeps its width and position', async () => {
        const rendered = [];
        const view = { render: (config) => rendered.push(config) };
        const config = {
            position: { top: 1, right: 2 },
            width: 300,
            options: [{ value: 'entry' }]
        };
        const tabs = { options: [{ value: 'tab:0' }], suggestions: [{ title: 'Kaufland' }] };
        let accepted;

        await addTabOptions(
            view,
            config,
            [],
            (suggestions) => {
                accepted = suggestions;
                return true;
            },
            async () => tabs
        );
        expect(accepted).to.eql(tabs.suggestions);
        expect(rendered).to.eql([
            {
                position: config.position,
                width: 300,
                options: [{ value: 'entry' }, { value: 'tab:0' }]
            }
        ]);

        await addTabOptions(
            view,
            config,
            [],
            () => false,
            async () => tabs
        );
        await addTabOptions(
            view,
            config,
            [],
            () => true,
            async () => ({ options: [], suggestions: [] })
        );
        expect(rendered.length).to.eql(1);
    });

    it('reuses one read for a short time', () => {
        let reads = 0;
        let time = 1000;
        const read = createTabReader(
            () => ++reads,
            () => time
        );
        expect(read()).to.eql(1);
        time += 2900;
        expect(read()).to.eql(1);
        time += 200;
        expect(read()).to.eql(2);
        expect(reads).to.eql(2);
    });
});
