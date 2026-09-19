const { getUpdateChannel } = require('./update-channels');

function validateRelease(value, currentBuild, channelName) {
    const channel = getUpdateChannel(channelName);
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
    const base = `${channel.releaseRoot}${value.build}/`;
    if (value.updateURL !== `${base}update.json` || value.url !== `${base}KeeWeb.zip`) {
        throw new Error(`Release must belong to the ${channel.name} KeeWeb channel`);
    }
    return value.build > currentBuild ? value : null;
}

async function fetchRelease(net, currentBuild, channelName) {
    const channel = getUpdateChannel(channelName);
    const response = await net.fetch(channel.feedURL, {
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
    return validateRelease(JSON.parse(body), currentBuild, channel.name);
}

module.exports = { validateRelease, fetchRelease };
