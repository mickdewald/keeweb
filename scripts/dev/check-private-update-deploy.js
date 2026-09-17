/* eslint-env node */
const path = require('path');
const asar = require('asar');
const archive = path.join(process.argv[2], 'Contents/Resources/app.asar');
const metadata = JSON.parse(asar.extractFile(archive, 'private-update-build.json'));
if (metadata.smoke || !/^\d{14}$/.test(metadata.build)) {
    throw new Error('Refusing to deploy an updater smoke fixture or invalid build');
}
