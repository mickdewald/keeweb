// scripts/android/make-e2e-fixture.mjs
// Usage: node scripts/android/make-e2e-fixture.mjs [output-path]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argon2 } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as kdbxweb from 'kdbxweb';

const strictParserOptions = {
    onError: (_level, message) => {
        throw new Error(message);
    }
};
// kdbxweb 2.1.1 creates these globals outside a browser. Bind xmldom's
// supported strict option shape; its former errorHandler option was removed.
global.DOMParser = DOMParser.bind(null, strictParserOptions);
global.XMLSerializer = XMLSerializer;

kdbxweb.CryptoEngine.setArgon2Impl(
    (password, salt, memory, iterations, length, parallelism, type) =>
        new Promise((resolve, reject) => {
            argon2(
                type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? 'argon2id' : 'argon2d',
                {
                    message: Buffer.from(password),
                    nonce: Buffer.from(salt),
                    memory,
                    passes: iterations,
                    parallelism,
                    tagLength: length
                },
                (error, derivedKey) =>
                    error
                        ? reject(error)
                        : resolve(
                              derivedKey.buffer.slice(
                                  derivedKey.byteOffset,
                                  derivedKey.byteOffset + derivedKey.byteLength
                              )
                          )
            );
        })
);

const password = 'e2e-fake-password';
const defaultOutputPath = fileURLToPath(
    new URL('../../test/android/fixtures/e2e-fixture.kdbx', import.meta.url)
);

export async function generateFixture(outputPath = defaultOutputPath) {
    const db = kdbxweb.Kdbx.create(
        new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString(password)),
        'E2E Fixture'
    );
    db.setVersion(4);
    db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
    db.header.kdfParameters.set(
        'M',
        kdbxweb.VarDictionary.ValueType.UInt64,
        new kdbxweb.Int64(16 * 1024 * 1024)
    );
    db.header.kdfParameters.set('I', kdbxweb.VarDictionary.ValueType.UInt64, new kdbxweb.Int64(2));
    const group = db.createGroup(db.getDefaultGroup(), 'Fixture');
    for (let i = 1; i <= 40; i++) {
        const entry = db.createEntry(group);
        entry.fields.set('Title', `a-rather-long-example-site-name.test #${i}`);
        entry.fields.set('UserName', `user${i}@example.test`);
        entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(`fake-password-${i}`));
        entry.fields.set('URL', `https://example.test/${i}`);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(await db.save()));
    return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const outputPath = path.resolve(process.argv[2] ?? defaultOutputPath);
    await generateFixture(outputPath);
    console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
}
