const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const writer = path.join(__dirname, '../../scripts/dev/write-update-build.js');

function gitFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-build-metadata-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '--quiet');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'fixture\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'out/\n');
    git('add', '.');
    git(
        '-c',
        'user.name=fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture'
    );
    fs.mkdirSync(path.join(root, 'out'));
    return { root, sha: git('rev-parse', 'HEAD'), output: path.join(root, 'out/build.json') };
}

function run(fixture, args, env = {}) {
    return spawnSync(process.execPath, [writer, fixture.output, ...args], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: { ...process.env, KEEWEB_RELEASE_BUILD: '20260919120000', ...env }
    });
}

test('embeds the explicit channel, source revision and clean state', () => {
    for (const channel of ['public', 'development']) {
        const fixture = gitFixture();
        const result = run(fixture, ['--channel', channel]);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(fs.readFileSync(fixture.output, 'utf8')), {
            build: '20260919120000',
            sourceSha: fixture.sha,
            clean: true,
            channel
        });
    }
});

test('marks dirty trees so they can never be published', () => {
    const fixture = gitFixture();
    fs.writeFileSync(path.join(fixture.root, 'tracked.txt'), 'changed\n');
    assert.equal(run(fixture, ['--channel', 'public']).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(fixture.output, 'utf8')).clean, false);
});

test('refuses omitted, unknown and malformed channel or build arguments', () => {
    for (const args of [[], ['--channel'], ['--channel', 'beta'], ['--channel', 'toString']]) {
        const fixture = gitFixture();
        const result = run(fixture, args);
        assert.notEqual(result.status, 0, `accepted ${JSON.stringify(args)}`);
        assert.equal(fs.existsSync(fixture.output), false);
    }
    const fixture = gitFixture();
    assert.notEqual(run(fixture, ['--channel', 'public'], { KEEWEB_RELEASE_BUILD: 'x' }).status, 0);
    assert.equal(fs.existsSync(fixture.output), false);
});

test('the old writer name is gone without a compatibility wrapper', () => {
    assert.equal(
        fs.existsSync(path.join(__dirname, '../../scripts/dev/write-private-update-build.js')),
        false
    );
});
