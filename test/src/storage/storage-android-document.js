// test/src/storage/storage-android-document.js
import { expect } from 'chai';
import { StorageAndroidDocument } from 'storage/impl/storage-android-document';
import { AndroidPlatform } from 'comp/platform/android/android-platform';

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
    it('loads bytes and returns the content hash as rev', async () => {
        const s = storageWith({ read: () => Promise.resolve({ data: btoa('abc'), rev: 'h1' }) });
        const c = cb();
        s.load('content://doc', {}, c.fn);
        const [err, data, stat] = await c.p;
        expect(err).to.equal(null);
        expect(new Uint8Array(data)).to.eql(new Uint8Array([97, 98, 99]));
        expect(stat).to.eql({ rev: 'h1' });
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

    it('maps a lost permission to notFound so KeeWeb offers to reopen', async () => {
        const s = storageWith({
            stat: () => Promise.reject({ code: 'PERMISSION_LOST', message: 'gone' })
        });
        const c = cb();
        s.stat('content://doc', {}, c.fn);
        const [err] = await c.p;
        expect(err.notFound).to.equal(true);
        // KeeWeb shows sync errors via toString(); a plain object would read "[object Object]".
        expect(String(err)).to.equal('File not found');
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

    it('opens the picker and hands back path and name', async () => {
        const s = storageWith({
            pick: () => Promise.resolve({ uri: 'content://doc', name: 'Main.kdbx' })
        });
        const c = cb();
        s.pick(c.fn);
        const [err, file] = await c.p;
        expect(err).to.equal(null);
        expect(file).to.eql({ path: 'content://doc', name: 'Main.kdbx' });
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
});
