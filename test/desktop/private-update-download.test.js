const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareUpdateDownload } = require('../../desktop/scripts/private-update-download');

const bytes = Buffer.from('verified archive bytes');
const release = {
    url: 'https://example.test/KeeWeb.zip',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
};
const mockFetch = async () =>
    new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
test('reports real downloaded bytes and serves only the verified archive on loopback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keeweb-download-test-'));
    const progress = [];
    let prepared;
    try {
        prepared = await prepareUpdateDownload({
            release,
            fetch: mockFetch,
            tempRoot: root,
            onProgress: (state) => progress.push(state),
            signal: new AbortController().signal
        });
        assert.equal(progress.at(-1).received, bytes.length);
        assert.equal(progress.at(-1).total, bytes.length);
        const feed = await (await fetch(prepared.updateURL)).json();
        assert.equal(new URL(feed.url).hostname, '127.0.0.1');
        assert.deepEqual(Buffer.from(await (await fetch(feed.url)).arrayBuffer()), bytes);
        assert.equal((await fetch(new URL('/KeeWeb.zip', feed.url))).status, 404);
        const cleanup = prepared.dispose();
        assert.deepEqual(fsSync.readdirSync(root), []);
        await cleanup;
    } finally {
        await prepared?.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('rejects corrupt archives and removes temporary files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keeweb-download-test-'));
    try {
        await assert.rejects(
            prepareUpdateDownload({
                release: { ...release, sha256: '0'.repeat(64) },
                fetch: mockFetch,
                tempRoot: root,
                onProgress() {},
                signal: new AbortController().signal
            }),
            /checksum/i
        );
        assert.deepEqual(await fs.readdir(root), []);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
test('cancels an in-flight download without leaving a staged archive', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keeweb-download-test-'));
    const abort = new AbortController();
    try {
        await assert.rejects(
            prepareUpdateDownload({
                release,
                tempRoot: root,
                signal: abort.signal,
                onProgress: ({ received }) => {
                    if (received) abort.abort();
                },
                fetch: async () =>
                    new Response(
                        new ReadableStream({
                            start(c) {
                                c.enqueue(bytes);
                            }
                        })
                    )
            }),
            /abort/i
        );
        assert.deepEqual(await fs.readdir(root), []);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
