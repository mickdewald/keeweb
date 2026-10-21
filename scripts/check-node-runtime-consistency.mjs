import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkNodeRuntimeConsistency(rootDir, currentVersion = process.versions.node) {
    const nvmVersion = readFileSync(resolve(rootDir, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
    const engineVersion = packageJson.engines?.node?.trim().replace(/^v/, '');
    const lockfilePath = resolve(rootDir, 'package-lock.json');
    const lockfileVersion = existsSync(lockfilePath)
        ? JSON.parse(readFileSync(lockfilePath, 'utf8')).packages?.['']?.engines?.node?.trim().replace(/^v/, '')
        : null;

    if (!/^\d+\.\d+\.\d+$/.test(nvmVersion)) {
        throw new Error(`.nvmrc must declare an exact Node version, found: ${nvmVersion || '(empty)'}`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(engineVersion || '')) {
        throw new Error(
            `package.json engines.node must declare an exact Node version, found: ${engineVersion || '(missing)'}`
        );
    }
    if (nvmVersion !== engineVersion) {
        throw new Error(`Node version mismatch: .nvmrc=${nvmVersion}, package.json engines.node=${engineVersion}`);
    }
    if (lockfileVersion !== null) {
        if (!/^\d+\.\d+\.\d+$/.test(lockfileVersion || '')) {
            throw new Error(
                `package-lock.json root engines.node must declare an exact Node version, found: ${lockfileVersion || '(missing)'}`
            );
        }
        if (lockfileVersion !== engineVersion) {
            throw new Error(
                `Node version mismatch: package.json engines.node=${engineVersion}, package-lock.json root engines.node=${lockfileVersion}`
            );
        }
    }
    if (currentVersion !== nvmVersion) {
        throw new Error(`Running Node ${currentVersion} does not match the declared version ${nvmVersion}`);
    }

    return nvmVersion;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const version = checkNodeRuntimeConsistency(process.cwd());
    console.log(`Node runtime consistency check passed: ${version}`);
}
