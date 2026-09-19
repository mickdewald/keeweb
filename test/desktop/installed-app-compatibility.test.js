const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    BUNDLE,
    TEAM,
    APP_ENTITLEMENTS,
    DEVELOPMENT_REQUIREMENT,
    DEVELOPMENT_PROFILE,
    appFixture,
    fakeTools,
    developmentState,
    publicState,
    assertNoMutations,
    assertRejected
} = require('./installed-app-compatibility-harness');
const {
    verifyDevelopmentCandidate,
    checkCompatibility,
    runPreflight
} = require('../../scripts/dev/check-installed-app-compatibility');

test('first install keeps the development candidate policy', () => {
    const candidate = appFixture('candidate.app');
    const installed = path.join(candidate.root, 'missing', 'KeeWeb.app');
    const tools = fakeTools({ [candidate.app]: developmentState() });
    const snapshot = runPreflight(
        { installedPath: installed, candidatePath: candidate.app },
        tools
    );
    assert.equal(snapshot.present, false);
    assert.equal(
        tools.calls.some((call) => call[0] === '/usr/bin/codesign' && call.at(-1) === installed),
        false
    );
    verifyDevelopmentCandidate(candidate.app, tools);
    assertNoMutations(tools);
});

test('a compatible development target is verified against the installed requirement', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const tools = fakeTools({
        [installed.app]: developmentState(),
        [candidate.app]: developmentState()
    });
    const snapshot = runPreflight(
        { installedPath: installed.app, candidatePath: candidate.app },
        tools
    );
    assert.equal(snapshot.present, true);
    assert.equal(snapshot.channel, 'development');
    assert.equal(snapshot.identifier, BUNDLE);
    assert.equal(snapshot.teamId, TEAM);
    const requirementCalls = tools.calls.filter(
        (call) =>
            call[0] === '/usr/bin/codesign' &&
            call[1] === '--verify' &&
            call.includes('-R') &&
            call.at(-1) === candidate.app
    );
    assert.ok(
        requirementCalls.some(
            (call) => call[call.indexOf('-R') + 1] === `=${DEVELOPMENT_REQUIREMENT}`
        )
    );
    assert.equal(
        requirementCalls.every((call) => call[call.indexOf('-R') + 1].startsWith('=')),
        true
    );
    assertNoMutations(tools);
});

test('a public installed target is refused even when the team matches', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const tools = fakeTools({
        [installed.app]: publicState(),
        [candidate.app]: developmentState()
    });
    assertRejected(
        () => runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools),
        /public|Developer ID/i,
        tools
    );
    assert.throws(() => checkCompatibility(installed.app, candidate.app, tools), /same team/i);
    assert.doesNotMatch(
        (() => {
            try {
                checkCompatibility(installed.app, candidate.app, tools);
                return '';
            } catch (error) {
                return error.message;
            }
        })(),
        /codesign\.json|provisionprofile|keychain/i
    );
});

test('wrong team, bundle or designated requirement is not compatible', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const foreignTeam = fakeTools({
        [installed.app]: developmentState({ teamId: '3LE7JZ657W' }),
        [candidate.app]: developmentState()
    });
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                foreignTeam
            ),
        /team/i,
        foreignTeam
    );

    const foreignBundle = fakeTools({
        [installed.app]: developmentState({ identifier: 'net.antelle.keeweb' }),
        [candidate.app]: developmentState()
    });
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                foreignBundle
            ),
        /bundle/i,
        foreignBundle
    );

    const installedRequirement =
        'identifier "com.mickdewald.keeweb" and certificate leaf[subject.OU] = "OTHERTEAM"';
    const unsatisfied = fakeTools({
        [installed.app]: developmentState({ designatedRequirement: installedRequirement }),
        [candidate.app]: developmentState({ failRequirement: `=${installedRequirement}` })
    });
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                unsatisfied
            ),
        /requirement/i,
        unsatisfied
    );
});

test('differing required entitlements or keychain groups are refused', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const differentGroup = {
        ...APP_ENTITLEMENTS,
        'keychain-access-groups': [`${TEAM}.other`]
    };
    const tools = fakeTools({
        [installed.app]: developmentState({ entitlements: differentGroup }),
        [candidate.app]: developmentState()
    });
    assertRejected(
        () => runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools),
        /keychain-access-groups|entitlement/i,
        tools
    );

    const differentAppId = fakeTools({
        [installed.app]: developmentState({
            entitlements: {
                ...APP_ENTITLEMENTS,
                'com.apple.application-identifier': `${TEAM}.other.keeweb`
            }
        }),
        [candidate.app]: developmentState()
    });
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                differentAppId
            ),
        /entitlement|application-identifier/i,
        differentAppId
    );
});

test('a missing or incompatible development profile blocks the candidate', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    fs.rmSync(path.join(candidate.app, 'Contents/embedded.provisionprofile'));
    const missing = fakeTools({
        [installed.app]: developmentState(),
        [candidate.app]: developmentState()
    });
    assertRejected(
        () => runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, missing),
        /provisioning profile/i,
        missing
    );

    fs.writeFileSync(
        path.join(candidate.app, 'Contents/embedded.provisionprofile'),
        'fixture-profile'
    );
    const incompatible = fakeTools(
        {
            [installed.app]: developmentState(),
            [candidate.app]: developmentState()
        },
        {
            profile: {
                ...DEVELOPMENT_PROFILE,
                entitlements: {
                    ...DEVELOPMENT_PROFILE.entitlements,
                    'com.apple.developer.team-identifier': '3LE7JZ657W'
                }
            }
        }
    );
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                incompatible
            ),
        /profile/i,
        incompatible
    );
});
