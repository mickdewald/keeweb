const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function createDeflateZip(name, content) {
    const fileName = Buffer.from(name);
    const compressed = deflateRawSync(content);
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(fileName.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(fileName.length, 28);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + fileName.length, 12);
    end.writeUInt32LE(local.length + fileName.length + compressed.length, 16);

    return Buffer.concat([local, fileName, compressed, central, fileName, end]);
}

function fixtureContent() {
    let state = 0x12345678;
    const content = Buffer.allocUnsafe(2 * 1024 * 1024);
    for (let ix = 0; ix < content.length; ix++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        content[ix] = state;
    }
    return content;
}

test('extract-zip completes a large deflate stream under the current Node runtime', { timeout: 15000 }, async (t) => {
    const work = await mkdtemp(join(tmpdir(), 'keeweb-electron-zip-'));
    t.after(() => rm(work, { recursive: true, force: true }));
    const archive = join(work, 'electron.zip');
    const output = join(work, 'output');
    const content = fixtureContent();
    await writeFile(archive, createDeflateZip('LICENSES.chromium.html', content));

    await execFileAsync(
        process.execPath,
        [
            '-e',
            'require("extract-zip")(process.argv[1], { dir: process.argv[2] }).catch((error) => { console.error(error); process.exitCode = 1; });',
            archive,
            output
        ],
        { timeout: 10000 }
    );

    assert.deepEqual(await readFile(join(output, 'LICENSES.chromium.html')), content);
});
