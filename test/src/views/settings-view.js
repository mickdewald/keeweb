import { expect } from 'chai';
import { SettingsView } from 'views/settings/settings-view';

describe('SettingsView', () => {
    it('keeps file-scoped search results on the currently selected database', () => {
        const firstFile = { id: 'first' };
        const currentFile = { id: 'current' };
        const firstItem = { page: 'file', file: firstFile };
        const currentItem = { page: 'file', file: currentFile };
        const view = {
            file: currentFile,
            model: {
                menu: {
                    menus: {
                        settings: [{ items: [firstItem, currentItem] }]
                    }
                }
            }
        };

        const result = SettingsView.prototype.findSettingsMenuItem.call(view, 'file', null);

        expect(result).to.equal(currentItem);
    });
});
