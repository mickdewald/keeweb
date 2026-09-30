// app/scripts/storage/impl/storage-android-document.js
import * as kdbxweb from 'kdbxweb';
import { StorageBase } from 'storage/storage-base';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Events } from 'framework/events';
import { Locale } from 'util/locale';

const FRIENDLY_MESSAGES = {
    PERMISSION_LOST: 'openErrorFileNotFound',
    UNAVAILABLE: 'androiddocUnavailable'
};

// path: the document the failed call was about. Only a lost grant is announced, so the
// Android layer can offer to choose the file again; an unavailable document (e.g. Drive
// offline, grant still held) is a plain, retryable error. notFound is never set: a picked
// document always exists, and notFound would make sync try to create it.
function toError(e, path) {
    const code = e && e.code;
    const err = { message: (e && e.message) || String(e), code };
    // Sync shows errors via toString(); keep provider details (URIs) out of the UI for these.
    const friendly = FRIENDLY_MESSAGES[code];
    err.toString = () => (friendly ? Locale[friendly] : err.message);
    if (code === 'PERMISSION_LOST' && path) {
        Events.emit('android-document-unreachable', { path });
    }
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
                callback(toError(e, path));
            }
        );
    }

    stat(path, opts, callback) {
        this._settle(
            this.plugin.stat({ uri: path }),
            ({ rev }) => callback(null, { rev }),
            (e) => callback(toError(e, path))
        );
    }

    save(path, opts, data, callback, rev) {
        if (!rev) {
            // A picked document always exists and was loaded first; never truncate it blindly.
            callback(toError({ code: 'REV_REQUIRED', message: 'No revision to compare with' }));
            return;
        }
        const payload = {
            uri: path,
            data: kdbxweb.ByteUtils.bytesToBase64(data),
            expectedRev: rev
        };
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
                callback(toError(e, path));
            }
        );
    }

    // Releases the persisted grant of a document the app no longer uses.
    forget(path) {
        this._settle(
            this.plugin.release({ uri: path }),
            () => {},
            (e) => this.logger.info('Release failed', e && e.code)
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
