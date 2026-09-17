/* eslint-env node */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

function verifyUpdateApp(appPath) {
    const info = spawnSync('/usr/bin/codesign', ['-d', '-r-', '--verbose=2', appPath], {
        encoding: 'utf8'
    });
    if (
        info.status !== 0 ||
        !info.stderr.includes('TeamIdentifier=GGYLL32K99') ||
        !info.stderr.includes('Authority=Apple Development: Michael Dewald (UUCWA5MCLV)')
    ) {
        throw new Error('Update signing identity must match the current private KeeWeb channel');
    }
    const requirement =
        'identifier "com.mickdewald.keeweb" and anchor apple generic and certificate leaf[subject.CN] = "Apple Development: Michael Dewald (UUCWA5MCLV)" and certificate leaf[subject.OU] = "GGYLL32K99"';
    execFileSync('/usr/bin/codesign', [
        '--verify',
        '--deep',
        '--strict',
        '-R',
        `=${requirement}`,
        appPath
    ]);
    const arch = execFileSync(
        '/usr/bin/lipo',
        ['-archs', path.join(appPath, 'Contents/MacOS/KeeWeb')],
        { encoding: 'utf8' }
    ).trim();
    if (arch !== 'arm64') {
        throw new Error('This channel requires an arm64 app');
    }
}
module.exports = { verifyUpdateApp };
