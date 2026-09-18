/* eslint-env node */
// Build-only fixture, copied over the packaged entrypoint by --updater-smoke.
// Does not load KeeWeb, password databases, Keychain or privacy-protected services.
const { app, autoUpdater, net } = require('electron');
const crypto = require('crypto');
const { prepareUpdateDownload } = require('./scripts/private-update-download');
const { createUpdateProgress } = require('./scripts/private-update-progress');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Transform } = require('stream');
const { PrivateUpdaterController } = require('./scripts/private-updater-controller');
const { build, smoke } = require('./private-update-build.json');
if (!smoke) {
    throw new Error('Not an updater smoke fixture');
}
const bundle = process.execPath.slice(0, process.execPath.indexOf('.app') + 4);
const config = JSON.parse(fs.readFileSync(path.join(path.dirname(bundle), 'smoke.json')));
app.setPath('userData', config.userData);
function report(value) {
    fs.appendFileSync(config.result, JSON.stringify(value) + '\n');
}
app.whenReady().then(() => {
    report({ stage: 'launch', build });
    if (build > config.fromBuild) {
        report({ stage: 'updated', build });
        app.quit();
        return;
    }
    const server = http.createServer((req, res) => {
        if (req.url === '/update.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/KeeWeb.zip` })
            );
        } else if (req.url === '/KeeWeb.zip') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Length', fs.statSync(config.archive).size);
            fs.createReadStream(config.archive)
                .pipe(
                    new Transform({
                        transform(chunk, encoding, next) {
                            setTimeout(() => next(null, chunk), config.chunkDelayMs || 0);
                        }
                    })
                )
                .pipe(res);
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    server.listen(0, '127.0.0.1', () => {
        const controller = new PrivateUpdaterController({
            app,
            autoUpdater,
            dialog: {
                showMessageBox: async (options) => {
                    report({ stage: 'dialog', message: options.message });
                    return { response: 0 };
                }
            },
            fetchRelease: async () => ({
                version: 'smoke',
                build: config.toBuild,
                updateURL: `http://127.0.0.1:${server.address().port}/update.json`,
                url: `http://127.0.0.1:${server.address().port}/KeeWeb.zip`,
                sha256: crypto
                    .createHash('sha256')
                    .update(fs.readFileSync(config.archive))
                    .digest('hex')
            }),
            prepareDownload: (release, signal, onProgress) =>
                prepareUpdateDownload({
                    release,
                    signal,
                    tempRoot: app.getPath('temp'),
                    fetch: (url, options) => net.fetch(url, options),
                    onProgress: (value) => {
                        report({ stage: 'progress', ...value });
                        onProgress(value);
                    }
                }),
            progress: createUpdateProgress(() => controller.cancelDownload()),
            settings: {},
            saveSettings: async () => {},
            build,
            log: (error) => report({ error })
        });
        app.on('before-quit', (event) => controller.finishInstall(event));
        setTimeout(() => controller.check(), config.startDelayMs || 0);
    });
});
setTimeout(() => {
    report({ error: 'Smoke timed out' });
    app.exit(1);
}, 120000).unref();
