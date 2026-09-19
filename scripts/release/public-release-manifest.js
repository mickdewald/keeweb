/* eslint-env node */
const crypto = require('crypto');
const { getUpdateChannel } = require('../../desktop/scripts/update-channels');
const { validateRelease } = require('../../desktop/scripts/private-update-feed');

const BUNDLE_ID = 'com.mickdewald.keeweb';
const BUCKET = 'michaeldewald-com-downloads';
const PUBLIC_ORIGIN = 'https://downloads.michaeldewald.com';
const PUBLIC_ROOT_KEY = 'keeweb/public/arm64';
const LATEST_DMG_NAME = 'keeweb-latest-macos-arm64.dmg';
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function requirePublicBuild(buildInfo) {
    if (
        !buildInfo ||
        buildInfo.clean !== true ||
        buildInfo.smoke !== undefined ||
        buildInfo.channel !== 'public' ||
        !/^\d{14}$/.test(buildInfo.build) ||
        !/^[a-f0-9]{40}$/.test(buildInfo.sourceSha)
    ) {
        throw new Error('Only a clean-tree public production build can become a public release');
    }
}

function requireTimestamp(value) {
    const match = typeof value === 'string' && TIMESTAMP.exec(value);
    if (!match || new Date(value).toISOString().replace('.000Z', 'Z') !== value) {
        throw new Error('publishedAt must be a UTC YYYY-MM-DDThh:mm:ssZ timestamp');
    }
}

function buildKeys(build) {
    const root = `${PUBLIC_ROOT_KEY}/${build}`;
    const dmgName = `KeeWeb-${build}-macos-arm64.dmg`;
    return {
        dmgName,
        dmg: `${root}/${dmgName}`,
        checksum: `${root}/${dmgName}.sha256`,
        zip: `${root}/KeeWeb.zip`,
        update: `${root}/update.json`,
        release: `${root}/release.json`,
        latestDmg: `${PUBLIC_ROOT_KEY}/latest/${LATEST_DMG_NAME}`,
        latestChecksum: `${PUBLIC_ROOT_KEY}/latest/${LATEST_DMG_NAME}.sha256`,
        updates: `${PUBLIC_ROOT_KEY}/updates.json`,
        latest: `${PUBLIC_ROOT_KEY}/latest.json`
    };
}

function createPublicRelease({ buildInfo, version, dmgBytes, zipBytes, publishedAt }) {
    requirePublicBuild(buildInfo);
    requireTimestamp(publishedAt);
    if (typeof version !== 'string' || !version || version.length > 80) {
        throw new Error('Invalid KeeWeb version');
    }
    for (const bytes of [dmgBytes, zipBytes]) {
        if (!Buffer.isBuffer(bytes) || !bytes.length) {
            throw new Error('DMG and update archive bytes are required');
        }
    }
    const { build, sourceSha } = buildInfo;
    const keys = buildKeys(build);
    const base = `${getUpdateChannel('public').releaseRoot}${build}/`;
    const updateFeed = {
        schema: 1,
        bundleId: BUNDLE_ID,
        arch: 'arm64',
        build,
        version,
        url: `${base}KeeWeb.zip`,
        updateURL: `${base}update.json`,
        sha256: sha256(zipBytes),
        sourceSha,
        clean: true
    };
    validateRelease(updateFeed, '00000000000000', 'public');
    const update = { url: updateFeed.url, name: `KeeWeb ${version} (${build})` };
    const dmgSha = sha256(dmgBytes);
    const checksumText = `${dmgSha}  ${keys.dmgName}\n`;
    const latestChecksumText = `${dmgSha}  ${LATEST_DMG_NAME}\n`;
    const object = (key, bytes) => ({ key, sha256: sha256(bytes), sizeBytes: bytes.length });
    const release = {
        schema: 1,
        channel: 'public',
        bundleId: BUNDLE_ID,
        arch: 'arm64',
        build,
        version,
        sourceSha,
        classification: 'clean-tree',
        publishedAt,
        objects: {
            dmg: object(keys.dmg, dmgBytes),
            checksum: object(keys.checksum, Buffer.from(checksumText)),
            zip: object(keys.zip, zipBytes),
            update: object(keys.update, Buffer.from(json(update)))
        }
    };
    const websiteManifest = {
        schemaVersion: 1,
        app: { slug: 'keeweb', name: 'KeeWeb - Michael Dewald Fork', bundleId: BUNDLE_ID },
        build: {
            id: build,
            releaseTag: `keeweb-public-v${build}`,
            classification: 'clean-tree'
        },
        publishedAt,
        hosting: { provider: 'cloudflare-r2', bucket: BUCKET, publicBaseUrl: PUBLIC_ORIGIN },
        artifacts: {
            dmg: {
                name: keys.dmgName,
                key: keys.dmg,
                url: `${PUBLIC_ORIGIN}/${keys.dmg}`,
                sizeBytes: dmgBytes.length,
                contentType: 'application/x-apple-diskimage'
            },
            sha256: {
                name: `${keys.dmgName}.sha256`,
                key: keys.checksum,
                url: `${PUBLIC_ORIGIN}/${keys.checksum}`,
                value: dmgSha,
                contentType: 'text/plain; charset=utf-8'
            }
        }
    };
    return { release, updateFeed, update, websiteManifest, checksumText, latestChecksumText };
}

module.exports = {
    BUCKET,
    PUBLIC_ORIGIN,
    buildKeys,
    createPublicRelease,
    json,
    requirePublicBuild,
    sha256
};
