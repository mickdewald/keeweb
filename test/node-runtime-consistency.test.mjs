import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checkNodeRuntimeConsistency } from '../scripts/check-node-runtime-consistency.mjs';

function fixture(nvmVersion, engineVersion, lockEngineVersion = engineVersion) {
    const directory = mkdtempSync(join(tmpdir(), 'keeweb-node-runtime-'));
    writeFileSync(join(directory, '.nvmrc'), `${nvmVersion}\n`);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ engines: { node: engineVersion } }));
    writeFileSync(
        join(directory, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 3, packages: { '': { engines: { node: lockEngineVersion } } } })
    );
    return directory;
}

test('accepts matching exact declared and running Node versions', () => {
    const directory = fixture('v26.11.1', '26.11.1');
    try {
        assert.equal(checkNodeRuntimeConsistency(directory, '26.11.1'), '26.11.1');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects a divergent nvm and package engine pin', () => {
    const directory = fixture('v24.21.0', '26.11.1');
    try {
        assert.throws(() => checkNodeRuntimeConsistency(directory, '24.21.0'), /Node version mismatch/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects an actual Node version that differs from the declared pin', () => {
    const directory = fixture('v26.11.1', '26.11.1');
    try {
        assert.throws(() => checkNodeRuntimeConsistency(directory, '24.21.0'), /Running Node 24\.21\.0/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects invalid or missing declared pins', () => {
    const invalidDirectory = fixture('lts/*', '26.11.1');
    const missingDirectory = fixture('v26.11.1', '');
    try {
        assert.throws(() => checkNodeRuntimeConsistency(invalidDirectory, '26.11.1'), /\.nvmrc must declare/);
        assert.throws(() => checkNodeRuntimeConsistency(missingDirectory, '26.11.1'), /package\.json engines\.node must declare/);
    } finally {
        rmSync(invalidDirectory, { recursive: true, force: true });
        rmSync(missingDirectory, { recursive: true, force: true });
    }
});

test('rejects a lockfile root engine that diverges from package.json', () => {
    const directory = fixture('v26.11.1', '26.11.1', '24.21.0');
    try {
        assert.throws(() => checkNodeRuntimeConsistency(directory, '26.11.1'), /package-lock\.json root engines\.node/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
