import * as kdbxweb from 'kdbxweb';
import { Locale } from 'util/locale';

// Android implementation of the NativeModules hardware-crypto API (Touch ID on macOS),
// backed by the BiometricCrypto Capacitor plugin. Values cross the bridge as base64.

function toError(e) {
    const err = new Error((e && e.message) || 'Biometric operation failed');
    err.code = (e && e.code) || 'FAILED';
    return err;
}

function createAndroidNativeModules(plugin) {
    const b64 = (pv) => kdbxweb.ByteUtils.bytesToBase64(pv.getBinary());
    const fromB64 = (s) =>
        kdbxweb.ProtectedValue.fromBinary(kdbxweb.ByteUtils.base64ToBytes(s).buffer);
    return {
        async hardwareEncrypt(value) {
            try {
                return fromB64((await plugin.encrypt({ data: b64(value) })).data);
            } catch (e) {
                throw toError(e);
            }
        },
        async hardwareDecrypt(value, prompt) {
            try {
                return fromB64(
                    (
                        await plugin.decrypt({
                            data: b64(value),
                            prompt,
                            negativeButton: Locale.bioUsePassword
                        })
                    ).data
                );
            } catch (e) {
                throw toError(e);
            }
        },
        async hardwareCryptoDeleteKey() {
            try {
                await plugin.deleteKey();
            } catch (e) {
                throw toError(e);
            }
        }
    };
}

export { createAndroidNativeModules };
