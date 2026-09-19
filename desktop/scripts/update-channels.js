// Packaged builds are bound to exactly one update channel through embedded
// build metadata. An unknown or missing channel never falls back to a feed.
const UPDATE_CHANNELS = Object.freeze({
    development: Object.freeze({
        name: 'development',
        feedURL: 'https://downloads.michaeldewald.com/keeweb/arm64/latest.json',
        releaseRoot: 'https://downloads.michaeldewald.com/keeweb/arm64/'
    }),
    public: Object.freeze({
        name: 'public',
        feedURL: 'https://downloads.michaeldewald.com/keeweb/public/arm64/updates.json',
        releaseRoot: 'https://downloads.michaeldewald.com/keeweb/public/arm64/'
    })
});

function getUpdateChannel(name) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(UPDATE_CHANNELS, name)) {
        throw new Error('Unknown KeeWeb update channel');
    }
    return UPDATE_CHANNELS[name];
}

function channelForBuild(buildInfo) {
    if (!buildInfo || !/^\d{14}$/.test(buildInfo.build)) {
        return null;
    }
    try {
        return getUpdateChannel(buildInfo.channel);
    } catch {
        return null;
    }
}

module.exports = { getUpdateChannel, channelForBuild };
