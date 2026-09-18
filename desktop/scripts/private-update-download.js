const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

async function prepareUpdateDownload({ release, fetch, tempRoot, onProgress, signal }) {
    if (!/^[a-f0-9]{64}$/.test(release.sha256 || '')) {
        throw new Error('Missing archive checksum');
    }
    const directory = await fsp.mkdtemp(path.join(tempRoot, 'keeweb-update-'));
    const archive = path.join(directory, 'KeeWeb.zip');
    const abort = new AbortController();
    const cancel = () => {
        abort.abort(signal.reason);
        // will-quit cannot wait for promises; remove our private files before exit.
        fs.rmSync(directory, { recursive: true, force: true });
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let timer;
    let server;
    const resetTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => abort.abort(new Error('Download stalled')), 60000);
        timer.unref();
    };
    const dispose = async () => {
        server?.closeAllConnections();
        server?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    };
    try {
        resetTimeout();
        const response = await fetch(release.url, {
            cache: 'no-store',
            redirect: 'error',
            signal: abort.signal
        });
        if (!response.ok || !response.body) throw new Error(`Download HTTP ${response.status}`);
        const total = Number(response.headers.get('content-length')) || 0;
        const limit = 1024 * 1024 * 1024;
        if (total > limit) throw new Error('Update archive is too large');
        let received = 0;
        const digest = crypto.createHash('sha256');
        onProgress({ received, total });
        await pipeline(
            Readable.fromWeb(response.body),
            new Transform({
                transform(chunk, _encoding, next) {
                    received += chunk.length;
                    if (received > limit) return next(new Error('Update archive is too large'));
                    resetTimeout();
                    digest.update(chunk);
                    onProgress({ received, total });
                    next(null, chunk);
                }
            }),
            fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }),
            { signal: abort.signal }
        );
        if (digest.digest('hex') !== release.sha256 || (total && total !== received)) {
            throw new Error('Update archive checksum or length mismatch');
        }
        abort.signal.throwIfAborted();
        const token = crypto.randomBytes(24).toString('hex');
        server = http.createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            if (request.method !== 'GET') {
                response.writeHead(405).end();
            } else if (request.url === `/${token}/update.json`) {
                response.setHeader('Content-Type', 'application/json');
                response.end(
                    JSON.stringify({
                        url: `http://127.0.0.1:${server.address().port}/${token}/KeeWeb.zip`
                    })
                );
            } else if (request.url === `/${token}/KeeWeb.zip`) {
                response.setHeader('Content-Type', 'application/zip');
                response.setHeader('Content-Length', received);
                const stream = fs.createReadStream(archive);
                stream.on('error', () => response.destroy());
                response.on('close', () => stream.destroy());
                stream.pipe(response);
            } else {
                response.writeHead(404).end();
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        abort.signal.throwIfAborted();
        return {
            updateURL: `http://127.0.0.1:${server.address().port}/${token}/update.json`,
            dispose
        };
    } catch (error) {
        await dispose();
        throw error;
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}
module.exports = { prepareUpdateDownload };
