import { expect } from 'chai';
import { normalizeListItemSpacing } from 'util/ui/list-item-spacing';
import { DefaultAppSettings } from 'const/default-app-settings';
import { AppSettingsModel } from 'models/app-settings-model';
import { SettingsStore } from 'comp/settings/settings-store';
import { SettingsGeneralView } from 'views/settings/settings-general-view';

describe('entry list spacing', () => {
    it('uses a roomier default and bounds persisted values', () => {
        expect(DefaultAppSettings.listItemSpacing).to.equal(8);
        for (const value of [undefined, null, NaN, Infinity, '12']) {
            expect(normalizeListItemSpacing(value)).to.equal(8);
        }
        expect(normalizeListItemSpacing(-10)).to.equal(0);
        expect(normalizeListItemSpacing(30)).to.equal(24);
        expect(normalizeListItemSpacing(11.6)).to.equal(12);
    });

    it('persists slider changes and restores them on load', async () => {
        const originalSave = SettingsStore.save;
        const originalLoad = SettingsStore.load;
        const originalSpacing = AppSettingsModel.listItemSpacing;
        let saved;
        let displayed;
        SettingsStore.save = (key, data) => {
            if (key === 'app-settings') saved = data;
            return Promise.resolve();
        };
        SettingsStore.load = () => Promise.resolve(saved);
        try {
            SettingsGeneralView.prototype.changeListItemSpacing.call(
                { $el: { find: () => ({ text: (value) => (displayed = value) }) } },
                { target: { value: '16' } }
            );
            expect(displayed).to.equal('16 px');
            expect(saved.listItemSpacing).to.equal(16);
            AppSettingsModel.set({ listItemSpacing: 0 }, { silent: true });
            await AppSettingsModel.load();
            expect(AppSettingsModel.listItemSpacing).to.equal(16);
        } finally {
            AppSettingsModel.set({ listItemSpacing: originalSpacing }, { silent: true });
            SettingsStore.save = originalSave;
            SettingsStore.load = originalLoad;
        }
    });
});
