import { expect } from 'chai';
import { FileSaver } from 'util/ui/file-saver';
import { AndroidPlatform } from 'comp/platform/android/android-platform';

describe('FileSaver Android export', () => {
    it('returns an explicit unsaved cancellation result', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({ exportNew: () => Promise.reject({ code: 'CANCELED' }) });

        try {
            expect(
                await FileSaver.saveAs(
                    new Blob([new Uint8Array([1])], { type: 'application/octet-stream' }),
                    'Main.kdbx'
                )
            ).to.eql({ saved: false, code: 'CANCELED' });
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
        }
    });

    it('exports a new external document and returns its verified result', async () => {
        const originalIsAndroid = AndroidPlatform.isAndroid;
        const originalPlugin = AndroidPlatform.plugin;
        const exports = [];
        AndroidPlatform.isAndroid = true;
        AndroidPlatform.plugin = () => ({
            exportNew: (payload) => {
                exports.push(payload);
                return Promise.resolve({
                    uri: 'content://exports/new.kdbx',
                    name: 'new.kdbx',
                    rev: 'r1'
                });
            }
        });

        try {
            const result = await FileSaver.saveAs(
                new Blob([new Uint8Array([0, 1, 255])], { type: 'application/octet-stream' }),
                'Main.kdbx',
                { protectedUris: ['content://document/current'] }
            );

            expect(exports).to.eql([
                {
                    data: 'AAH/',
                    suggestedName: 'Main.kdbx',
                    extension: 'kdbx',
                    mimeType: 'application/octet-stream',
                    protectedUris: ['content://document/current']
                }
            ]);
            expect(result).to.eql({
                saved: true,
                result: { uri: 'content://exports/new.kdbx', name: 'new.kdbx', rev: 'r1' }
            });
        } finally {
            AndroidPlatform.isAndroid = originalIsAndroid;
            AndroidPlatform.plugin = originalPlugin;
        }
    });
});
