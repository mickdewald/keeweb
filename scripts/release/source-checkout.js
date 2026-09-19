/* eslint-env node */
const { execFileSync } = require('child_process');

// The checkout a release is published from: must be clean and at the released SHA.
const git = {
    status: () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    head: () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
};

module.exports = { git };
