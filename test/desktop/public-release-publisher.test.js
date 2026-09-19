const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPublicRelease, json } = require('../../scripts/release/public-release-manifest');
const {
    publishPublicRelease,
    readEmbeddedBuildInfo
} = require('../../scripts/release/publish-public-release');
const { hash } = require('./release-test-support');

const ORIGIN = 'https://downloads.michaeldewald.com/';
const ROOT = 'keeweb/public/arm64';
const sourceSha = 'd'.repeat(40);

function prepare(build, { dmg = 'notarized dmg', zip = 'stapled zip' } = {}) {
    const dmgBytes = Buffer.from(`${dmg} ${build}`);
    const zipBytes = Buffer.from(`${zip} ${build}`);
    const prepared = createPublicRelease({
        buildInfo: { build, sourceSha, clean: true, channel: 'public' },
        version: '1.18.7',
        dmgBytes,
        zipBytes,
        publishedAt: '2026-09-19T12:30:00Z'
    });
    const dmgName = `KeeWeb-${build}-macos-arm64.dmg`;
    return {
        [dmgName]: dmgBytes,
        [`${dmgName}.sha256`]: Buffer.from(prepared.checksumText),
        'latest.dmg.sha256': Buffer.from(prepared.latestChecksumText),
        'KeeWeb.zip': zipBytes,
        'update.json': Buffer.from(json(prepared.update)),
        'release.json': Buffer.from(json(prepared.release)),
        'updates.json': Buffer.from(json(prepared.updateFeed)),
        'latest.json': Buffer.from(json(prepared.websiteManifest))
    };
}

function fixture({ build = '20260919120000', bucket = {}, tamper, failVerify } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-public-publish-'));
    const files = { ...prepare(build), ...tamper };
    for (const [name, bytes] of Object.entries(files)) {
        if (bytes !== null) {
            fs.writeFileSync(path.join(directory, name), bytes);
        }
    }
    const objects = new Map(Object.entries(bucket));
    const calls = [];
    const dispositions = {};
    const client = {
        readMutable: async (key, options = {}) => {
            calls.push(['read', key]);
            const current = objects.get(key);
            if (!current) {
                return { bytes: null, condition: { 'if-none-match': '*' } };
            }
            if (current.weak) {
                throw new Error(`${key} has no strong ETag; cannot publish safely`);
            }
            return {
                bytes: options.bodyless ? null : current.bytes,
                condition: { 'if-match': `"${hash(current.bytes).slice(0, 8)}"` }
            };
        },
        ensureImmutable: async (key, url, bytes, _type, disposition) => {
            dispositions[key] = disposition;
            calls.push(['immutable', key]);
            assert.equal(url, `${ORIGIN}${key}`);
            const current = objects.get(key);
            if (current && hash(current.bytes) !== hash(bytes)) {
                throw new Error(`Immutable object already exists with different bytes: ${key}`);
            }
            objects.set(key, { bytes });
            if (failVerify === key) {
                throw new Error(`Public verification failed: ${url}`);
            }
        },
        putConditional: async (key, bytes, _type, condition, disposition) => {
            dispositions[key] = disposition;
            calls.push(['put', key, Object.keys(condition)[0]]);
            objects.set(key, { bytes });
        },
        verifyBytes: async (url, bytes) => {
            const key = url.slice(ORIGIN.length);
            calls.push(['verify', key]);
            if (failVerify === key || hash(objects.get(key).bytes) !== hash(bytes)) {
                throw new Error(`Public verification failed: ${url}`);
            }
        }
    };
    const git = { status: () => '', head: () => sourceSha };
    const readEmbeddedBuildInfo = (zipPath) => {
        assert.equal(zipPath, path.join(directory, 'KeeWeb.zip'));
        return { build, sourceSha, clean: true, channel: 'public' };
    };
    const run = (overrides = {}) =>
        publishPublicRelease({
            directory,
            client,
            git,
            readEmbeddedBuildInfo,
            log() {},
            ...overrides
        });
    return { run, calls, objects, files, build, dispositions };
}

const writes = (calls) => calls.filter(([kind]) => kind === 'immutable' || kind === 'put');

test('verifies the extracted signed archive before trusting its build metadata', () => {
    const calls = [];
    const build = readEmbeddedBuildInfo('/fixture/KeeWeb.zip', {
        extractArchive(_zip, destination) {
            fs.mkdirSync(path.join(destination, 'KeeWeb.app/Contents/Resources'), {
                recursive: true
            });
            calls.push('extract');
        },
        verifyUpdateApp(app, channel) {
            assert.match(app, /KeeWeb\.app$/);
            assert.equal(channel, 'public');
            calls.push('signature');
        },
        verifyEmbeddedProfile() {
            calls.push('profile');
        },
        validateStaple() {
            calls.push('staple');
        },
        assessGatekeeper() {
            calls.push('gatekeeper');
        },
        readBuildInfo() {
            calls.push('metadata');
            return { build: '20260919120000' };
        }
    });
    assert.deepEqual(build, { build: '20260919120000' });
    assert.deepEqual(calls, [
        'extract',
        'signature',
        'profile',
        'staple',
        'gatekeeper',
        'metadata'
    ]);
});

test('refuses an unverified archive before any R2 operation', async () => {
    const f = fixture();
    await assert.rejects(
        f.run({
            readEmbeddedBuildInfo: () => {
                throw new Error('archive signature is invalid');
            }
        }),
        /archive signature is invalid/
    );
    assert.deepEqual(f.calls, []);
});

test('publishes immutable objects first and the website manifest last', async () => {
    const f = fixture();
    await f.run();
    const base = `${ROOT}/20260919120000`;
    assert.deepEqual(writes(f.calls), [
        ['immutable', `${base}/KeeWeb-20260919120000-macos-arm64.dmg`],
        ['immutable', `${base}/KeeWeb-20260919120000-macos-arm64.dmg.sha256`],
        ['immutable', `${base}/KeeWeb.zip`],
        ['immutable', `${base}/update.json`],
        ['immutable', `${base}/release.json`],
        ['put', `${ROOT}/latest/keeweb-latest-macos-arm64.dmg`, 'if-none-match'],
        ['put', `${ROOT}/latest/keeweb-latest-macos-arm64.dmg.sha256`, 'if-none-match'],
        ['put', `${ROOT}/updates.json`, 'if-none-match'],
        ['put', `${ROOT}/latest.json`, 'if-none-match']
    ]);
    // Every mutable write is publicly byte-verified before the next pointer advances.
    const order = f.calls
        .filter(([kind]) => kind !== 'read')
        .map(([kind, key]) => `${kind} ${key}`);
    for (const key of [
        `${ROOT}/latest/keeweb-latest-macos-arm64.dmg`,
        `${ROOT}/latest/keeweb-latest-macos-arm64.dmg.sha256`,
        `${ROOT}/updates.json`,
        `${ROOT}/latest.json`
    ]) {
        assert.equal(order.indexOf(`verify ${key}`), order.indexOf(`put ${key}`) + 1);
    }
    assert.equal(order.at(-1), `verify ${ROOT}/latest.json`);
    assert.equal(
        f.objects.get(`${ROOT}/latest/keeweb-latest-macos-arm64.dmg.sha256`).bytes.toString(),
        f.files['latest.dmg.sha256'].toString()
    );
});

function published(build) {
    const files = prepare(build);
    return {
        [`${ROOT}/latest/keeweb-latest-macos-arm64.dmg`]: {
            bytes: files[`KeeWeb-${build}-macos-arm64.dmg`]
        },
        [`${ROOT}/latest/keeweb-latest-macos-arm64.dmg.sha256`]: {
            bytes: files['latest.dmg.sha256']
        },
        [`${ROOT}/updates.json`]: { bytes: files['updates.json'] },
        [`${ROOT}/latest.json`]: { bytes: files['latest.json'] }
    };
}

test('replaces existing pointers only through strong-ETag compare-and-swap', async () => {
    const f = fixture({ bucket: published('20260919110000') });
    await f.run();
    assert.deepEqual(
        writes(f.calls)
            .filter(([kind]) => kind === 'put')
            .map(([, , condition]) => condition),
        ['if-match', 'if-match', 'if-match', 'if-match']
    );
});

test('refuses weak ETags before writing anything', async () => {
    for (const key of [`${ROOT}/updates.json`, `${ROOT}/latest.json`]) {
        const bucket = published('20260919110000');
        bucket[key].weak = true;
        const f = fixture({ bucket });
        await assert.rejects(f.run, /no strong ETag/);
        assert.deepEqual(writes(f.calls), []);
    }
});

test('refuses non-increasing builds before writing anything', async () => {
    for (const current of ['20260919130000', '20260919120000']) {
        const bucket = published(current);
        if (current === '20260919120000') {
            // Same build ID but a different (rebuilt) release must never replace it.
            Object.assign(bucket, published(current));
            bucket[`${ROOT}/updates.json`] = {
                bytes: Buffer.from(
                    bucket[`${ROOT}/updates.json`].bytes
                        .toString()
                        .replace(/"sha256": "../, '"sha256": "00')
                )
            };
        }
        const f = fixture({ bucket });
        await assert.rejects(f.run, /non-increasing/);
        assert.deepEqual(writes(f.calls), []);
    }
});

test('an identical retry re-verifies everything and stays idempotent', async () => {
    const first = fixture();
    await first.run();
    const retry = fixture({ bucket: Object.fromEntries(first.objects) });
    await retry.run();
    assert.equal(writes(retry.calls).at(-1)[1], `${ROOT}/latest.json`);
});

test('different bytes at an immutable key are a hard stop before any pointer moves', async () => {
    const key = `${ROOT}/20260919120000/KeeWeb.zip`;
    const f = fixture({ bucket: { [key]: { bytes: Buffer.from('someone else') } } });
    await assert.rejects(f.run, /already exists with different bytes/);
    assert.deepEqual(
        writes(f.calls).filter(([kind]) => kind === 'put'),
        []
    );
});

test('any failed public verification leaves the website manifest unpublished', async () => {
    const base = `${ROOT}/20260919120000`;
    for (const key of [
        `${base}/KeeWeb-20260919120000-macos-arm64.dmg`,
        `${base}/KeeWeb-20260919120000-macos-arm64.dmg.sha256`,
        `${base}/KeeWeb.zip`,
        `${base}/update.json`,
        `${base}/release.json`,
        `${ROOT}/latest/keeweb-latest-macos-arm64.dmg`,
        `${ROOT}/latest/keeweb-latest-macos-arm64.dmg.sha256`,
        `${ROOT}/updates.json`
    ]) {
        const f = fixture({ failVerify: key });
        await assert.rejects(f.run, /Public verification failed/);
        assert.equal(f.objects.has(`${ROOT}/latest.json`), false, `published after ${key}`);
    }
});

test('requires the clean checkout of exactly the embedded source revision', async () => {
    const f = fixture();
    await assert.rejects(() => f.run({ git: { status: () => '?? stray', head: () => sourceSha } }));
    await assert.rejects(() => f.run({ git: { status: () => '', head: () => 'e'.repeat(40) } }));
    assert.deepEqual(f.calls, []);
});

test('the archive itself must embed exactly the released clean public source revision', async () => {
    const embedded = { build: '20260919120000', sourceSha, clean: true, channel: 'public' };
    for (const change of [
        { sourceSha: 'f'.repeat(40) },
        { build: '20260919115959' },
        { clean: false },
        { channel: 'development' },
        { smoke: true }
    ]) {
        const f = fixture();
        await assert.rejects(
            () => f.run({ readEmbeddedBuildInfo: () => ({ ...embedded, ...change }) }),
            /embedded build metadata/,
            `accepted ${JSON.stringify(change)}`
        );
        assert.deepEqual(f.calls, []);
    }
});

test('downloads are served as attachments with their public file names', async () => {
    const f = fixture();
    await f.run();
    assert.equal(
        f.dispositions[`${ROOT}/latest/keeweb-latest-macos-arm64.dmg`],
        'attachment; filename="keeweb-latest-macos-arm64.dmg"'
    );
    assert.equal(
        f.dispositions[`${ROOT}/20260919120000/KeeWeb-20260919120000-macos-arm64.dmg`],
        'attachment; filename="KeeWeb-20260919120000-macos-arm64.dmg"'
    );
    assert.equal(f.dispositions[`${ROOT}/latest.json`], undefined);
});

test('re-validates every local byte against the release description', async () => {
    const other = prepare('20260919120000', { dmg: 'swapped dmg' });
    const dmgName = 'KeeWeb-20260919120000-macos-arm64.dmg';
    for (const tamper of [
        { [dmgName]: other[dmgName] },
        { 'KeeWeb.zip': Buffer.from('swapped zip') },
        { [`${dmgName}.sha256`]: other[`${dmgName}.sha256`] },
        { 'latest.dmg.sha256': other['latest.dmg.sha256'] },
        { 'latest.json': other['latest.json'] },
        { 'updates.json': prepare('20260919120000', { zip: 'swapped' })['updates.json'] },
        { 'update.json': Buffer.from('{"url":"https://example.com/KeeWeb.zip"}') },
        {
            'release.json': Buffer.from(
                other['release.json'].toString().replace('clean-tree', 'local-draft')
            )
        },
        {
            'release.json': Buffer.from(
                other['release.json'].toString().replace('"public"', '"development"')
            )
        },
        { 'latest.json': null }
    ]) {
        const f = fixture({ tamper });
        await assert.rejects(f.run, `accepted tampered ${Object.keys(tamper)}`);
        assert.deepEqual(f.calls, []);
    }
});

test('an interrupted replacement preserves the bytes advertised by every cached manifest', async () => {
    const first = fixture({ build: '20260919110000' });
    await first.run();
    const cached = JSON.parse(first.files['latest.json']);
    for (const key of [
        `${ROOT}/latest/keeweb-latest-macos-arm64.dmg`,
        `${ROOT}/latest/keeweb-latest-macos-arm64.dmg.sha256`,
        `${ROOT}/updates.json`,
        `${ROOT}/latest.json`
    ]) {
        const next = fixture({ bucket: Object.fromEntries(first.objects), failVerify: key });
        await assert.rejects(next.run, /Public verification failed/);
        for (const manifest of [
            cached,
            JSON.parse(next.objects.get(`${ROOT}/latest.json`).bytes)
        ]) {
            const downloaded = next.objects.get(manifest.artifacts.dmg.key).bytes;
            assert.equal(
                hash(downloaded),
                manifest.artifacts.sha256.value,
                `mismatch after ${key}`
            );
            assert.equal(
                next.objects.get(manifest.artifacts.sha256.key).bytes.toString().split(' ')[0],
                hash(downloaded)
            );
        }
    }
});
