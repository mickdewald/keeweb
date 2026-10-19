import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as kdbxweb from 'kdbxweb';
import { generateFixture } from '../../scripts/android/make-e2e-fixture.mjs';

const password = 'e2e-fake-password';

function credentials(value = password) {
    return new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString(value));
}

function arrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function loadFixture(filePath, value = password) {
    const bytes = fs.readFileSync(filePath);
    return kdbxweb.Kdbx.load(arrayBuffer(bytes), credentials(value));
}

test('generates and decrypts the disposable KDBX4 Argon2id fixture', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeweb-e2e-fixture-'));
    const outputPath = path.join(tempDir, 'fixture.kdbx');
    try {
        await generateFixture(outputPath);
        const bytes = fs.readFileSync(outputPath);
        const data = arrayBuffer(bytes);
        const db = await kdbxweb.Kdbx.load(data, credentials());
        assert.equal(db.versionMajor, 4);
        assert.equal(
            Buffer.from(db.header.kdfParameters.get('$UUID')).toString('base64'),
            kdbxweb.Consts.KdfId.Argon2id
        );
        assert.equal([...db.getDefaultGroup().allEntries()].length, 40);
        await assert.rejects(kdbxweb.Kdbx.load(data, credentials('wrong-password')));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('decrypts the committed Android fixture with the native Argon2 adapter', async () => {
    const fixturePath = path.join(process.cwd(), 'test/android/fixtures/e2e-fixture.kdbx');
    const db = await loadFixture(fixturePath);
    assert.equal(db.versionMajor, 4);
    assert.equal([...db.getDefaultGroup().allEntries()].length, 40);
});

test('uses strict XML parsing for malformed input', () => {
    assert.throws(() => new global.DOMParser().parseFromString('<a>', 'application/xml'));
});
