const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRelease, fetchRelease } = require('../../desktop/scripts/private-update-feed');
const { getUpdateChannel, channelForBuild } = require('../../desktop/scripts/update-channels');

const oldBuild = '20260917180000';
const developmentRelease = {
    schema: 1,
    bundleId: 'com.mickdewald.keeweb',
    arch: 'arm64',
    build: '20260917190000',
    version: '1.18.7',
    updateURL: 'https://downloads.michaeldewald.com/keeweb/arm64/20260917190000/update.json',
    url: 'https://downloads.michaeldewald.com/keeweb/arm64/20260917190000/KeeWeb.zip'
};
const publicRelease = {
    ...developmentRelease,
    updateURL: 'https://downloads.michaeldewald.com/keeweb/public/arm64/20260917190000/update.json',
    url: 'https://downloads.michaeldewald.com/keeweb/public/arm64/20260917190000/KeeWeb.zip'
};

test('accepts only a newer development release', () => {
    assert.equal(validateRelease(developmentRelease, oldBuild, 'development'), developmentRelease);
    assert.equal(
        validateRelease(developmentRelease, developmentRelease.build, 'development'),
        null
    );
    assert.equal(validateRelease(developmentRelease, '20260918180000', 'development'), null);
});

test('rejects upstream, other architectures and malformed builds', () => {
    for (const change of [
        { url: 'https://github.com/keeweb/keeweb.zip' },
        { arch: 'x64' },
        { bundleId: 'net.antelle.keeweb' },
        { build: 'next' },
        { updateURL: 'https://example.com/feed' }
    ]) {
        for (const [release, channel] of [
            [developmentRelease, 'development'],
            [publicRelease, 'public']
        ]) {
            assert.throws(() => validateRelease({ ...release, ...change }, oldBuild, channel));
        }
    }
});

test('binds every release to its own channel', () => {
    assert.equal(validateRelease(publicRelease, oldBuild, 'public'), publicRelease);
    assert.throws(() => validateRelease(publicRelease, oldBuild, 'development'));
    assert.throws(() => validateRelease(developmentRelease, oldBuild, 'public'));
});

test('never falls back to a feed for a missing or unknown channel', async () => {
    assert.throws(() => getUpdateChannel('missing'));
    assert.throws(() => getUpdateChannel(undefined));
    assert.throws(() => getUpdateChannel('constructor'));
    assert.throws(() => validateRelease(developmentRelease, oldBuild));
    assert.throws(() => validateRelease(publicRelease, oldBuild, 'missing'));
    const requested = [];
    const net = { fetch: async (url) => requested.push(url) };
    await assert.rejects(() => fetchRelease(net, oldBuild));
    await assert.rejects(() => fetchRelease(net, oldBuild, 'missing'));
    assert.deepEqual(requested, []);
});

test('fetches exactly the feed of the embedded channel', async () => {
    for (const [channel, release, feed] of [
        [
            'development',
            developmentRelease,
            'https://downloads.michaeldewald.com/keeweb/arm64/latest.json'
        ],
        [
            'public',
            publicRelease,
            'https://downloads.michaeldewald.com/keeweb/public/arm64/updates.json'
        ]
    ]) {
        const requested = [];
        const net = {
            fetch: async (url, options) => {
                requested.push([url, options.redirect]);
                return { ok: true, text: async () => JSON.stringify(release) };
            }
        };
        assert.deepEqual(await fetchRelease(net, oldBuild, channel), release);
        assert.deepEqual(requested, [[feed, 'error']]);
    }
});

test('disables updates for build metadata without a valid channel', () => {
    const build = '20260917190000';
    assert.equal(channelForBuild({ build, channel: 'public' }).name, 'public');
    assert.equal(channelForBuild({ build, channel: 'development' }).name, 'development');
    assert.equal(channelForBuild({ build }), null);
    assert.equal(channelForBuild({ build, channel: 'beta' }), null);
    assert.equal(channelForBuild({ build, channel: 'toString' }), null);
    assert.equal(channelForBuild({ build: 'next', channel: 'public' }), null);
    assert.equal(channelForBuild(null), null);
});
