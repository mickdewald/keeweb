import * as kdbxweb from 'kdbxweb';
import { Timeouts } from 'const/timeouts';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';

function getExtension(name) {
    const extension = name.split('.').pop();
    return extension && extension !== name ? extension : 'bin';
}

const FileSaver = {
    async saveAs(blob, name, options = {}) {
        try {
            if (AndroidPlatform.isAndroid) {
                const data = new Uint8Array(await blob.arrayBuffer());
                const result = await AndroidPlatform.withNativeFlow(() =>
                    AndroidPlatform.plugin('DocumentFile').exportNew({
                        data: kdbxweb.ByteUtils.bytesToBase64(data),
                        suggestedName: name,
                        extension: getExtension(name),
                        mimeType: blob.type || 'application/octet-stream',
                        protectedUris: options.protectedUris || []
                    })
                );
                return { saved: true, result };
            }
            const link = document.createElement('a');

            link.download = name;
            link.rel = 'noopener';
            link.href = URL.createObjectURL(blob);

            document.body.appendChild(link);
            link.click();

            document.body.removeChild(link);

            setTimeout(() => {
                URL.revokeObjectURL(link.href);
            }, Timeouts.LinkDownloadRevoke);
            return { saved: true };
        } catch (err) {
            const code = err && err.code;
            if (code !== 'CANCELED') {
                Alerts.error({
                    header: Locale.setFileSaveError,
                    body:
                        code === 'REV_UNSUPPORTED'
                            ? Locale.androiddocCopyRequired
                            : Locale.setFileSaveErrorBody,
                    pre: (err && err.message) || String(err)
                });
            }
            return { saved: false, code };
        }
    }
};

export { FileSaver };
