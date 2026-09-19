const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { preparePublicRelease } = require('../../scripts/release/prepare-public-release');

test('rejects a DMG whose mounted app fails public signature verification before metadata is read', () => {
    const calls = [];
    let mount;
    let verification = 0;
    assert.throws(
        () =>
            preparePublicRelease({
                appPath: '/source/KeeWeb.app',
                dmgPath: '/source/KeeWeb.dmg',
                outputRoot: '/never-written',
                tools: {
                    verifyUpdateApp(app) {
                        verification += 1;
                        calls.push(`signature:${verification}`);
                        if (verification === 2) {
                            throw new Error('mounted app signature is invalid');
                        }
                    },
                    verifyEmbeddedProfile() {
                        calls.push('profile');
                    },
                    validateStaple(target) {
                        calls.push(`staple:${target.endsWith('.dmg') ? '.dmg' : 'app'}`);
                    },
                    assessGatekeeper() {
                        calls.push('gatekeeper');
                    },
                    attachDmg(_dmg, destination) {
                        mount = destination;
                        calls.push('attach');
                    },
                    detachDmg() {
                        calls.push('detach');
                    },
                    cdHash() {
                        throw new Error('CDHash comparison must follow signature verification');
                    }
                }
            }),
        /mounted app signature is invalid/
    );
    assert.deepEqual(calls, [
        'signature:1',
        'profile',
        'staple:app',
        'gatekeeper',
        'staple:.dmg',
        'attach',
        'signature:2',
        'detach'
    ]);
    assert.equal(fs.existsSync(mount), false);
});
