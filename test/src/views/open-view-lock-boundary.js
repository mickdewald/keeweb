import { expect } from 'chai';
import { createOpenViewOperationsMixin } from 'views/open-view-operations';
import { OpenView } from 'views/open-view';
import { SecureInput } from 'comp/browser/secure-input';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import $ from 'jquery';

describe('Open view authentication lock boundary', () => {
    it('clears the secure password buffer and visible input when Android backgrounds', () => {
        const wasAndroid = AndroidPlatform.isAndroid;
        const inputEl = $('<input>');
        const passwordInput = new SecureInput();
        passwordInput.setElement(inputEl);
        inputEl.val('fixture-only').trigger('input');
        const oldSalt = passwordInput.salt;
        const model = {};
        const subject = { model, inputEl, passwordInput, params: { password: {} } };
        try {
            AndroidPlatform.isAndroid = true;
            OpenView.prototype.clearPasswordForBackground.call(subject, { model });
            expect(passwordInput.length).to.equal(0);
            expect(inputEl.val()).to.equal('');
            expect([...oldSalt].every((byte) => byte === 0)).to.equal(true);
            expect(subject.params.password).to.equal(null);
            inputEl.val('new-fixture').trigger('input');
            expect(passwordInput.value.getText()).to.equal('new-fixture');
        } finally {
            AndroidPlatform.isAndroid = wasAndroid;
        }
    });

    function view(nativeModules = {}) {
        const opened = [];
        const model = {
            backgroundLockGeneration: 0,
            backgroundLockActive: false,
            files: { get: () => null },
            openFile(params) {
                opened.push(params);
            }
        };
        const chain = { toggleClass() {}, attr() {} };
        const mixin = createOpenViewOperationsMixin({
            kdbxweb: { ProtectedValue: { fromBase64: () => ({}) } },
            Events: { emit() {} },
            Locale: { bioOpenAuthPrompt: 'Open {}' },
            NativeModules: nativeModules,
            logger: { debug() {}, error() {} }
        });
        return {
            ...mixin,
            model,
            opened,
            params: { name: 'Fixture' },
            passwordInput: { value: { length: 1 } },
            $el: chain,
            inputEl: chain,
            afterPaint(fn) {
                this.paint = fn;
            },
            openDbComplete(err) {
                this.completed = err;
                this.busy = false;
            }
        };
    }

    it('rejects password unlock queued before a completed background lock', () => {
        const subject = view();
        subject.openDb();
        subject.model.backgroundLockGeneration++;
        subject.paint();
        expect(subject.opened).to.eql([]);
        expect(subject.completed.userCanceled).to.equal(true);
    });

    it('rejects and erases a biometric result arriving after Home and resume', async () => {
        let decrypted;
        const subject = view({
            hardwareDecrypt: () => new Promise((resolve) => (decrypted = resolve))
        });
        subject.passwordInput.value = { length: 0 };
        subject.encryptedPassword = { value: 'fixture-only' };
        subject.openDb();
        subject.model.backgroundLockGeneration++;
        const password = { value: new Uint8Array([1, 2]), salt: new Uint8Array([3, 4]) };
        decrypted(password);
        await Promise.resolve();
        expect(subject.opened).to.eql([]);
        expect([...password.value, ...password.salt]).to.eql([0, 0, 0, 0]);
        expect(subject.completed.userCanceled).to.equal(true);
    });

    it('passes the original authentication generation and selection to file opening', () => {
        const subject = view();
        subject.openDb();
        subject.params.name = 'Different';
        subject.paint();
        expect(subject.opened[0].name).to.equal('Fixture');
        expect(subject.opened[0].openLockGeneration).to.equal(0);
    });
});
