const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRelease } = require('../../desktop/scripts/private-update-feed');
const release = {
    schema: 1,
    bundleId: 'com.mickdewald.keeweb',
    arch: 'arm64',
    build: '20260917190000',
    version: '1.18.7',
    updateURL: 'https://downloads.michaeldewald.com/keeweb/arm64/20260917190000/update.json',
    url: 'https://downloads.michaeldewald.com/keeweb/arm64/20260917190000/KeeWeb.zip'
};
test('accepts only a newer private release', () => {
    assert.equal(validateRelease(release, '20260917180000'), release);
    assert.equal(validateRelease(release, release.build), null);
    assert.equal(validateRelease(release, '20260918180000'), null);
});
test('rejects upstream, other architectures and malformed builds', () => {
    for (const change of [
        { url: 'https://github.com/keeweb/keeweb.zip' },
        { arch: 'x64' },
        { bundleId: 'net.antelle.keeweb' },
        { build: 'next' },
        { updateURL: 'https://example.com/feed' }
    ]) {
        assert.throws(() => validateRelease({ ...release, ...change }, '20260917180000'));
    }
});
