const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(
    path.join(__dirname, '../../scripts/release/publish-private-update.js'),
    'utf8'
);
const publishSource = source.slice(
    source.indexOf('async function publish()'),
    source.indexOf('publish().catch')
);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(forceWeak = false) {
    const zip = Buffer.from('signed test archive');
    const release = {
        build: '20260917174141',
        sha256: hash(zip),
        url: 'archive',
        updateURL: 'metadata'
    };
    const files = {
        'KeeWeb.zip': zip,
        'update.json': Buffer.from(JSON.stringify({ url: release.url })),
        'latest.json': Buffer.from(JSON.stringify(release))
    };
    const writes = [];
    const publish = vm.runInNewContext(publishSource + '\npublish;', {
        fs: { readFileSync: (name) => files[name] },
        path,
        directory: '.',
        release,
        hash,
        Buffer,
        AbortSignal,
        FEED_URL: 'feed',
        validateRelease() {},
        fetch: async (_url, options) => ({
            ok: true,
            arrayBuffer: async () => Buffer.from(JSON.stringify({ build: '20260917172037' })),
            headers: {
                get: () =>
                    options.headers?.['accept-encoding'] === 'identity' && !forceWeak
                        ? '"strong-etag"'
                        : 'W/"strong-etag"'
            }
        }),
        ensureArtifact: async () => {},
        put: async (_key, _bytes, _type, condition) => writes.push(condition),
        verify: async () => {},
        process: { stdout: { write() {} } }
    });
    return { publish, writes };
}

test('publisher requests an uncompressed feed and preserves its strong conditional ETag', async () => {
    const f = fixture();
    await f.publish();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0]['if-match'], '"strong-etag"');
});

test('publisher rejects a weak ETag before updating the feed', async () => {
    const f = fixture(true);
    await assert.rejects(f.publish, /no strong ETag/);
    assert.equal(f.writes.length, 0);
});

function artifactFixture(statusCode) {
    const calls = [];
    const ensureArtifact = vm.runInNewContext(
        source.slice(
            source.indexOf('async function ensureArtifact('),
            source.indexOf('async function publish()')
        ) + '\nensureArtifact;',
        {
            AbortSignal,
            put: async (...args) => {
                calls.push(['put', ...args]);
                if (statusCode) throw Object.assign(new Error('R2 failure'), { statusCode });
            },
            fetch: async () => {
                throw new Error('Public preflight would cache a missing artifact');
            },
            verify: async (...args) => calls.push(['verify', ...args])
        }
    );
    return { ensureArtifact, calls };
}

test('publisher uploads new artifacts before any public request can cache a 404', async () => {
    const f = artifactFixture();
    await f.ensureArtifact('key', 'url', 'bytes', 'application/zip');
    assert.deepEqual(
        f.calls.map((call) => call[0]),
        ['put', 'verify']
    );
    assert.equal(f.calls[0][4]['if-none-match'], '*');
});

test('publisher verifies immutable existing artifacts after a conditional conflict', async () => {
    const f = artifactFixture(412);
    await f.ensureArtifact('key', 'url', 'bytes', 'application/zip');
    assert.deepEqual(
        f.calls.map((call) => call[0]),
        ['put', 'verify']
    );
});

test('publisher propagates upload failures without public verification', async () => {
    const f = artifactFixture(403);
    await assert.rejects(
        () => f.ensureArtifact('key', 'url', 'bytes', 'application/zip'),
        /R2 failure/
    );
    assert.deepEqual(
        f.calls.map((call) => call[0]),
        ['put']
    );
});
