const electron = require('electron');
const url = require('url');

const { context } = require('./context');

function httpRequest(config, log, onLoad) {
    // eslint-disable-next-line node/no-deprecated-api
    const opts = url.parse(config.url);

    opts.method = config.method || 'GET';
    opts.headers = {
        'User-Agent': context.mainWindow.webContents.userAgent,
        ...config.headers
    };
    opts.timeout = 60000;

    let data;
    if (config.data) {
        if (config.dataIsMultipart) {
            data = Buffer.concat(config.data.map((chunk) => Buffer.from(chunk)));
        } else {
            data = Buffer.from(config.data);
        }
        // Electron's API doesn't like that, while node.js needs it
        // opts.headers['Content-Length'] = data.byteLength;
    }

    const req = electron.net.request(opts);

    req.on('response', (res) => {
        const chunks = [];
        const onClose = () => {
            log('info', 'HTTP response', opts.method, config.url, res.statusCode, res.headers);
            onLoad({
                status: res.statusCode,
                response: Buffer.concat(chunks).toString('hex'),
                headers: res.headers
            });
        };
        res.on('data', (chunk) => {
            chunks.push(chunk);
        });
        res.on('end', () => {
            onClose();
        });
    });
    req.on('error', (e) => {
        log('error', 'HTTP error', opts.method, config.url, e);
        return config.error && config.error('network error', {});
    });
    req.on('timeout', () => {
        req.abort();
        return config.error && config.error('timeout', {});
    });
    if (data) {
        req.write(data);
    }
    req.end();
}

module.exports = { httpRequest };
