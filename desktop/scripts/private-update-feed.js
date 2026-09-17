const FEED_URL = 'https://downloads.michaeldewald.com/keeweb/arm64/latest.json';
const RELEASE_ROOT = 'https://downloads.michaeldewald.com/keeweb/arm64/';

function validateRelease(value, currentBuild) {
    if (
        !value ||
        value.schema !== 1 ||
        value.bundleId !== 'com.mickdewald.keeweb' ||
        value.arch !== 'arm64' ||
        !/^\d{14}$/.test(value.build) ||
        typeof value.version !== 'string' ||
        value.version.length > 80
    ) {
        throw new Error('Invalid KeeWeb release metadata');
    }
    const base = `${RELEASE_ROOT}${value.build}/`;
    if (value.updateURL !== `${base}update.json` || value.url !== `${base}KeeWeb.zip`) {
        throw new Error('Release must belong to the private KeeWeb channel');
    }
    return value.build > currentBuild ? value : null;
}

async function fetchRelease(net, currentBuild) {
    const response = await net.fetch(FEED_URL, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
        throw new Error(`Update feed returned HTTP ${response.status}`);
    }
    const body = await response.text();
    if (body.length > 16384) {
        throw new Error('Update feed is too large');
    }
    return validateRelease(JSON.parse(body), currentBuild);
}

module.exports = { FEED_URL, validateRelease, fetchRelease };
