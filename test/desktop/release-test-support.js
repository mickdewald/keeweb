const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Fake `https` module: `respond(options, body)` returns { statusCode, headers, body }.
function fakeHttps(respond) {
    const requests = [];
    return {
        requests,
        request(options, callback) {
            const outgoing = new EventEmitter();
            outgoing.setTimeout = () => {};
            outgoing.destroy = () => {};
            outgoing.end = (body) => {
                requests.push({ ...options, body });
                const reply = respond(options, body);
                const response = new EventEmitter();
                response.statusCode = reply.statusCode;
                response.headers = reply.headers || {};
                callback(response);
                if (reply.body) {
                    response.emit('data', Buffer.from(reply.body));
                }
                response.emit('end');
            };
            return outgoing;
        }
    };
}

function publicResponse(bytes) {
    return bytes === undefined
        ? { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) }
        : { ok: true, status: 200, arrayBuffer: async () => Buffer.from(bytes) };
}

module.exports = { fakeHttps, hash, publicResponse };
