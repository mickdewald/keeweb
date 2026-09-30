// scripts/android/make-e2e-fixture.mjs
// Usage: npm install --no-save hash-wasm@4 && node scripts/android/make-e2e-fixture.mjs
import fs from 'node:fs';
import * as kdbxweb from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';

kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    const fn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
    const out = await fn({ password: new Uint8Array(password), salt: new Uint8Array(salt),
        memorySize: memory, iterations, hashLength: length, parallelism, outputType: 'binary' });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
});

const db = kdbxweb.Kdbx.create(
    new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString('e2e-fake-password')), 'E2E Fixture');
db.setVersion(4);
db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
db.header.kdfParameters.set('M', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(16 * 1024 * 1024));
db.header.kdfParameters.set('I', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(2));
const group = db.createGroup(db.getDefaultGroup(), 'Fixture');
for (let i = 1; i <= 40; i++) {
    const e = db.createEntry(group);
    e.fields.set('Title', `a-rather-long-example-site-name.test #${i}`);
    e.fields.set('UserName', `user${i}@example.test`);
    e.fields.set('Password', kdbxweb.ProtectedValue.fromString(`fake-password-${i}`));
    e.fields.set('URL', `https://example.test/${i}`);
}
fs.mkdirSync('test/android/fixtures', { recursive: true });
fs.writeFileSync('test/android/fixtures/e2e-fixture.kdbx', Buffer.from(await db.save()));
console.log('wrote test/android/fixtures/e2e-fixture.kdbx');
