import { expect } from 'chai';
import { DetailsViewAttachments } from 'views/details/details-view-attachments';
import { AndroidPlatform } from 'comp/platform/android/android-platform';

describe('DetailsViewAttachments Android picker', () => {
    it('releases a pending attachment mutation when FileReader construction throws', () => {
        const OriginalFileReader = window.FileReader;
        class ThrowingFileReader {
            constructor() {
                throw new Error('reader unavailable');
            }
        }
        window.FileReader = ThrowingFileReader;
        const file = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            }
        };
        const view = { model: { file }, entryUpdated() {} };

        try {
            DetailsViewAttachments.addAttachedFiles.call(view, [{ name: 'report.pdf' }]);
            expect(file.pendingMutations).to.equal(0);
        } finally {
            window.FileReader = OriginalFileReader;
        }
    });

    it('does not apply a picked attachment after its original file closed', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        let resolvePicker;
        const selected = new Promise((resolve) => (resolvePicker = resolve));
        const file = {
            active: true,
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            }
        };
        let additions = 0;
        const entry = {
            file,
            addAttachment() {
                additions++;
                return Promise.resolve();
            }
        };
        const view = { model: entry, entryUpdated() {} };
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({ pickRead: () => selected });

        try {
            DetailsViewAttachments.attachmentBtnClick.call(view);
            await Promise.resolve();
            file.active = false;
            resolvePicker({ data: btoa('attachment'), name: 'report.pdf' });
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(additions).to.equal(0);
            expect(file.pendingMutations).to.equal(0);
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
        }
    });

    it('does not retarget a delayed browser file read after the active entry changed', async () => {
        const readers = [];
        const OriginalFileReader = window.FileReader;
        class TestFileReader {
            constructor() {
                readers.push(this);
            }

            readAsArrayBuffer() {}
        }
        window.FileReader = TestFileReader;
        const file = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            }
        };
        const entry = {
            file,
            addAttachment() {
                throw new Error('must not mutate a stale entry');
            }
        };
        const view = { model: entry, entryUpdated() {} };

        try {
            DetailsViewAttachments.addAttachedFiles.call(view, [{ name: 'report.pdf' }]);
            view.model = { file: { set() {} } };
            readers[0].onload({ target: { result: new ArrayBuffer(1) } });
            await Promise.resolve();

            expect(file.pendingMutations).to.equal(0);
        } finally {
            window.FileReader = OriginalFileReader;
        }
    });

    it('does not apply a picked attachment after the active entry changed', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        let resolvePicker;
        const selected = new Promise((resolve) => (resolvePicker = resolve));
        const file = {
            pendingMutations: 0,
            set(values) {
                Object.assign(this, values);
            }
        };
        const entry = {
            file,
            addAttachment(name, data) {
                this.added = { name, data };
                return Promise.resolve();
            }
        };
        const view = {
            model: entry,
            entryUpdated() {},
            $el: { find: () => [{ click() {} }] }
        };
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({ pickRead: () => selected });

        try {
            DetailsViewAttachments.attachmentBtnClick.call(view);
            expect(file.pendingMutations).to.equal(1);
            await Promise.resolve();

            view.model = {
                file: { set() {} },
                addAttachment() {
                    throw new Error('retargeted');
                }
            };
            resolvePicker({ data: btoa('attachment'), name: 'report.pdf' });
            await selected;
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(entry.added).to.equal(undefined);
            expect(file.pendingMutations).to.equal(0);
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
        }
    });
});
