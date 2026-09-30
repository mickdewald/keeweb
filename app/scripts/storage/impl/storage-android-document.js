// app/scripts/storage/impl/storage-android-document.js
import * as kdbxweb from 'kdbxweb';
import { StorageBase } from 'storage/storage-base';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Locale } from 'util/locale';

function toError(e) {
    const code = e && e.code;
    const err = { message: (e && e.message) || String(e), code };
    if (code === 'NOT_FOUND' || code === 'PERMISSION_LOST') {
        err.notFound = true;
    }
    // Sync shows errors via toString(); keep provider details (URIs) out of the UI for these.
    err.toString = () => (err.notFound ? Locale.openErrorFileNotFound : err.message);
    return err;
}

class StorageAndroidDocument extends StorageBase {
    name = 'androiddoc';
    icon = 'folder-open';
    enabled = AndroidPlatform.isAndroid;
    uipos = 5;

    constructor(plugin) {
        super();
        this._plugin = plugin;
    }

    get plugin() {
        if (!this._plugin) {
            this._plugin = AndroidPlatform.plugin('DocumentFile');
        }
        return this._plugin;
    }

    pick(callback) {
        this._settle(
            AndroidPlatform.withNativeFlow(() => this.plugin.pick()),
            ({ uri, name }) => callback(null, { path: uri, name }),
            (e) => callback(toError(e))
        );
    }

    load(path, opts, callback) {
        this._settle(
            this.plugin.read({ uri: path }),
            ({ data, rev }) => {
                const bytes = kdbxweb.ByteUtils.base64ToBytes(data);
                const buffer = bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength
                );
                callback(null, buffer, { rev });
            },
            (e) => {
                this.logger.error('Load error', e);
                callback(toError(e));
            }
        );
    }

    stat(path, opts, callback) {
        this._settle(
            this.plugin.stat({ uri: path }),
            ({ rev }) => callback(null, { rev }),
            (e) => callback(toError(e))
        );
    }

    save(path, opts, data, callback, rev) {
        const payload = { uri: path, data: kdbxweb.ByteUtils.bytesToBase64(data) };
        if (rev) {
            payload.expectedRev = rev;
        }
        this._settle(
            this.plugin.write(payload),
            (res) => callback(null, { rev: res.rev }),
            (e) => {
                if (e && e.code === 'REV_CONFLICT') {
                    this.stat(path, opts, (err, stat) =>
                        err ? callback(err) : callback({ revConflict: true }, stat)
                    );
                    return;
                }
                this.logger.error('Save error', e);
                callback(toError(e));
            }
        );
    }

    // Each call reports exactly once: an exception thrown by the caller's callback must not
    // come back as a second, error callback (that could start a second sync on the same file).
    _settle(promise, onResult, onError) {
        const guard = (fn) => (value) => {
            try {
                fn(value);
            } catch (e) {
                this.logger.error('Storage callback failed', e);
            }
        };
        promise.then(guard(onResult), guard(onError));
    }
}

export { StorageAndroidDocument };
