/* eslint-env node */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const asar = require('asar');
const { validateRelease } = require('../../desktop/scripts/private-update-feed');

const [appPath, outputRoot] = process.argv.slice(2);
if (!appPath || !outputRoot) {
    throw new Error(
        'Usage: node scripts/release/prepare-private-update.js <signed KeeWeb.app> <output-dir>'
    );
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
const info = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', path.join(appPath, 'Contents/Info.plist')],
    { encoding: 'utf8' }
).trim();
if (info !== 'com.mickdewald.keeweb') {
    throw new Error('Unexpected bundle identifier');
}
const { verifyUpdateApp } = require('./verify-update-app');
verifyUpdateApp(appPath);
const archive = path.join(appPath, 'Contents/Resources/app.asar');
const buildInfo = JSON.parse(asar.extractFile(archive, 'private-update-build.json'));
if (buildInfo.smoke || !/^\d{14}$/.test(buildInfo.build)) {
    throw new Error('Not a production updater build');
}
const version = JSON.parse(asar.extractFile(archive, 'package.json')).version;
const output = path.resolve(outputRoot, buildInfo.build);
fs.mkdirSync(output, { recursive: true });
const zip = path.join(output, 'KeeWeb.zip');
execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zip]);
const base = `https://downloads.michaeldewald.com/keeweb/arm64/${buildInfo.build}/`;
const release = {
    schema: 1,
    bundleId: info,
    arch: 'arm64',
    build: buildInfo.build,
    version,
    url: `${base}KeeWeb.zip`,
    updateURL: `${base}update.json`,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),
    sourceSha: buildInfo.sourceSha,
    clean: buildInfo.clean === true
};
validateRelease(release, '00000000000000');
fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify(release, null, 2) + '\n');
fs.writeFileSync(
    path.join(output, 'update.json'),
    JSON.stringify({ url: release.url, name: `KeeWeb ${version} (${release.build})` }, null, 2) +
        '\n'
);
process.stdout.write(
    `Prepared ${output}\nClassification: ${
        release.clean ? 'clean-tree' : 'local-draft (do not publish)'
    }\n`
);
