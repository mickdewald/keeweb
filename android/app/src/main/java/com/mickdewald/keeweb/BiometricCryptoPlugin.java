package com.mickdewald.keeweb;

import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import javax.crypto.Cipher;

/**
 * Bridge for NativeModules.hardwareEncrypt / hardwareDecrypt / hardwareCryptoDeleteKey.
 * Rejection codes: USER_CANCELED, KEY_INVALIDATED, LOCKOUT, NO_BIOMETRICS, FAILED.
 * Never log call data or results: they carry the master password.
 */
@CapacitorPlugin(name = "BiometricCrypto")
public class BiometricCryptoPlugin extends Plugin {
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    @PluginMethod
    public void encrypt(PluginCall call) {
        byte[] plain = null;
        try {
            if (BiometricManager.from(getContext()).canAuthenticate(STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
                call.reject("No strong biometrics enrolled", "NO_BIOMETRICS");
                return;
            }
            HybridCrypto.ensureKey(true);
            plain = decodeData(call);
            call.resolve(result(HybridCrypto.encrypt(plain)));
        } catch (Exception e) {
            call.reject("Encryption failed: " + e.getClass().getSimpleName(), "FAILED");
        } finally {
            if (plain != null) {
                Arrays.fill(plain, (byte) 0);
            }
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        final byte[] blob;
        final Cipher cipher;
        try {
            blob = decodeData(call);
        } catch (Exception e) {
            call.reject("Missing or malformed data", "FAILED");
            return;
        }
        try {
            cipher = HybridCrypto.decryptCipher();
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("Biometric key invalidated", "KEY_INVALIDATED");
            return;
        } catch (Exception e) {
            // A missing or unusable key after a reinstall or data clear behaves like an invalidated key.
            call.reject("Biometric key unavailable: " + e.getClass().getSimpleName(), "KEY_INVALIDATED");
            return;
        }
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity for the biometric prompt", "FAILED");
            return;
        }
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                            byte[] plain = null;
                            try {
                                plain = HybridCrypto.decrypt(r.getCryptoObject().getCipher(), blob);
                                call.resolve(result(plain));
                            } catch (Exception e) {
                                call.reject("Decryption failed: " + e.getClass().getSimpleName(), "FAILED");
                            } finally {
                                if (plain != null) {
                                    Arrays.fill(plain, (byte) 0);
                                }
                            }
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            boolean canceled = code == BiometricPrompt.ERROR_USER_CANCELED
                                    || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                    || code == BiometricPrompt.ERROR_CANCELED;
                            boolean lockout = code == BiometricPrompt.ERROR_LOCKOUT
                                    || code == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                            call.reject(msg.toString(), canceled ? "USER_CANCELED" : lockout ? "LOCKOUT" : "FAILED");
                        }
                    });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(call.getString("prompt", "Unlock"))
                    .setNegativeButtonText("Use password")
                    .setAllowedAuthenticators(STRONG)
                    .build();
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        try {
            HybridCrypto.deleteKey();
            call.resolve(new JSObject());
        } catch (Exception e) {
            call.reject("Deleting the key failed: " + e.getClass().getSimpleName(), "FAILED");
        }
    }

    private static byte[] decodeData(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            throw new IllegalArgumentException("data is required");
        }
        return Base64.decode(data, Base64.NO_WRAP);
    }

    private static JSObject result(byte[] data) {
        JSObject o = new JSObject();
        o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        return o;
    }
}
