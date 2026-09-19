/* eslint-env node */
const fs = require('fs');
const { execFileSync } = require('child_process');
const { getUpdateChannel } = require('../../desktop/scripts/update-channels');

const [output, flag, channelName, ...rest] = process.argv.slice(2);
if (!output || flag !== '--channel' || rest.length) {
    throw new Error('Usage: write-update-build.js <output.json> --channel <development|public>');
}
const channel = getUpdateChannel(channelName).name;
const build =
    process.env.KEEWEB_RELEASE_BUILD || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
if (!/^\d{14}$/.test(build)) {
    throw new Error('KEEWEB_RELEASE_BUILD must be a UTC YYYYMMDDhhmmss build');
}
fs.writeFileSync(
    output,
    JSON.stringify({
        build,
        sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        clean: !execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
        channel
    }) + '\n'
);
