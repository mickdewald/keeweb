const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const script = () => read('scripts/release/test-public-updater.sh');
const lib = () => read('scripts/release/public-macos-lib.sh');
const entry = () => read('scripts/dev/private-updater-smoke-entry.js');

test('fixtures use the isolated bundle ID and the exact Developer ID signing code', () => {
    assert.match(script(), /source "\$SCRIPT_DIR\/public-macos-lib\.sh"/);
    assert.match(script(), /SMOKE_BUNDLE_ID="\$\{PUBLIC_BUNDLE_ID\}\.updater-smoke"/);
    assert.match(script(), /require_public_identity/);
    assert.match(script(), /build_public_app "\$SMOKE_BUNDLE_ID" 1\b/);
    assert.match(lib(), /Developer ID Application: Michael Dewald \(GGYLL32K99\)/);
    assert.doesNotMatch(script(), /--sign -|skip-sign|keys\/codesign\.json/);
    // The development certificate appears once: as the foreign identity that must be refused.
    assert.equal(script().match(/Apple Development/g).length, 1);
    assert.match(script(), /FOREIGN_IDENTITY="Apple Development: Michael Dewald \(UUCWA5MCLV\)"/);
    assert.match(script(), /require_rejection foreign/);
    assert.doesNotMatch(script(), /build_public_app "\$PUBLIC_BUNDLE_ID"/);
});

test('two strictly increasing builds exercise the public channel over loopback only', () => {
    assert.match(script(), /\[\[ "\$NEW_BUILD" > "\$OLD_BUILD" \]\]/);
    assert.match(script(), /KEEWEB_RELEASE_BUILD="\$OLD_BUILD"/);
    assert.match(script(), /KEEWEB_RELEASE_BUILD="\$NEW_BUILD"/);
    assert.match(script(), /keeweb\/public\/arm64/);
    assert.doesNotMatch(script(), /curl|R2_|publish-public-release|notarytool/);
    assert.match(entry(), /127\.0\.0\.1/);
});

test('the feed override exists only inside smoke-marked fixtures', () => {
    assert.match(entry(), /if \(!smoke\) \{\s*throw new Error\('Not an updater smoke fixture'\)/);
    assert.match(entry(), /validateRelease\(feed, build, channel\)/);
    assert.match(entry(), /stage: 'discovered'/);
    for (const production of [
        'desktop/scripts/private-updater.js',
        'desktop/scripts/private-update-feed.js',
        'desktop/scripts/update-channels.js'
    ]) {
        assert.doesNotMatch(read(production), /127\.0\.0\.1|localhost|smoke/i);
    }
});

test('evidence covers checksum, signature rejection, preservation, install and launch', () => {
    for (const proof of [
        'discovered',
        'sha256Verified',
        'invalidSignatureRejected',
        'foreignSignatureRejected',
        'oldBuildPreserved',
        'validUpdateInstalled',
        'newBuildLaunched'
    ]) {
        assert.match(script(), new RegExp(`\\b${proof}\\b`), `missing proof ${proof}`);
    }
    assert.match(script(), /evidence\.json/);
    assert.match(script(), /codesign --verify --deep --strict/);
    assert.match(script(), /did not pass validation/);
});

test('the acceptance flow cannot touch production installs or real KeeWeb data', () => {
    for (const source of [script(), entry()]) {
        assert.doesNotMatch(
            source,
            /\/Applications|Application Support|\.kdbx|keytar|Keychain\b.*unlock/
        );
    }
    assert.match(script(), /--user-data-dir=/);
    assert.match(script(), /\.updater-smoke\/public/);
    assert.match(entry(), /app\.setPath\('userData', config\.userData\)/);
});
