import { expect } from 'chai';
import { SettingsFileSaveMixin } from 'views/settings/settings-file-view-save';
import { beginPendingMutation } from 'models/file-mutation-tracker';
import { FileSaver } from 'util/ui/file-saver';
import { AndroidPlatform } from 'comp/platform/android/android-platform';

describe('SettingsFileSaveMixin pending mutations', () => {
    it('syncs the current writable Android document from the main save action', () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        let exports = 0;
        let syncs = 0;
        const view = {
            ...SettingsFileSaveMixin,
            model: { storage: 'androiddoc' },
            saveToFile() {
                exports++;
            },
            save() {
                syncs++;
            }
        };

        AndroidPlatform.isAndroid = true;
        try {
            view.saveDefault();

            expect(exports).to.equal(0);
            expect(syncs).to.equal(1);
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
        }
    });

    it('waits for a pending mutation before serializing an exported database copy', () => {
        const originalSaveAs = FileSaver.saveAs;
        let serializations = 0;
        const model = {
            name: 'Main',
            editVersion: 7,
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            },
            getData(callback) {
                serializations++;
                callback(new Uint8Array([1]).buffer);
            }
        };
        const view = { ...SettingsFileSaveMixin, model };
        const completeMutation = beginPendingMutation(model);
        FileSaver.saveAs = () => Promise.resolve({ saved: true });

        try {
            view.saveToFile(true);
            expect(serializations).to.equal(0);

            completeMutation();
            expect(serializations).to.equal(1);
        } finally {
            FileSaver.saveAs = originalSaveAs;
        }
    });

    it('waits for a clean pending mutation before closing', () => {
        const model = {
            pendingMutations: 0,
            modified: false,
            set(values) {
                Object.assign(this, values);
            }
        };
        let closed = 0;
        const view = {
            ...SettingsFileSaveMixin,
            model,
            closeFileNoCheck() {
                closed++;
            }
        };
        const completeMutation = beginPendingMutation(model);

        view.closeFile();
        expect(closed).to.equal(0);

        completeMutation();
        expect(closed).to.equal(1);
    });
});
