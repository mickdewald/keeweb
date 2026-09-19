const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createR2Client } = require('../../scripts/release/r2-client');
const { publishPrivateUpdate } = require('../../scripts/release/publish-private-update');
const { fakeHttps, hash, publicResponse } = require('./release-test-support');

const FEED = 'https://downloads.michaeldewald.com/keeweb/arm64/latest.json';
const secrets = { account: 'a'.repeat(32), access: 'ACCESS-KEY-ID', secret: 'SECRET-ACCESS-KEY' };

function release(build, zip) {
    const base = `https://downloads.michaeldewald.com/keeweb/arm64/${build}/`;
    return {
        schema: 1,
        bundleId: 'com.mickdewald.keeweb',
        arch: 'arm64',
        build,
        version: '1.18.7',
        url: `${base}KeeWeb.zip`,
        updateURL: `${base}update.json`,
        sha256: hash(zip),
        sourceSha: 'b'.repeat(40),
        clean: true
    };
}

function fixture({
    etag = '"strong-etag"',
    previousBuild = '20260917172037',
    artifactsPublished = false
} = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-private-publish-'));
    const zip = Buffer.from('signed test archive');
    const next = release('20260917174141', zip);
    const files = {
        'KeeWeb.zip': zip,
        'update.json': Buffer.from(JSON.stringify({ url: next.url })),
        'latest.json': Buffer.from(JSON.stringify(next))
    };
    for (const [name, bytes] of Object.entries(files)) {
        fs.writeFileSync(path.join(directory, name), bytes);
    }
    const published = new Map([[FEED, Buffer.from(JSON.stringify(release(previousBuild, zip)))]]);
    if (artifactsPublished) {
        published.set(next.url, zip).set(next.updateURL, files['update.json']);
    }
    const feedRequests = [];
    const calls = [];
    const client = {
        ensureImmutable: async (key, url, bytes) => {
            calls.push(['immutable', key]);
            published.set(url, bytes);
        },
        putConditional: async (key, bytes, _type, condition) => {
            calls.push(['put', key, condition]);
            published.set(FEED, bytes);
        },
        verifyBytes: async (url, bytes) => {
            calls.push(['verify', url]);
            assert.equal(hash(published.get(url)), hash(bytes));
        }
    };
    const fetch = async (url, options) => {
        feedRequests.push([url, options.headers]);
        return { ...publicResponse(published.get(url)), headers: { get: () => etag } };
    };
    const git = { status: () => '', head: () => next.sourceSha };
    const run = (overrides = {}) =>
        publishPrivateUpdate({ directory, client, fetch, git, log() {}, ...overrides });
    return { run, calls, feedRequests, next, directory };
}

test('publisher requests an uncompressed feed and preserves its strong conditional ETag', async () => {
    const f = fixture();
    await f.run();
    assert.deepEqual(f.feedRequests, [[FEED, { 'accept-encoding': 'identity' }]]);
    assert.deepEqual(f.calls, [
        ['immutable', 'keeweb/arm64/20260917174141/KeeWeb.zip'],
        ['immutable', 'keeweb/arm64/20260917174141/update.json'],
        ['put', 'keeweb/arm64/latest.json', { 'if-match': '"strong-etag"' }],
        ['verify', FEED]
    ]);
});

test('publisher rejects a weak or missing ETag before any upload', async () => {
    for (const etag of ['W/"strong-etag"', null]) {
        const f = fixture({ etag });
        await assert.rejects(f.run, /no strong ETag/);
        assert.deepEqual(f.calls, []);
    }
});

test('publisher refuses non-increasing, dirty, wrong-source and cross-channel releases', async () => {
    await assert.rejects(fixture({ previousBuild: '20260918000000' }).run, /non-increasing/);
    const f = fixture();
    await assert.rejects(() =>
        f.run({ git: { status: () => ' M file', head: () => f.next.sourceSha } })
    );
    await assert.rejects(() => f.run({ git: { status: () => '', head: () => 'c'.repeat(40) } }));
    assert.deepEqual(f.calls, []);
});

test('publisher only re-verifies an identical release that is already published', async () => {
    const f = fixture({ previousBuild: '20260917174141', artifactsPublished: true });
    await f.run();
    assert.deepEqual(f.calls, [
        ['verify', f.next.url],
        ['verify', f.next.updateURL]
    ]);
});

function clientFixture(respond, publicBytes) {
    const https = fakeHttps(respond);
    const fetched = [];
    const client = createR2Client({
        ...secrets,
        https,
        fetch: async (url) => {
            fetched.push(url);
            return publicResponse(publicBytes);
        }
    });
    return { client, https, fetched };
}

test('client uploads new artifacts before any public request can cache a 404', async () => {
    const f = clientFixture(() => ({ statusCode: 200 }), 'bytes');
    await f.client.ensureImmutable('key', 'url', Buffer.from('bytes'), 'application/zip');
    assert.equal(f.https.requests.length, 1);
    assert.equal(f.https.requests[0].method, 'PUT');
    assert.equal(f.https.requests[0].headers['if-none-match'], '*');
    assert.equal(f.https.requests[0].path, '/michaeldewald-com-downloads/key');
    assert.deepEqual(f.fetched, ['url']);
});

test('client reuses an existing immutable object only when its public bytes are identical', async () => {
    const same = clientFixture(() => ({ statusCode: 412 }), 'bytes');
    await same.client.ensureImmutable('key', 'url', Buffer.from('bytes'), 'application/zip');
    const different = clientFixture(() => ({ statusCode: 412 }), 'other bytes');
    await assert.rejects(
        () =>
            different.client.ensureImmutable('key', 'url', Buffer.from('bytes'), 'application/zip'),
        /already exists with different bytes/
    );
});

test('client propagates upload failures without public verification or secrets', async () => {
    const f = clientFixture(() => ({ statusCode: 403 }), 'bytes');
    await assert.rejects(
        () => f.client.ensureImmutable('key', 'url', Buffer.from('bytes'), 'application/zip'),
        (error) => {
            assert.equal(error.statusCode, 403);
            assert.doesNotMatch(
                `${error.message}${error.stack}`,
                /SECRET-ACCESS-KEY|ACCESS-KEY-ID/
            );
            return true;
        }
    );
    assert.deepEqual(f.fetched, []);
});

test('publisher refuses a prepared release of the public channel', async () => {
    const f = fixture();
    const crossChannel = {
        ...f.next,
        url: f.next.url.replace('/keeweb/arm64/', '/keeweb/public/arm64/'),
        updateURL: f.next.updateURL.replace('/keeweb/arm64/', '/keeweb/public/arm64/')
    };
    fs.writeFileSync(path.join(f.directory, 'latest.json'), JSON.stringify(crossChannel));
    await assert.rejects(f.run, /development KeeWeb channel/);
    assert.deepEqual(f.calls, []);
});

test('client signs requests with AWS Signature V4 and never sends the secret', async () => {
    const crypto = require('node:crypto');
    const at = new Date('2026-09-19T12:00:00.000Z');
    const https = fakeHttps(() => ({ statusCode: 200 }));
    const client = createR2Client({ ...secrets, https, fetch: async () => {}, now: () => at });
    const bytes = Buffer.from('payload');
    await client.putConditional(
        'a/b.json',
        bytes,
        'application/json',
        { 'if-match': '"e"' },
        'attachment'
    );
    const sent = https.requests[0];
    // Independent reference implementation of the SigV4 derivation.
    const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
    const host = `${secrets.account}.r2.cloudflarestorage.com`;
    const canonical = [
        'PUT',
        '/michaeldewald-com-downloads/a/b.json',
        '',
        `host:${host}`,
        'if-match:"e"',
        `x-amz-content-sha256:${hash(bytes)}`,
        'x-amz-date:20260919T120000Z',
        '',
        'host;if-match;x-amz-content-sha256;x-amz-date',
        hash(bytes)
    ].join('\n');
    const toSign = [
        'AWS4-HMAC-SHA256',
        '20260919T120000Z',
        '20260919/auto/s3/aws4_request',
        hash(canonical)
    ].join('\n');
    const key = ['20260919', 'auto', 's3', 'aws4_request'].reduce(hmac, `AWS4${secrets.secret}`);
    assert.equal(
        sent.headers.Authorization,
        `AWS4-HMAC-SHA256 Credential=${
            secrets.access
        }/20260919/auto/s3/aws4_request, SignedHeaders=host;if-match;x-amz-content-sha256;x-amz-date, Signature=${hmac(
            key,
            toSign
        ).toString('hex')}`
    );
    assert.equal(sent.headers['Content-Disposition'], 'attachment');
    assert.equal(sent.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(JSON.stringify(sent.headers), /SECRET-ACCESS-KEY/);
});

test('client reads large mutable objects with a bodyless HEAD request', async () => {
    const f = clientFixture(() => ({ statusCode: 200, headers: { etag: '"dmg"' } }));
    assert.deepEqual(await f.client.readMutable('latest.dmg', { bodyless: true }), {
        bytes: null,
        condition: { 'if-match': '"dmg"' }
    });
    assert.equal(f.https.requests[0].method, 'HEAD');
    assert.equal(f.https.requests[0].headers['Content-Length'], undefined);
});

test('client reads mutable objects through the S3 API and demands a strong ETag', async () => {
    const missing = clientFixture(() => ({ statusCode: 404 }));
    assert.deepEqual(await missing.client.readMutable('pointer.json'), {
        bytes: null,
        condition: { 'if-none-match': '*' }
    });
    assert.deepEqual(missing.fetched, []);
    const strong = clientFixture(() => ({
        statusCode: 200,
        headers: { etag: '"abc"' },
        body: 'current'
    }));
    const state = await strong.client.readMutable('pointer.json');
    assert.equal(state.bytes.toString(), 'current');
    assert.deepEqual(state.condition, { 'if-match': '"abc"' });
    assert.equal(strong.https.requests[0].method, 'GET');
    for (const etag of ['W/"abc"', undefined, 'abc']) {
        const weak = clientFixture(() => ({ statusCode: 200, headers: { etag }, body: 'x' }));
        await assert.rejects(() => weak.client.readMutable('pointer.json'), /no strong ETag/);
    }
    const broken = clientFixture(() => ({ statusCode: 500 }));
    await assert.rejects(() => broken.client.readMutable('pointer.json'), /HTTP 500/);
});
