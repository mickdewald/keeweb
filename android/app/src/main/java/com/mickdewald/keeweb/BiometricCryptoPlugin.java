package com.mickdewald.keeweb;

import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;
import android.os.Handler;
import android.os.Looper;
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
 * Rejection codes: USER_CANCELED, KEY_INVALIDATED, LOCKOUT, NO_BIOMETRICS, UNAVAILABLE, FAILED.
 * Never log call data or results: they carry the master password.
 */
@CapacitorPlugin(name = "BiometricCrypto")
public class BiometricCryptoPlugin extends Plugin {
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    // The decrypt call waiting for its prompt, and that prompt. Touched on the UI thread only;
    // each call is settled exactly once (by the prompt or by the stop safety net below).
    private PluginCall pendingDecrypt;
    private BiometricPrompt activePrompt;
    private long activeRequest;
    private long nextRequest;
    private boolean activeSettled;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private static final long CANCELLATION_TIMEOUT_MS = 1_000;
    private final BiometricPromptHandoff handoff = new BiometricPromptHandoff(
            new BiometricPromptHandoff.Scheduler() {
                @Override
                public void post(Runnable runnable) {
                    uiHandler.post(runnable);
                }

                @Override
                public void postDelayed(Runnable runnable, long delayMillis) {
                    uiHandler.postDelayed(runnable, delayMillis);
                }

                @Override
                public void cancel(Runnable runnable) {
                    uiHandler.removeCallbacks(runnable);
                }
            });

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
            // Also covers a missing or unrecoverable key (reinstall, data clear).
            call.reject("Biometric key invalidated", "KEY_INVALIDATED");
            return;
        } catch (Exception e) {
            call.reject("Biometric key unavailable: " + e.getClass().getSimpleName(), "FAILED");
            return;
        }
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("No activity for the biometric prompt", "FAILED");
            return;
        }
        activity.runOnUiThread(() -> {
            if (handoff.cancellationTimedOut()) {
                call.reject("Biometric prompt cancellation is still pending", "USER_CANCELED");
                return;
            }
            if (handoff.isActive() || handoff.hasQueuedReplacement()) {
                handoff.queueReplacement(
                        () -> startDecryptPrompt(new PendingDecrypt(call, blob, cipher)),
                        () -> call.reject("Superseded by a new biometric prompt", "USER_CANCELED"));
                if (activePrompt != null) {
                    cancelPendingDecrypt("Superseded by a new biometric prompt");
                }
                return;
            }
            startDecryptPrompt(new PendingDecrypt(call, blob, cipher));
        });
    }

    private void startDecryptPrompt(PendingDecrypt pending) {
        FragmentActivity activity = getActivity();
        if (activity == null || handoff.cancellationTimedOut()) {
            pending.call.reject("Biometric prompt unavailable", "USER_CANCELED");
            return;
        }
        long request = ++nextRequest;
        pendingDecrypt = pending.call;
        activeRequest = request;
        activeSettled = false;
        BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                        if (!isActive(request)) {
                            return;
                        }
                        if (!activeSettled) {
                            activeSettled = true;
                            byte[] plain = null;
                            try {
                                plain = HybridCrypto.decrypt(r.getCryptoObject().getCipher(), pending.blob);
                                pending.call.resolve(result(plain));
                            } catch (HybridCrypto.StaleBlobException e) {
                                pending.call.reject("Biometric key replaced", "KEY_INVALIDATED");
                            } catch (Exception e) {
                                pending.call.reject("Decryption failed: " + e.getClass().getSimpleName(), "FAILED");
                            } finally {
                                if (plain != null) {
                                    Arrays.fill(plain, (byte) 0);
                                }
                            }
                        }
                        finishPrompt(request);
                    }

                    @Override
                    public void onAuthenticationError(int code, CharSequence msg) {
                        if (!isActive(request)) {
                            return;
                        }
                        if (!activeSettled) {
                            activeSettled = true;
                            pending.call.reject(msg.toString(), errorCode(code));
                        }
                        finishPrompt(request);
                    }
                });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(pending.call.getString("prompt", "Unlock"))
                .setNegativeButtonText(pending.call.getString("negativeButton", "Use password"))
                .setAllowedAuthenticators(STRONG)
                .build();
        activePrompt = prompt;
        handoff.started();
        prompt.authenticate(info, new BiometricPrompt.CryptoObject(pending.cipher));
    }

    private boolean isActive(long request) {
        return activePrompt != null && activeRequest == request;
    }

    private void finishPrompt(long request) {
        if (!isActive(request)) {
            return;
        }
        pendingDecrypt = null;
        activePrompt = null;
        activeSettled = false;
        activeRequest = 0;
        // AndroidX 1.1 routes prompt results through an activity-scoped ViewModel. The handoff
        // posts a replacement only after this terminal callback has fully unwound.
        handoff.terminal();
    }

    private static final class PendingDecrypt {
        final PluginCall call;
        final byte[] blob;
        final Cipher cipher;

        PendingDecrypt(PluginCall call, byte[] blob, Cipher cipher) {
            this.call = call;
            this.blob = blob;
            this.cipher = cipher;
        }
    }

    /**
     * Safety net: a prompt that never calls back would leave the open view busy forever. When
     * the activity stops (app left), the pending call ends as a cancel, which the web app
     * treats like "Use password".
     */
    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        handoff.rejectQueued();
        cancelPendingDecrypt("Biometric prompt interrupted");
    }

    private void cancelPendingDecrypt(String message) {
        PluginCall call = pendingDecrypt;
        BiometricPrompt prompt = activePrompt;
        if (call == null) {
            return;
        }
        if (!activeSettled) {
            activeSettled = true;
            call.reject(message, "USER_CANCELED");
        }
        if (prompt == null) {
            return;
        }
        handoff.awaitCancellation(CANCELLATION_TIMEOUT_MS);
        prompt.cancelAuthentication();
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

    /** Maps BiometricPrompt errors to the codes the web app understands. */
    static String errorCode(int code) {
        switch (code) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
            case BiometricPrompt.ERROR_TIMEOUT:
                return "USER_CANCELED";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "LOCKOUT";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
                return "NO_BIOMETRICS";
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
                return "UNAVAILABLE";
            default:
                return "FAILED";
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
