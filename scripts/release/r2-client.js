/* eslint-env node */
// Minimal Cloudflare R2 (S3 API) client for release publication. Credentials
// stay inside this closure and are never logged or attached to errors.
const crypto = require('crypto');

const BUCKET = 'michaeldewald-com-downloads';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

function credentialsFromEnvironment(env) {
    const {
        R2_ACCESS_KEY_ID: access,
        R2_SECRET_ACCESS_KEY: secret,
        CLOUDFLARE_ACCOUNT_ID: account
    } = env;
    if (!access || !secret || !/^[a-f0-9]{32}$/.test(account || '')) {
        throw new Error('R2 credentials and CLOUDFLARE_ACCOUNT_ID are required');
    }
    return { access, secret, account };
}

function createR2Client({ account, access, secret, fetch, https, now = () => new Date() }) {
    const host = `${account}.r2.cloudflarestorage.com`;

    function request(method, key, options = {}) {
        const {
            condition = {},
            bytes = Buffer.alloc(0),
            contentType,
            contentDisposition
        } = options;
        const date = now()
            .toISOString()
            .replace(/[:-]|\.\d{3}/g, '');
        const day = date.slice(0, 8);
        const scope = `${day}/auto/s3/aws4_request`;
        const uri = `/${BUCKET}/${key}`;
        const digest = hash(bytes);
        const signed = { host, ...condition, 'x-amz-content-sha256': digest, 'x-amz-date': date };
        const names = Object.keys(signed).sort();
        const signedNames = names.join(';');
        const headers = names.map((name) => `${name}:${signed[name]}\n`).join('');
        const canonical = `${method}\n${uri}\n\n${headers}\n${signedNames}\n${digest}`;
        const signingKey = hmac(
            hmac(hmac(hmac(`AWS4${secret}`, day), 'auto'), 's3'),
            'aws4_request'
        );
        const signature = hmac(
            signingKey,
            `AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`
        ).toString('hex');
        const upload = method === 'PUT';
        return new Promise((resolve, reject) => {
            const outgoing = https.request(
                {
                    host,
                    path: uri,
                    method,
                    headers: {
                        ...condition,
                        'x-amz-date': date,
                        'x-amz-content-sha256': digest,
                        Authorization: `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
                        ...(upload && {
                            'Content-Length': bytes.length,
                            'Content-Type': contentType,
                            'Cache-Control': 'no-store',
                            ...(contentDisposition && { 'Content-Disposition': contentDisposition })
                        })
                    }
                },
                (response) => {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () =>
                        resolve({
                            statusCode: response.statusCode,
                            etag: response.headers.etag,
                            bytes: Buffer.concat(chunks)
                        })
                    );
                    response.on('error', reject);
                }
            );
            outgoing.setTimeout(300000, () => outgoing.destroy(new Error('R2 request timeout')));
            outgoing.on('error', reject);
            outgoing.end(upload ? bytes : undefined);
        });
    }

    async function putConditional(key, bytes, contentType, condition, contentDisposition) {
        const response = await request('PUT', key, {
            condition,
            bytes,
            contentType,
            contentDisposition
        });
        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw Object.assign(new Error(`R2 HTTP ${response.statusCode}`), {
                statusCode: response.statusCode
            });
        }
    }

    async function verifyBytes(url, expected) {
        const response = await fetch(url, {
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(300000)
        });
        if (!response.ok || hash(Buffer.from(await response.arrayBuffer())) !== hash(expected)) {
            throw new Error(`Public verification failed: ${url}`);
        }
    }

    // Reads a mutable object through the authenticated S3 API (never the CDN, so a
    // missing object cannot be cached as a 404) and returns the compare-and-swap
    // condition for replacing exactly the state that was read.
    async function readMutable(key, { bodyless = false } = {}) {
        const response = await request(bodyless ? 'HEAD' : 'GET', key);
        if (response.statusCode === 404) {
            return { bytes: null, condition: { 'if-none-match': '*' } };
        }
        if (response.statusCode !== 200) {
            throw new Error(`R2 HTTP ${response.statusCode} while reading ${key}`);
        }
        if (!response.etag || response.etag.startsWith('W/') || !/^".+"$/.test(response.etag)) {
            throw new Error(`${key} has no strong ETag; cannot publish safely`);
        }
        return {
            bytes: bodyless ? null : response.bytes,
            condition: { 'if-match': response.etag }
        };
    }

    // A public request before upload can leave a cached 404 at the release URL, so
    // immutable objects are created conditionally and only then read publicly.
    async function ensureImmutable(key, url, bytes, contentType, contentDisposition) {
        let existed = false;
        try {
            const condition = { 'if-none-match': '*' };
            await putConditional(key, bytes, contentType, condition, contentDisposition);
        } catch (error) {
            if (error.statusCode !== 412) {
                throw error;
            }
            existed = true;
        }
        try {
            await verifyBytes(url, bytes);
        } catch (error) {
            throw existed
                ? new Error(`Immutable object already exists with different bytes: ${key}`)
                : error;
        }
    }

    return { putConditional, verifyBytes, readMutable, ensureImmutable };
}

module.exports = { BUCKET, createR2Client, credentialsFromEnvironment };
