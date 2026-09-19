/* eslint-env node */
const path = require('path');

function readPrivateUpdateMetadata(appPath) {
    const asar = require('asar');
    const archive = path.join(appPath, 'Contents/Resources/app.asar');
    return JSON.parse(asar.extractFile(archive, 'private-update-build.json'));
}

function assertDevelopmentDeployMetadata(appPath, readMetadata = readPrivateUpdateMetadata) {
    const metadata = readMetadata(appPath);
    // The shared build directory may hold a public-channel or draft build; only a
    // development-channel production build belongs into the local installation.
    if (metadata.smoke || !/^\d{14}$/.test(metadata.build) || metadata.channel !== 'development') {
        throw new Error(
            'Refusing to deploy a smoke fixture, invalid build or non-development channel'
        );
    }
    return metadata;
}

module.exports = { assertDevelopmentDeployMetadata, readPrivateUpdateMetadata };

if (require.main === module) {
    assertDevelopmentDeployMetadata(process.argv[2]);
}
