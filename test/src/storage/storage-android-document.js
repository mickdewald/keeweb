// test/src/storage/storage-android-document.js
import { expect } from 'chai';
import { StorageAndroidDocument } from 'storage/impl/storage-android-document';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Events } from 'framework/events';
import { Locale } from 'util/locale';

function storageWith(plugin) {
    const s = new StorageAndroidDocument(plugin);
    s.logger = { debug() {}, error() {}, info() {} };
    return s;
}

const cb = () => {
    let done;
    const p = new Promise((resolve) => (done = resolve));
    return { fn: (...args) => done(args), p };
};

describe('StorageAndroidDocument', () => {
    it('loads bytes and returns the live content revision and write capability', async () => {
        const s = storageWith({
            read: () => Promise.resolve({ data: btoa('abc'), rev: 'h1', writable: true })
        });
        const c = cb();
        s.load('content://doc', {}, c.fn);
        const [err, data, stat] = await c.p;
        expect(err).to.equal(null);
        expect(new Uint8Array(data)).to.eql(new Uint8Array([97, 98, 99]));
        expect(stat).to.eql({ rev: 'h1', writable: true });
    });

    it('reports a rev conflict and writes nothing when the remote changed', async () => {
        const s = storageWith({
            write: () => Promise.reject({ code: 'REV_CONFLICT' }),
            stat: () => Promise.resolve({ rev: 'h2' })
        });
        const c = cb();
        s.save('content://doc', {}, new Uint8Array([1]).buffer, c.fn, 'h1');
        const [err, stat] = await c.p;
        expect(err).to.eql({ revConflict: true });
        expect(stat).to.eql({ rev: 'h2' });
    });

    it('returns the new rev after a successful save', async () => {
        const s = storageWith({
            write: ({ expectedRev }) => Promise.resolve({ rev: `after-${expectedRev}` })
        });
        const c = cb();
        s.save('content://doc', {}, new Uint8Array([1]).buffer, c.fn, 'h1');
        const [err, stat] = await c.p;
        expect(err).to.equal(null);
        expect(stat).to.eql({ rev: 'after-h1' });
    });

    it('calls back once when the success callback throws', async () => {
        const s = storageWith({ read: () => Promise.resolve({ data: btoa('abc'), rev: 'h1' }) });
        const logged = [];
        s.logger.error = (...args) => logged.push(args);
        const calls = [];
        s.load('content://doc', {}, (err) => {
            calls.push(err);
            throw new Error('bug in the caller');
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).to.eql([null]);
        expect(logged[0][1].message).to.equal('bug in the caller');
    });

    it('reports a lost permission without notFound: a picked document is never created', async () => {
        const s = storageWith({
            stat: () => Promise.reject({ code: 'PERMISSION_LOST', message: 'gone' })
        });
        const c = cb();
        s.stat('content://doc', {}, c.fn);
        const [err] = await c.p;
        // notFound would send sync into its "file does not exist, creating" branch.
        expect(err.notFound).to.equal(undefined);
        expect(err.code).to.equal('PERMISSION_LOST');
        // KeeWeb shows sync errors via toString(); a plain object would read "[object Object]".
        expect(String(err)).to.equal('File not found');
    });

    it('treats an offline document with its grant still held as temporarily unavailable', async () => {
        const seen = [];
        const listener = (e) => seen.push(e.path);
        Events.on('android-document-unreachable', listener);
        let err;
        try {
            const s = storageWith({
                stat: () =>
                    Promise.reject({ code: 'UNAVAILABLE', message: 'content://drive/x: FNF' })
            });
            const c = cb();
            s.stat('content://drive/x', {}, c.fn);
            [err] = await c.p;
        } finally {
            Events.off('android-document-unreachable', listener);
        }
        expect(seen).to.eql([]);
        expect(err.notFound).to.equal(undefined);
        expect(err.code).to.equal('UNAVAILABLE');
        // Friendly text without the provider's URI.
        expect(String(err)).to.equal(Locale.androiddocUnavailable);
        expect(String(err)).to.not.contain('content://');
    });

    it('shows the provider message for other errors', async () => {
        const s = storageWith({ read: () => Promise.reject({ code: 'IO', message: 'disk full' }) });
        const c = cb();
        s.load('content://doc', {}, c.fn);
        const [err] = await c.p;
        expect(err.notFound).to.equal(undefined);
        expect(err.code).to.equal('IO');
        expect(String(err)).to.equal('disk full');
    });

    it('opens the picker and hands back path, name and write capability', async () => {
        const s = storageWith({
            pick: () => Promise.resolve({ uri: 'content://doc', name: 'Main.kdbx', writable: true })
        });
        const c = cb();
        s.pick(c.fn);
        const [err, file] = await c.p;
        expect(err).to.equal(null);
        expect(file).to.eql({ path: 'content://doc', name: 'Main.kdbx', opts: { writable: true } });
    });

    it('keeps the document read-only when a live stat reports no write grant', async () => {
        const s = storageWith({ stat: () => Promise.resolve({ rev: 'h1', writable: false }) });
        const c = cb();
        s.stat('content://doc', {}, c.fn);
        const [err, stat] = await c.p;
        expect(err).to.equal(null);
        expect(stat).to.eql({ rev: 'h1', writable: false });
    });

    it('marks the picker as a native flow so leaving for it does not lock', async () => {
        let pendingDuringPick;
        const s = storageWith({
            pick: () => {
                pendingDuringPick = AndroidPlatform.nativeFlowPending;
                return Promise.reject({ code: 'CANCELED', message: 'Picker canceled' });
            }
        });
        const c = cb();
        s.pick(c.fn);
        const [err] = await c.p;
        expect(pendingDuringPick).to.equal(true);
        expect(err.code).to.equal('CANCELED');
        expect(AndroidPlatform.nativeFlowPending).to.equal(false);
    });

    it('refuses to save without a known rev and never writes blindly', async () => {
        let writes = 0;
        const s = storageWith({ write: () => writes++ && Promise.resolve({ rev: 'x' }) });
        const c = cb();
        s.save('content://doc', {}, new Uint8Array([1]).buffer, c.fn, null);
        const [err] = await c.p;
        expect(err.code).to.equal('REV_REQUIRED');
        expect(writes).to.equal(0);
    });

    it('announces an unreachable document with its path', async () => {
        const seen = [];
        const listener = (e) => seen.push(e.path);
        Events.on('android-document-unreachable', listener);
        try {
            const s = storageWith({
                stat: () => Promise.reject({ code: 'PERMISSION_LOST', message: 'gone' }),
                read: () => Promise.reject({ code: 'UNAVAILABLE', message: 'offline' })
            });
            const c1 = cb();
            s.stat('content://gone', {}, c1.fn);
            await c1.p;
            const c2 = cb();
            s.load('content://io', {}, c2.fn);
            await c2.p;
        } finally {
            Events.off('android-document-unreachable', listener);
        }
        expect(seen).to.eql(['content://gone']);
    });

    it('forgets a document by releasing its grant and ignores failures', async () => {
        const released = [];
        const s = storageWith({
            release: ({ uri }) => {
                released.push(uri);
                return Promise.reject({ code: 'IO', message: 'not held' });
            }
        });
        s.forget('content://old');
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(released).to.eql(['content://old']);
    });
});
