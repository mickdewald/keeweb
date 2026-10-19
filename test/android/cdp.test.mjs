import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPageTarget, isMainModule, assertFixtureTarget } from '../../scripts/android/cdp.mjs';
import { pathToFileURL } from 'node:url';

test('a WebView target is required before a socket is opened', () => {
    assert.throws(() => findPageTarget([]), /WebView page/);
    assert.throws(() => findPageTarget([{ type: 'page' }]), /WebView page/);
    assert.throws(() => findPageTarget({}), /WebView page/);
});

test('only a debuggable page target is selected', () => {
    const page = { type: 'page', webSocketDebuggerUrl: 'ws://localhost/test' };
    assert.equal(findPageTarget([{ type: 'worker' }, page]), page);
});

test('entry-point paths containing spaces are recognized', () => {
    assert.equal(
        isMainModule(pathToFileURL('/tmp/test path/cdp.mjs').href, '/tmp/test path/cdp.mjs'),
        true
    );
    assert.equal(isMainModule(import.meta.url, undefined), false);
});

test('fixture reset cannot target a phone or the stable app', () => {
    assert.throws(
        () => assertFixtureTarget('physical-serial', 'com.mickdewald.keeweb.dev'),
        /emulator/
    );
    assert.throws(() => assertFixtureTarget('emulator-5580', 'com.mickdewald.keeweb'), /debug/);
    assert.doesNotThrow(() => assertFixtureTarget('emulator-5580', 'com.mickdewald.keeweb.dev'));
});
