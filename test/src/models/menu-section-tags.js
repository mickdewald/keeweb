import { expect } from 'chai';
import { MenuSectionModel } from 'models/menu/menu-section-model';
import { MenuItemModel } from 'models/menu/menu-item-model';
import { MenuModel } from 'models/menu/menu-model';

describe('Menu tags section', () => {
    it('nests tag items under a collapsible section header', () => {
        const section = new MenuSectionModel();
        section.setItems([
            {
                title: 'Tags',
                sectionHeader: true,
                expanded: false,
                items: [
                    { title: 'AI', filterKey: 'tag', filterValue: 'AI' },
                    { title: 'Bank', filterKey: 'tag', filterValue: 'Bank' }
                ]
            }
        ]);

        expect(section.items.length).to.equal(1);
        const header = section.items[0];
        expect(header).to.be.instanceOf(MenuItemModel);
        expect(header.sectionHeader).to.equal(true);
        expect(header.expanded).to.equal(false);
        expect(header.items).to.have.length(2);
        expect(header.items[0]).to.be.instanceOf(MenuItemModel);
        expect(header.items[0].filterValue).to.equal('AI');
    });

    it('keeps All Items and Tags in the same section', () => {
        const section = new MenuSectionModel([
            { title: 'All Items', filterKey: '*', icon: 'th-large' }
        ]);
        section.addItem({
            title: 'Tags',
            sectionHeader: true,
            expanded: false,
            items: [{ title: 'AI', filterKey: 'tag', filterValue: 'AI' }]
        });
        expect(section.items.length).to.equal(2);
        expect(section.items[0].filterKey).to.equal('*');
        expect(section.items[1].sectionHeader).to.equal(true);
        expect(section.items[1].items[0].title).to.equal('AI');
    });

    it('keeps trash out of the permanent workspace sections', () => {
        const menu = new MenuModel();
        const sections = Array.from(menu.menus.app);
        expect(sections).to.not.include(menu.trashSection);
        expect(menu.trashItem.filterKey).to.equal('trash');
    });

    it('toggles only the header without requiring a filter', () => {
        const header = new MenuItemModel({
            title: 'Tags',
            sectionHeader: true,
            expanded: false,
            items: [new MenuItemModel({ title: 'AI', filterKey: 'tag', filterValue: 'AI' })]
        });
        header.toggleExpanded();
        expect(header.expanded).to.equal(true);
        header.toggleExpanded();
        expect(header.expanded).to.equal(false);
    });
});
