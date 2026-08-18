const { emitRemoteEvent } = require('./remote-events');

let perfTimestamps = [{ name: 'pre-init', ts: process.hrtime() }];

const startupLogging =
    process.argv.some((arg) => arg.startsWith('--startup-logging')) ||
    process.env.KEEWEB_STARTUP_LOGGING === '1';

function pushPerfTimestamp(name) {
    perfTimestamps?.push({ name, ts: process.hrtime() });
}

function logProgress(name) {
    pushPerfTimestamp(name);
    logStartupMessage(name);
}

function logStartupMessage(msg) {
    if (startupLogging) {
        // eslint-disable-next-line no-console
        console.log('[startup]', msg);
    }
}

function reportStartProfile() {
    if (!perfTimestamps) {
        return;
    }

    const processCreationTime = process.getCreationTime();
    const totalTime = Math.round(Date.now() - processCreationTime);
    let lastTs = 0;
    const timings = perfTimestamps
        .map((milestone) => {
            const ts = milestone.ts;
            const elapsed = lastTs
                ? Math.round((ts[0] - lastTs[0]) * 1e3 + (ts[1] - lastTs[1]) / 1e6)
                : 0;
            lastTs = ts;
            return {
                name: milestone.name,
                elapsed
            };
        })
        .slice(1);

    perfTimestamps = undefined;

    const startProfile = { totalTime, timings };
    emitRemoteEvent('start-profile', startProfile);
}

module.exports = { pushPerfTimestamp, logProgress, logStartupMessage, reportStartProfile };
