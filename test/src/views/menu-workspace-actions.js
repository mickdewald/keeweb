import { expect } from 'chai';
import { workspaceActionFromEvent } from 'views/menu/menu-workspace-view';

function clickOn(html, selector) {
    const root = document.createElement('div');
    root.innerHTML = html;
    const target = root.querySelector(selector);
    return workspaceActionFromEvent({
        target,
        currentTarget: root
    });
}

const menu = `
    <div class="menu__workspace-popover">
        <button class="menu__workspace-item" data-action="open"><i class="fa"></i><span>Open</span></button>
        <button class="menu__workspace-item" data-action="settings"><i class="fa"></i><span>Settings</span></button>
        <button class="menu__workspace-item" data-action="help"><i class="fa"></i><span>Help</span></button>
        <button class="menu__workspace-item" data-action="generate"><i class="fa"></i><span>Generate</span></button>
        <button class="menu__workspace-item" data-action="trash"><i class="fa"></i><span>Trash</span></button>
        <button class="menu__workspace-item" data-action="lock"><i class="fa"></i><span>Lock</span></button>
        <button class="menu__workspace-item" data-action="file" data-file-id="abc"><span>mick.kdbx</span></button>
    </div>
`;

describe('Menu workspace actions', () => {
    it('reads the action from the clicked button, not from currentTarget', () => {
        expect(clickOn(menu, '[data-action="open"] span').action).to.equal('open');
        expect(clickOn(menu, '[data-action="settings"] .fa').action).to.equal('settings');
        expect(clickOn(menu, '[data-action="help"]').action).to.equal('help');
        expect(clickOn(menu, '[data-action="generate"] span').action).to.equal('generate');
        expect(clickOn(menu, '[data-action="trash"]').action).to.equal('trash');
        expect(clickOn(menu, '[data-action="lock"] span').action).to.equal('lock');
    });

    it('reads the file id when a database row is clicked', () => {
        const selected = clickOn(menu, '[data-action="file"] span');
        expect(selected.action).to.equal('file');
        expect(selected.fileId).to.equal('abc');
    });

    it('ignores clicks that are not on a menu item', () => {
        expect(clickOn(menu, '.menu__workspace-popover')).to.equal(null);
    });
});
