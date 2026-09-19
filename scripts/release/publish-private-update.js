/* eslint-env node */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateRelease } = require('../../desktop/scripts/private-update-feed');
const { getUpdateChannel } = require('../../desktop/scripts/update-channels');
const { createR2Client, credentialsFromEnvironment } = require('./r2-client');
const { git } = require('./source-checkout');

const CHANNEL = 'development';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function publishPrivateUpdate({ directory, client, fetch, git, log }) {
    const feedURL = getUpdateChannel(CHANNEL).feedURL;
    const latest = fs.readFileSync(path.join(directory, 'latest.json'));
    const release = JSON.parse(latest);
    validateRelease(release, '00000000000000', CHANNEL);
    if (!release.clean || git.status() || release.sourceSha !== git.head()) {
        throw new Error('Only the current clean, reviewed source revision may be published');
    }
    const zip = fs.readFileSync(path.join(directory, 'KeeWeb.zip'));
    if (hash(zip) !== release.sha256) {
        throw new Error('Archive checksum mismatch');
    }
    const update = fs.readFileSync(path.join(directory, 'update.json'));
    if (JSON.parse(update).url !== release.url) {
        throw new Error('Update URL mismatch');
    }
    const current = await fetch(feedURL, {
        headers: { 'accept-encoding': 'identity' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30000)
    });
    let condition = { 'if-none-match': '*' };
    if (current.ok) {
        const bytes = Buffer.from(await current.arrayBuffer());
        const previous = JSON.parse(bytes);
        validateRelease(previous, '00000000000000', CHANNEL);
        if (previous.build === release.build && hash(bytes) === hash(latest)) {
            await client.verifyBytes(release.url, zip);
            await client.verifyBytes(release.updateURL, update);
            log('Release already published and verified.');
            return;
        }
        if (previous.build >= release.build) {
            throw new Error('Refusing non-increasing release');
        }
        const etag = current.headers.get('etag');
        if (!etag || etag.startsWith('W/')) {
            throw new Error('Current feed has no strong ETag; cannot publish safely');
        }
        condition = { 'if-match': etag };
    } else if (current.status !== 404) {
        throw new Error(`Current feed HTTP ${current.status}`);
    }
    const root = `keeweb/arm64/${release.build}`;
    await client.ensureImmutable(`${root}/KeeWeb.zip`, release.url, zip, 'application/zip');
    await client.ensureImmutable(
        `${root}/update.json`,
        release.updateURL,
        update,
        'application/json'
    );
    await client.putConditional('keeweb/arm64/latest.json', latest, 'application/json', condition);
    await client.verifyBytes(feedURL, latest);
    log(`Published and verified ${feedURL}`);
}

module.exports = { publishPrivateUpdate };

if (require.main === module) {
    const [directory, approval] = process.argv.slice(2);
    Promise.resolve()
        .then(() => {
            if (!directory || approval !== '--publish') {
                throw new Error('Usage: publish-private-update.js <prepared-directory> --publish');
            }
            const client = createR2Client({
                ...credentialsFromEnvironment(process.env),
                fetch,
                https: require('https')
            });
            return publishPrivateUpdate({
                directory,
                client,
                fetch,
                git,
                log: (message) => process.stdout.write(`${message}\n`)
            });
        })
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
