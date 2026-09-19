const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const asar = require('asar');

const check = path.join(__dirname, '../../scripts/dev/check-private-update-deploy.js');

async function appWith(metadata) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-deploy-check-'));
    const source = path.join(root, 'source');
    const app = path.join(root, 'KeeWeb.app');
    fs.mkdirSync(source);
    fs.mkdirSync(path.join(app, 'Contents/Resources'), { recursive: true });
    fs.writeFileSync(path.join(source, 'private-update-build.json'), JSON.stringify(metadata));
    await asar.createPackage(source, path.join(app, 'Contents/Resources/app.asar'));
    return app;
}

const run = (app) => spawnSync(process.execPath, [check, app], { encoding: 'utf8' }).status;

test('only development-channel production builds may be deployed locally', async () => {
    const build = '20260919120000';
    assert.equal(run(await appWith({ build, channel: 'development' })), 0);
    for (const metadata of [
        { build, channel: 'public' },
        { build },
        { build, channel: 'development', smoke: true },
        { build: 'next', channel: 'development' }
    ]) {
        assert.notEqual(run(await appWith(metadata)), 0, `deployed ${JSON.stringify(metadata)}`);
    }
});
