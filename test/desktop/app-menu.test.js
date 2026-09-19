const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(locale = {}) {
    let template;
    const events = [];
    let restored = 0;
    const context = { mainWindow: { isDestroyed: () => false } };
    const electron = {
        app: { name: 'KeeWeb' },
        Menu: {
            buildFromTemplate: (value) => (template = value),
            setApplicationMenu() {}
        }
    };
    const dependencies = {
        electron,
        './context': { context },
        './locale': { locale },
        './private-updater': { updateMenuItems: () => [{ id: 'update' }] },
        './remote-events': { emitRemoteEvent: (name) => events.push(name) },
        './tray': { restoreMainWindow: () => restored++ }
    };
    const module = { exports: {} };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '../../desktop/scripts/app-menu.js'), 'utf8'),
        { module, process: { platform: 'darwin' }, require: (name) => dependencies[name] }
    );
    module.exports.setMenu();
    return { items: template[0].submenu, events, context, restored: () => restored };
}

test('macOS app menu exposes localized Settings with Command+, after updates', () => {
    const f = fixture({ sysMenuSettings: 'Einstellungen…' });
    const index = f.items.findIndex((item) => item.id === 'settings');
    assert(index > f.items.findIndex((item) => item.id === 'update'));
    const item = f.items[index];
    assert.equal(item.label, 'Einstellungen…');
    assert.equal(item.accelerator, 'Command+,');
    assert.equal(f.items[index - 1].type, 'separator');
    assert.equal(f.items[index + 1].id, 'review-website-icons');
    item.click();
    assert.equal(f.restored(), 1);
    assert.deepEqual(f.events, ['show-settings']);
});

test('Settings has an English startup fallback and tolerates a closed window', () => {
    const f = fixture();
    const item = f.items.find((entry) => entry.id === 'settings');
    assert.equal(item.label, 'Settings…');
    f.context.mainWindow = null;
    assert.doesNotThrow(() => item.click());
    assert.equal(f.events.length, 0);
});

test('Website Icons menu opens the review without starting downloads', () => {
    const f = fixture({ sysMenuCheckWebsiteIcons: 'Website-Icons prüfen…' });
    const item = f.items.find((entry) => entry.id === 'review-website-icons');
    assert.equal(item.label, 'Website-Icons prüfen…');
    item.click();
    assert.deepEqual(f.events, ['review-website-icons']);
    assert.equal(f.restored(), 1);
    f.context.mainWindow = null;
    assert.doesNotThrow(() => item.click());
    assert.equal(f.events.length, 1);
});
