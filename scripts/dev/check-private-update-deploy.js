/* eslint-env node */
const path = require('path');
const asar = require('asar');
const archive = path.join(process.argv[2], 'Contents/Resources/app.asar');
const metadata = JSON.parse(asar.extractFile(archive, 'private-update-build.json'));
// The shared build directory may hold a public-channel or draft build; only a
// development-channel production build belongs into the local installation.
if (metadata.smoke || !/^\d{14}$/.test(metadata.build) || metadata.channel !== 'development') {
    throw new Error('Refusing to deploy a smoke fixture, invalid build or non-development channel');
}
