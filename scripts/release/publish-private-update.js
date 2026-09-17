/* eslint-env node */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');
const { validateRelease, FEED_URL } = require('../../desktop/scripts/private-update-feed');

const [directory, approval] = process.argv.slice(2);
if (!directory || approval !== '--publish') {
    throw new Error('Usage: publish-private-update.js <prepared-directory> --publish');
}
const release = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json')));
validateRelease(release, '00000000000000');
if (
    !release.clean ||
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ||
    release.sourceSha !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
) {
    throw new Error('Only the current clean, reviewed source revision may be published');
}
const {
    R2_ACCESS_KEY_ID: access,
    R2_SECRET_ACCESS_KEY: secret,
    CLOUDFLARE_ACCOUNT_ID: account
} = process.env;
if (!access || !secret || !/^[a-f0-9]{32}$/.test(account || '')) {
    throw new Error('R2 credentials and CLOUDFLARE_ACCOUNT_ID are required');
}
const bucket = 'michaeldewald-com-downloads';
const host = `${account}.r2.cloudflarestorage.com`;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

async function put(key, bytes, contentType, condition) {
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = date.slice(0, 8),
        scope = `${day}/auto/s3/aws4_request`;
    const uri = `/${bucket}/${key}`;
    const digest = hash(bytes);
    const signed = { host, ...condition, 'x-amz-content-sha256': digest, 'x-amz-date': date };
    const names = Object.keys(signed).sort();
    const signedNames = names.join(';');
    const headers = names.map((name) => `${name}:${signed[name]}\n`).join('');
    const canonical = `PUT\n${uri}\n\n${headers}\n${signedNames}\n${digest}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'auto'), 's3'), 'aws4_request');
    const signature = hmac(
        signingKey,
        `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`
    ).toString('hex');
    await new Promise((resolve, reject) => {
        const request = https.request(
            {
                host,
                path: uri,
                method: 'PUT',
                headers: {
                    ...condition,
                    'x-amz-date': date,
                    'x-amz-content-sha256': digest,
                    Authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
                    'Content-Length': bytes.length,
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store'
                }
            },
            (response) => {
                response.resume();
                response.on('end', () =>
                    response.statusCode >= 200 && response.statusCode < 300
                        ? resolve()
                        : reject(new Error(`R2 HTTP ${response.statusCode}`))
                );
            }
        );
        request.setTimeout(300000, () => request.destroy(new Error('Upload timeout')));
        request.on('error', reject);
        request.end(bytes);
    });
}
async function verify(url, expected) {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(300000) });
    if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(expected)) {
        throw new Error(`Public verification failed: ${url}`);
    }
}
async function ensureArtifact(key, url, bytes, contentType) {
    const existing = await fetch(url, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(30000)
    });
    if (existing.status === 404) {
        await put(key, bytes, contentType, { 'if-none-match': '*' });
    } else if (!existing.ok) {
        throw new Error(`Cannot inspect immutable artifact: HTTP ${existing.status}`);
    }
    await verify(url, bytes);
}
async function publish() {
    const zip = fs.readFileSync(path.join(directory, 'KeeWeb.zip'));
    if (hash(zip) !== release.sha256) {
        throw new Error('Archive checksum mismatch');
    }
    const update = fs.readFileSync(path.join(directory, 'update.json'));
    if (JSON.parse(update).url !== release.url) {
        throw new Error('Update URL mismatch');
    }
    const latest = fs.readFileSync(path.join(directory, 'latest.json'));
    const current = await fetch(FEED_URL, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30000)
    });
    let condition = { 'if-none-match': '*' };
    if (current.ok) {
        const bytes = Buffer.from(await current.arrayBuffer());
        const previous = JSON.parse(bytes);
        validateRelease(previous, '00000000000000');
        if (previous.build === release.build && hash(bytes) === hash(latest)) {
            await verify(release.url, zip);
            await verify(release.updateURL, update);
            process.stdout.write('Release already published and verified.\n');
            return;
        }
        if (previous.build >= release.build) {
            throw new Error('Refusing non-increasing release');
        }
        const etag = current.headers.get('etag');
        if (!etag) {
            throw new Error('Current feed has no ETag; cannot publish safely');
        }
        condition = { 'if-match': etag };
    } else if (current.status !== 404) {
        throw new Error(`Current feed HTTP ${current.status}`);
    }
    const root = `keeweb/arm64/${release.build}`;
    await ensureArtifact(`${root}/KeeWeb.zip`, release.url, zip, 'application/zip');
    await ensureArtifact(`${root}/update.json`, release.updateURL, update, 'application/json');
    await put('keeweb/arm64/latest.json', latest, 'application/json', condition);
    await verify(FEED_URL, latest);
    process.stdout.write(`Published and verified ${FEED_URL}\n`);
}
publish().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
