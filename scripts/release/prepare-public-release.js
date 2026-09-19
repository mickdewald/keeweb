/* eslint-env node */
// Turns a signed, notarized and stapled public app + DMG into a prepared
// release directory. Writes local files only; publication is a separate gate.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const asar = require('asar');
const { verifyUpdateApp } = require('./verify-update-app');
const { verifyEmbeddedProfile } = require('./provisioning-profile');
const { createPublicRelease, json, requirePublicBuild } = require('./public-release-manifest');

function validateStaple(target) {
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', target], { stdio: 'ignore' });
}

function assessGatekeeper(appPath) {
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', appPath], {
        stdio: 'ignore'
    });
}

// The DMG must ship exactly this app: compare the code directory hashes.
function cdHash(bundle, run = spawnSync) {
    const info = run('/usr/bin/codesign', ['-d', '--verbose=4', bundle], {
        encoding: 'utf8'
    });
    const match = info.status === 0 && /^CDHash=([a-f0-9]{40})$/m.exec(info.stderr);
    if (!match) {
        throw new Error(`Cannot read the code directory hash of ${bundle}`);
    }
    return match[1];
}

function preparePublicRelease({ appPath, dmgPath, outputRoot, tools = {} }) {
    const verifyApp = tools.verifyUpdateApp || verifyUpdateApp;
    const verifyProfile = tools.verifyEmbeddedProfile || verifyEmbeddedProfile;
    const validate = tools.validateStaple || validateStaple;
    const assess = tools.assessGatekeeper || assessGatekeeper;
    const readCdHash = tools.cdHash || cdHash;
    const attach =
        tools.attachDmg ||
        ((dmg, mount) =>
            execFileSync('/usr/bin/hdiutil', [
                'attach',
                dmg,
                '-nobrowse',
                '-readonly',
                '-mountpoint',
                mount,
                '-quiet'
            ]));
    const detach =
        tools.detachDmg ||
        ((mount) => execFileSync('/usr/bin/hdiutil', ['detach', mount, '-quiet']));
    const verifyAppArtifact = (target) => {
        verifyApp(target, 'public');
        verifyProfile(target);
        validate(target);
        assess(target);
    };
    verifyAppArtifact(appPath);
    validate(dmgPath);

    const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-prepare-dmg-'));
    let attached = false;
    try {
        attach(dmgPath, mount);
        attached = true;
        const mountedApp = path.join(mount, 'KeeWeb.app');
        verifyAppArtifact(mountedApp);
        if (readCdHash(mountedApp) !== readCdHash(appPath)) {
            throw new Error('The DMG does not contain the verified app');
        }
    } finally {
        if (attached) {
            detach(mount);
        }
        fs.rmSync(mount, { recursive: true, force: true });
    }

    const archive = path.join(appPath, 'Contents/Resources/app.asar');
    const buildInfo = JSON.parse(asar.extractFile(archive, 'private-update-build.json'));
    const version = JSON.parse(asar.extractFile(archive, 'package.json')).version;
    // Refuse drafts, smoke fixtures and foreign channels before anything is written.
    requirePublicBuild(buildInfo);
    const output = path.resolve(outputRoot, buildInfo.build);
    fs.mkdirSync(output, { recursive: true });
    const zipPath = path.join(output, 'KeeWeb.zip');
    execFileSync('/usr/bin/ditto', [
        '-c',
        '-k',
        '--sequesterRsrc',
        '--keepParent',
        appPath,
        zipPath
    ]);

    const dmgBytes = fs.readFileSync(dmgPath);
    const prepared = createPublicRelease({
        buildInfo,
        version,
        dmgBytes,
        zipBytes: fs.readFileSync(zipPath),
        publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    });
    const dmgName = path.basename(prepared.release.objects.dmg.key);
    fs.writeFileSync(path.join(output, dmgName), dmgBytes);
    fs.writeFileSync(path.join(output, `${dmgName}.sha256`), prepared.checksumText);
    fs.writeFileSync(path.join(output, 'latest.dmg.sha256'), prepared.latestChecksumText);
    fs.writeFileSync(path.join(output, 'update.json'), json(prepared.update));
    fs.writeFileSync(path.join(output, 'release.json'), json(prepared.release));
    fs.writeFileSync(path.join(output, 'updates.json'), json(prepared.updateFeed));
    fs.writeFileSync(path.join(output, 'latest.json'), json(prepared.websiteManifest));
    return { output, prepared };
}

module.exports = { preparePublicRelease, cdHash };

if (require.main === module) {
    const [appPath, dmgPath, outputRoot] = process.argv.slice(2);
    if (!appPath || !dmgPath || !outputRoot) {
        throw new Error(
            'Usage: prepare-public-release.js <stapled KeeWeb.app> <stapled KeeWeb.dmg> <output-root>'
        );
    }
    const { output, prepared } = preparePublicRelease({ appPath, dmgPath, outputRoot });
    process.stdout.write(
        `Prepared ${output}\nClassification: clean-tree\nDMG SHA-256: ${prepared.release.objects.dmg.sha256}\n`
    );
}
