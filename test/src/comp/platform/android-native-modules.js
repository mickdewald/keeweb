import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import { createAndroidNativeModules } from 'comp/platform/android/android-native-modules';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';
import { AppModel } from 'models/app-model';

describe('Android NativeModules', () => {
    // Reverses the bytes (reversing the base64 text itself would not be valid base64).
    const reverse = (data) => btoa(atob(data).split('').reverse().join(''));
    const plugin = {
        encrypt: ({ data }) => Promise.resolve({ data: reverse(data) }),
        decrypt: ({ data }) => Promise.resolve({ data: reverse(data) }),
        deleteKey: () => Promise.resolve({})
    };

    afterEach(() => TouchIdRecovery.resetForTests());

    it('round-trips a ProtectedValue through the plugin', async () => {
        const nm = createAndroidNativeModules(plugin);
        const enc = await nm.hardwareEncrypt(kdbxweb.ProtectedValue.fromString('pw'));
        const dec = await nm.hardwareDecrypt(enc, 'Unlock');
        expect(dec.getText()).to.equal('pw');
    });

    it('turns plugin rejections into errors with a code', async () => {
        const failing = {
            ...plugin,
            decrypt: () => Promise.reject({ code: 'KEY_INVALIDATED', message: 'invalidated' })
        };
        const nm = createAndroidNativeModules(failing);
        try {
            await nm.hardwareDecrypt(kdbxweb.ProtectedValue.fromString('x'), 'Unlock');
            expect.fail('should reject');
        } catch (err) {
            expect(err).to.be.instanceOf(Error);
            expect(err.code).to.equal('KEY_INVALIDATED');
        }
    });

    it('lets TouchIdRecovery recognise an invalidated Android key', () => {
        const err = Object.assign(new Error('invalidated'), { code: 'KEY_INVALIDATED' });
        expect(TouchIdRecovery.handleDecryptionError(err, 'file-1')).to.equal(true);
        expect(TouchIdRecovery.isRequired('file-1')).to.equal(true);
    });
});

describe('AppModel hardware decrypt without a launcher (Android)', () => {
    it('finishes a hardware decrypt without touching the missing Launcher', () => {
        const model = { hardwareDecryptInProgress: true };
        // Events.emit rethrows listener errors, which would abort the unlock after the prompt.
        expect(() => AppModel.prototype.hardwareDecryptFinished.call(model)).not.to.throw();
        expect(model.hardwareDecryptInProgress).to.equal(false);
    });
});
