const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPublicRelease } = require('../../scripts/release/public-release-manifest');
const { validateRelease } = require('../../desktop/scripts/private-update-feed');

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const dmgBytes = Buffer.from('notarized dmg fixture');
const zipBytes = Buffer.from('stapled app zip fixture');
const buildInfo = {
    build: '20260919120000',
    sourceSha: 'a'.repeat(40),
    clean: true,
    channel: 'public'
};
const input = {
    buildInfo,
    version: '1.18.7',
    dmgBytes,
    zipBytes,
    publishedAt: '2026-09-19T12:30:00Z'
};
const root = 'https://downloads.michaeldewald.com/keeweb/public/arm64';

test('describes immutable build objects and the public updater feed', () => {
    const { release, updateFeed, update, checksumText } = createPublicRelease(input);
    assert.deepEqual(updateFeed, {
        schema: 1,
        bundleId: 'com.mickdewald.keeweb',
        arch: 'arm64',
        build: '20260919120000',
        version: '1.18.7',
        url: `${root}/20260919120000/KeeWeb.zip`,
        updateURL: `${root}/20260919120000/update.json`,
        sha256: sha(zipBytes),
        sourceSha: buildInfo.sourceSha,
        clean: true
    });
    assert.equal(validateRelease(updateFeed, '20260919110000', 'public'), updateFeed);
    assert.throws(() => validateRelease(updateFeed, '20260919110000', 'development'));
    assert.deepEqual(update, { url: updateFeed.url, name: 'KeeWeb 1.18.7 (20260919120000)' });
    assert.equal(checksumText, `${sha(dmgBytes)}  KeeWeb-20260919120000-macos-arm64.dmg\n`);
    assert.equal(release.schema, 1);
    assert.equal(release.channel, 'public');
    assert.equal(release.classification, 'clean-tree');
    assert.equal(release.sourceSha, buildInfo.sourceSha);
    assert.deepEqual(release.objects, {
        dmg: {
            key: 'keeweb/public/arm64/20260919120000/KeeWeb-20260919120000-macos-arm64.dmg',
            sha256: sha(dmgBytes),
            sizeBytes: dmgBytes.length
        },
        checksum: {
            key: 'keeweb/public/arm64/20260919120000/KeeWeb-20260919120000-macos-arm64.dmg.sha256',
            sha256: sha(Buffer.from(checksumText)),
            sizeBytes: Buffer.byteLength(checksumText)
        },
        zip: {
            key: 'keeweb/public/arm64/20260919120000/KeeWeb.zip',
            sha256: sha(zipBytes),
            sizeBytes: zipBytes.length
        },
        update: {
            key: 'keeweb/public/arm64/20260919120000/update.json',
            sha256: release.objects.update.sha256,
            sizeBytes: release.objects.update.sizeBytes
        }
    });
    assert.match(release.objects.update.sha256, /^[a-f0-9]{64}$/);
});

test('emits the strict schema-v1 website manifest with immutable build URLs', () => {
    const { websiteManifest, latestChecksumText } = createPublicRelease(input);
    const dmgKey = 'keeweb/public/arm64/20260919120000/KeeWeb-20260919120000-macos-arm64.dmg';
    assert.deepEqual(websiteManifest, {
        schemaVersion: 1,
        app: {
            slug: 'keeweb',
            name: 'KeeWeb - Michael Dewald Fork',
            bundleId: 'com.mickdewald.keeweb'
        },
        build: {
            id: '20260919120000',
            releaseTag: 'keeweb-public-v20260919120000',
            classification: 'clean-tree'
        },
        publishedAt: '2026-09-19T12:30:00Z',
        hosting: {
            provider: 'cloudflare-r2',
            bucket: 'michaeldewald-com-downloads',
            publicBaseUrl: 'https://downloads.michaeldewald.com'
        },
        artifacts: {
            dmg: {
                name: 'KeeWeb-20260919120000-macos-arm64.dmg',
                key: dmgKey,
                url: `https://downloads.michaeldewald.com/${dmgKey}`,
                sizeBytes: dmgBytes.length,
                contentType: 'application/x-apple-diskimage'
            },
            sha256: {
                name: 'KeeWeb-20260919120000-macos-arm64.dmg.sha256',
                key: `${dmgKey}.sha256`,
                url: `https://downloads.michaeldewald.com/${dmgKey}.sha256`,
                value: sha(dmgBytes),
                contentType: 'text/plain; charset=utf-8'
            }
        }
    });
    assert.equal(latestChecksumText, `${sha(dmgBytes)}  keeweb-latest-macos-arm64.dmg\n`);
});

test('refuses anything that is not a clean public production build', () => {
    for (const change of [
        { clean: false },
        { clean: 'true' },
        { smoke: true },
        { channel: 'development' },
        { channel: undefined },
        { sourceSha: 'abc123' },
        { sourceSha: 'A'.repeat(40) },
        { build: '2026091912000' },
        { build: 'next' }
    ]) {
        assert.throws(
            () => createPublicRelease({ ...input, buildInfo: { ...buildInfo, ...change } }),
            `accepted ${JSON.stringify(change)}`
        );
    }
    assert.throws(() => createPublicRelease({ ...input, version: '' }));
    assert.throws(() => createPublicRelease({ ...input, dmgBytes: Buffer.alloc(0) }));
    assert.throws(() => createPublicRelease({ ...input, zipBytes: 'not bytes' }));
    assert.throws(() => createPublicRelease({ ...input, publishedAt: '2026-09-19 12:30' }));
    assert.throws(() => createPublicRelease({ ...input, publishedAt: '2026-02-30T12:30:00Z' }));
});
