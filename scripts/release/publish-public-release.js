/* eslint-env node */
// Publishes a prepared public release transactionally: immutable build objects
// first, then the stable download aliases, then the updater feed, and the
// website-facing latest.json last. Every write is byte-verified publicly before
// the next pointer advances.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateRelease } = require('../../desktop/scripts/private-update-feed');
const {
    PUBLIC_ORIGIN,
    buildKeys,
    createPublicRelease,
    json
} = require('./public-release-manifest');
const { createR2Client, credentialsFromEnvironment } = require('./r2-client');
const { git } = require('./source-checkout');
const { verifyUpdateApp } = require('./verify-update-app');
const { verifyEmbeddedProfile } = require('./provisioning-profile');

const TYPES = {
    dmg: 'application/x-apple-diskimage',
    text: 'text/plain; charset=utf-8',
    zip: 'application/zip',
    json: 'application/json'
};

function loadPreparedRelease(directory) {
    const read = (name) => fs.readFileSync(path.join(directory, name));
    const described = JSON.parse(read('release.json'));
    const keys = buildKeys(String(described.build));
    const dmgBytes = read(keys.dmgName);
    const zipBytes = read('KeeWeb.zip');
    // Regenerating every document from the artifact bytes proves that the prepared
    // directory is exactly what the reviewed generator produces for them.
    const expected = createPublicRelease({
        buildInfo: {
            build: described.build,
            sourceSha: described.sourceSha,
            clean: described.classification === 'clean-tree',
            channel: described.channel
        },
        version: described.version,
        dmgBytes,
        zipBytes,
        publishedAt: described.publishedAt
    });
    const documents = {
        'release.json': json(expected.release),
        'update.json': json(expected.update),
        'updates.json': json(expected.updateFeed),
        'latest.json': json(expected.websiteManifest),
        [`${keys.dmgName}.sha256`]: expected.checksumText,
        'latest.dmg.sha256': expected.latestChecksumText
    };
    for (const [name, text] of Object.entries(documents)) {
        if (!read(name).equals(Buffer.from(text))) {
            throw new Error(`Prepared ${name} does not match the release artifacts`);
        }
    }
    const bytes = (name) => Buffer.from(documents[name]);
    return { expected, keys, dmgBytes, zipBytes, bytes };
}

function requireIncreasing(current, currentBuild, next, nextBuild) {
    if (currentBuild > nextBuild || (currentBuild === nextBuild && !current.equals(next))) {
        throw new Error('Refusing non-increasing release');
    }
}

// release.json is self-attested; the signed app inside the update archive is the
// authority for which source revision and channel these bytes were built from.
function requireEmbeddedBuild(embedded, release) {
    if (
        !embedded ||
        embedded.build !== release.build ||
        embedded.sourceSha !== release.sourceSha ||
        embedded.clean !== true ||
        embedded.channel !== 'public' ||
        embedded.smoke !== undefined
    ) {
        throw new Error('The archive embedded build metadata does not match the release');
    }
}

function validateStaple(appPath) {
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', appPath], { stdio: 'ignore' });
}

function assessGatekeeper(appPath) {
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', appPath], {
        stdio: 'ignore'
    });
}

function readEmbeddedBuildInfo(zipPath, tools = {}) {
    const extractArchive =
        tools.extractArchive ||
        ((archive, destination) =>
            execFileSync('/usr/bin/ditto', ['-x', '-k', archive, destination]));
    const readBuildInfo =
        tools.readBuildInfo ||
        ((archive) =>
            JSON.parse(require('asar').extractFile(archive, 'private-update-build.json')));
    const verifyApp = tools.verifyUpdateApp || verifyUpdateApp;
    const verifyProfile = tools.verifyEmbeddedProfile || verifyEmbeddedProfile;
    const validate = tools.validateStaple || validateStaple;
    const assess = tools.assessGatekeeper || assessGatekeeper;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-publish-'));
    try {
        extractArchive(zipPath, scratch);
        const appPath = path.join(scratch, 'KeeWeb.app');
        verifyApp(appPath, 'public');
        verifyProfile(appPath);
        validate(appPath);
        assess(appPath);
        return readBuildInfo(path.join(appPath, 'Contents/Resources/app.asar'));
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

async function publishPublicRelease({ directory, client, git, readEmbeddedBuildInfo, log }) {
    const { expected, keys, dmgBytes, zipBytes, bytes } = loadPreparedRelease(directory);
    if (git.status() || expected.release.sourceSha !== git.head()) {
        throw new Error('Only the current clean, reviewed source revision may be published');
    }
    requireEmbeddedBuild(
        readEmbeddedBuildInfo(path.join(directory, 'KeeWeb.zip')),
        expected.release
    );
    const build = expected.release.build;
    const mutable = {
        latestDmg: await client.readMutable(keys.latestDmg, { bodyless: true }),
        latestChecksum: await client.readMutable(keys.latestChecksum, { bodyless: true }),
        updates: await client.readMutable(keys.updates),
        latest: await client.readMutable(keys.latest)
    };
    if (mutable.updates.bytes) {
        const current = JSON.parse(mutable.updates.bytes);
        validateRelease(current, '00000000000000', 'public');
        requireIncreasing(mutable.updates.bytes, current.build, bytes('updates.json'), build);
    }
    if (mutable.latest.bytes) {
        const currentBuild = JSON.parse(mutable.latest.bytes)?.build?.id;
        if (!/^\d{14}$/.test(currentBuild)) {
            throw new Error('Current website manifest is invalid');
        }
        requireIncreasing(mutable.latest.bytes, currentBuild, bytes('latest.json'), build);
    }
    const url = (key) => `${PUBLIC_ORIGIN}/${key}`;
    const attachment = (key) => `attachment; filename="${path.posix.basename(key)}"`;
    for (const [key, body, type, disposition] of [
        [keys.dmg, dmgBytes, TYPES.dmg, attachment(keys.dmg)],
        [keys.checksum, bytes(`${keys.dmgName}.sha256`), TYPES.text],
        [keys.zip, zipBytes, TYPES.zip],
        [keys.update, bytes('update.json'), TYPES.json],
        [keys.release, bytes('release.json'), TYPES.json]
    ]) {
        await client.ensureImmutable(key, url(key), body, type, disposition);
        log(`Immutable object verified: ${key}`);
    }
    for (const [key, body, type, state, disposition] of [
        [keys.latestDmg, dmgBytes, TYPES.dmg, mutable.latestDmg, attachment(keys.latestDmg)],
        [keys.latestChecksum, bytes('latest.dmg.sha256'), TYPES.text, mutable.latestChecksum],
        [keys.updates, bytes('updates.json'), TYPES.json, mutable.updates],
        [keys.latest, bytes('latest.json'), TYPES.json, mutable.latest]
    ]) {
        await client.putConditional(key, body, type, state.condition, disposition);
        await client.verifyBytes(url(key), body);
        log(`Pointer advanced and verified: ${key}`);
    }
    log(`Published KeeWeb public build ${build}`);
}

module.exports = { publishPublicRelease, readEmbeddedBuildInfo };

if (require.main === module) {
    const [directory, approval] = process.argv.slice(2);
    Promise.resolve()
        .then(() => {
            if (!directory || approval !== '--publish') {
                throw new Error('Usage: publish-public-release.js <prepared-directory> --publish');
            }
            const client = createR2Client({
                ...credentialsFromEnvironment(process.env),
                fetch,
                https: require('https')
            });
            return publishPublicRelease({
                directory,
                client,
                git,
                readEmbeddedBuildInfo,
                log: (message) => process.stdout.write(`${message}\n`)
            });
        })
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
