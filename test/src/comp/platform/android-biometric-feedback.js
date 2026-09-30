import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { AndroidBiometricFeedback } from 'comp/platform/android/android-biometric-feedback';
import { createAndroidNativeModules } from 'comp/platform/android/android-native-modules';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';
import { Locale } from 'util/locale';
import { OpenView } from 'views/open-view';

describe('AndroidBiometricFeedback', () => {
    const withCode = (code, message = 'system message') =>
        Object.assign(new Error(message), { code });

    function openViewEl() {
        const el = document.createElement('div');
        el.innerHTML = `<div class="open__message hide"><div class="open__message-content"></div>
            <div class="open__message-cancel-btn"></div></div>`;
        return el;
    }

    it('treats cancel, lockout and missing biometrics like a cancel', () => {
        for (const code of ['USER_CANCELED', 'LOCKOUT', 'NO_BIOMETRICS', 'UNAVAILABLE']) {
            expect(AndroidBiometricFeedback.isSoftError(withCode(code)), code).to.equal(true);
        }
        for (const code of ['KEY_INVALIDATED', 'FAILED', undefined]) {
            expect(AndroidBiometricFeedback.isSoftError(withCode(code)), code).to.equal(false);
        }
    });

    it('opens the keyboard and shows no message after a plain cancel', async () => {
        const el = openViewEl();
        let shown = 0;
        await AndroidBiometricFeedback.show(el, withCode('USER_CANCELED'), {
            show: () => Promise.resolve(shown++)
        });
        expect(shown).to.equal(1);
        expect(el.querySelector('.open__message').classList.contains('hide')).to.equal(true);
    });

    it('shows the system message non-blockingly after a lockout', async () => {
        const el = openViewEl();
        await AndroidBiometricFeedback.show(el, withCode('LOCKOUT', 'Too many attempts'), {
            show: () => Promise.reject(new Error('no keyboard'))
        });
        const box = el.querySelector('.open__message');
        expect(box.classList.contains('hide')).to.equal(false);
        expect(box.querySelector('.open__message-content').textContent).to.equal(
            'Too many attempts'
        );
        box.querySelector('.open__message-cancel-btn').click();
        expect(box.classList.contains('hide')).to.equal(true);
    });

    it('passes the localized "use password" label to the prompt', async () => {
        let options;
        const nm = createAndroidNativeModules({
            decrypt: (o) => {
                options = o;
                return Promise.resolve({ data: o.data });
            }
        });
        await nm.hardwareDecrypt(kdbxweb.ProtectedValue.fromString('x'), 'Unlock');
        expect(options.prompt).to.equal('Unlock');
        expect(options.negativeButton).to.equal(Locale.bioUsePassword);
        expect(Locale.bioUsePassword).to.be.a('string').that.is.not.equal('');
    });

    it('explains changed biometrics without macOS wording on Android', () => {
        const android = TouchIdRecovery.requiredAlertText(true);
        expect(android.header).to.equal(Locale.bioChangedHeader);
        expect(android.body).to.equal(Locale.bioChangedBody);
        expect(Locale.bioChangedHeader).to.equal('Biometrics changed');
        const mac = TouchIdRecovery.requiredAlertText(false);
        expect(mac.header).to.equal(Locale.setGenTouchId);
        expect(mac.body).to.equal(Locale.touchIdRecoveryBody);
    });

    it('focuses the password field on Android only when no biometric password is offered', () => {
        const decide = (over) =>
            AndroidBiometricFeedback.shouldFocusPassword({
                isAndroid: true,
                hasFile: true,
                canUseEncryptedPassword: false,
                ...over
            });
        expect(decide({})).to.equal(true);
        expect(decide({ canUseEncryptedPassword: true })).to.equal(false);
        expect(decide({ hasFile: false })).to.equal(false);
        expect(decide({ isAndroid: false })).to.equal(false);
    });

    it('opens the keyboard and tolerates a missing keyboard plugin', async () => {
        let shown = 0;
        await AndroidBiometricFeedback.showKeyboard({ show: () => Promise.resolve(shown++) });
        expect(shown).to.equal(1);
        await AndroidBiometricFeedback.showKeyboard({
            show: () => Promise.reject(new Error('no keyboard'))
        });
    });

    it('shows the Android wording when reconnecting biometrics failed', () => {
        const android = TouchIdRecovery.failedAlertText(true);
        expect(android.header).to.equal(Locale.openError);
        expect(android.body).to.equal(Locale.bioReconnectFailedBody);
        expect(Locale.bioReconnectFailedBody).to.not.contain('Touch ID');
        expect(TouchIdRecovery.failedAlertText(false).body).to.equal(Locale.touchIdRecoveryBody);
    });

    it('focuses the password and opens the keyboard when a file is selected without biometrics', () => {
        const run = ({ encryptedPassword, typed = '', isAndroid = true }) => {
            const calls = [];
            const view = {
                params: { name: 'Main' },
                encryptedPassword,
                passwordInput: { length: typed.length },
                focusInput: (mobile) => calls.push(mobile ? 'focus-mobile' : 'focus')
            };
            const feedback = {
                shouldFocusPassword: (o) =>
                    AndroidBiometricFeedback.shouldFocusPassword({ ...o, isAndroid }),
                showKeyboard: () => calls.push('keyboard')
            };
            OpenView.prototype.focusPasswordForFile.call(view, feedback);
            return calls;
        };
        expect(run({ encryptedPassword: null })).to.eql(['focus-mobile', 'keyboard']);
        expect(run({ encryptedPassword: { value: 'x' } })).to.eql(['focus']);
        expect(run({ encryptedPassword: { value: 'x' }, typed: 'ab' })).to.eql([
            'focus-mobile',
            'keyboard'
        ]);
        expect(run({ encryptedPassword: null, isAndroid: false })).to.eql(['focus']);
    });
});
