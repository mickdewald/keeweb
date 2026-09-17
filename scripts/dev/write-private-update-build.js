/* eslint-env node */
const fs = require('fs');
const { execFileSync } = require('child_process');
const build =
    process.env.KEEWEB_RELEASE_BUILD || new Date().toISOString().replace(/\D/g, '').slice(0, 14);
if (!/^\d{14}$/.test(build)) {
    throw new Error('KEEWEB_RELEASE_BUILD must be a UTC YYYYMMDDhhmmss build');
}
fs.writeFileSync(
    process.argv[2],
    JSON.stringify({
        build,
        sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        clean: !execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
    }) + '\n'
);
