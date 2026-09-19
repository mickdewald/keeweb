const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    BUILD,
    DEVELOPMENT,
    DEVELOPMENT_PROFILE,
    LEAF_CERTIFICATE,
    OTHER_CERTIFICATE,
    fingerprint,
    appFixture,
    fakeTools,
    developmentState,
    assertNoMutations,
    assertRejected
} = require('./installed-app-compatibility-harness');
const {
    inspectInstalledApp,
    verifyDevelopmentCandidate,
    checkCompatibility,
    checkActiveSession,
    assertSnapshotUnchanged,
    runPreflight
} = require('../../scripts/dev/check-installed-app-compatibility');

function certificateTools(candidateState = {}, options = {}) {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const tools = fakeTools(
        {
            [installed.app]: developmentState(),
            [candidate.app]: developmentState(candidateState)
        },
        options
    );
    return { installed, candidate, tools };
}

test('a profile that includes the actual candidate leaf certificate is accepted', () => {
    const { installed, candidate, tools } = certificateTools(
        {},
        {
            profile: {
                ...DEVELOPMENT_PROFILE,
                certificateFingerprints: [
                    fingerprint(OTHER_CERTIFICATE),
                    fingerprint(LEAF_CERTIFICATE)
                ]
            }
        }
    );
    runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools);
    verifyDevelopmentCandidate(candidate.app, tools);
    assert.ok(
        tools.calls.some(
            (call) =>
                call[0] === '/usr/bin/codesign' &&
                call.some((arg) => String(arg).startsWith('--extract-certificates=')) &&
                call.at(-1) === candidate.app
        )
    );
    assertNoMutations(tools);
});

test('an otherwise matching profile for a different certificate is refused', () => {
    const { installed, candidate, tools } = certificateTools({
        leafCertificate: OTHER_CERTIFICATE
    });
    assertRejected(
        () => runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools),
        /does not include the certificate that signed the app/,
        tools
    );
    assert.throws(() => verifyDevelopmentCandidate(candidate.app, tools), /certificate/i);
});

test('a profile without valid certificate fingerprints is refused', () => {
    const { certificateFingerprints, ...withoutList } = DEVELOPMENT_PROFILE;
    assert.ok(certificateFingerprints.length);
    for (const profile of [
        withoutList,
        { ...DEVELOPMENT_PROFILE, certificateFingerprints: [] },
        { ...DEVELOPMENT_PROFILE, certificateFingerprints: 'not-a-list' },
        {
            ...DEVELOPMENT_PROFILE,
            certificateFingerprints: [fingerprint(LEAF_CERTIFICATE), 'not-a-fingerprint']
        }
    ]) {
        const { installed, candidate, tools } = certificateTools({}, { profile });
        assertRejected(
            () =>
                runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools),
            /no valid signing certificate fingerprints/,
            tools
        );
    }
});

test('a candidate whose signing certificate cannot be determined is refused', () => {
    const failing = certificateTools({ extractFails: true });
    assertRejected(
        () =>
            runPreflight(
                { installedPath: failing.installed.app, candidatePath: failing.candidate.app },
                failing.tools
            ),
        /Cannot determine the candidate signing certificate/,
        failing.tools
    );

    for (const appLeafFingerprint of [
        () => '',
        () => 'not-a-fingerprint',
        () => {
            throw new Error('boom');
        }
    ]) {
        const { installed, candidate, tools } = certificateTools();
        tools.appLeafFingerprint = appLeafFingerprint;
        assertRejected(
            () =>
                runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools),
            /Cannot determine the candidate signing certificate/,
            tools
        );
    }
});

test('bad nested code fails candidate verification', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const tools = fakeTools({
        [installed.app]: developmentState(),
        [candidate.app]: developmentState(),
        [candidate.files.helper]: { authority: DEVELOPMENT, invalid: true }
    });
    assertRejected(
        () => runPreflight({ installedPath: installed.app, candidatePath: candidate.app }, tools),
        /Helper|signature|nested/i,
        tools
    );
});

test('a smoke candidate is refused before replacement', () => {
    const candidate = appFixture('candidate.app');
    const installed = path.join(candidate.root, 'none.app');
    const tools = fakeTools(
        { [candidate.app]: developmentState() },
        { metadata: { build: BUILD, channel: 'development', smoke: true } }
    );
    assertRejected(
        () => runPreflight({ installedPath: installed, candidatePath: candidate.app }, tools),
        /smoke/i,
        tools
    );
    assert.throws(() => verifyDevelopmentCandidate(candidate.app, tools), /smoke|non-development/i);
});

test('a changed installed snapshot aborts before replacement', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    let cdhash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const tools = fakeTools(
        {
            [installed.app]: developmentState(),
            [candidate.app]: developmentState()
        },
        { cdhash: () => cdhash }
    );
    const snapshot = inspectInstalledApp(installed.app, tools);
    checkCompatibility(installed.app, candidate.app, tools);
    cdhash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const fresh = inspectInstalledApp(installed.app, tools);
    assert.throws(() => assertSnapshotUnchanged(snapshot, fresh), /changed|snapshot/i);
    assertNoMutations(tools);
});

test('an active KeeWeb session fails before quit or replacement', () => {
    const installed = appFixture('installed.app');
    const candidate = appFixture('candidate.app');
    const processSession = fakeTools(
        {
            [installed.app]: developmentState(),
            [candidate.app]: developmentState()
        },
        { session: true }
    );
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                processSession
            ),
        /running|close/i,
        processSession
    );
    assert.throws(() => checkActiveSession(installed.app, processSession), /running|close/i);

    const bundleSession = fakeTools(
        {
            [installed.app]: developmentState(),
            [candidate.app]: developmentState()
        },
        { bundleRunning: true }
    );
    assertRejected(
        () =>
            runPreflight(
                { installedPath: installed.app, candidatePath: candidate.app },
                bundleSession
            ),
        /running|close/i,
        bundleSession
    );
});

test('the checker does not print private signing configuration or mutate installs', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../../scripts/dev/check-installed-app-compatibility.js'),
        'utf8'
    );
    assert.doesNotMatch(source, /eval\(|new Function|find-identity|codesign\.json/);
    assert.doesNotMatch(source, /osascript[\s\S]{0,80}quit|\bpkill\b|\bditto\b|rm -rf/);
    assert.doesNotMatch(source, /console\.(log|info|debug)/);
});
