package com.mickdewald.keeweb;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.ViewTreeObserver;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;

@CapacitorPlugin(name = "SecureClipboard")
public class SecureClipboardPlugin extends Plugin {
    private static final String CLEAR_STATE = "secure-clipboard-clear-state";
    private static final String CLEAR_DUE_AT = "due-at";
    private static final String CLEAR_DIGEST = "digest";
    private static final String HMAC_ALIAS = "keeweb-clipboard-clear";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private View focusView;
    private ViewTreeObserver.OnWindowFocusChangeListener focusListener;

    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("text");
        int clearAfterSeconds = call.getInt("clearAfterSeconds", 0);
        if (text == null) {
            call.reject("text is required");
            return;
        }
        copySensitive(getContext(), text);
        // Only the newest copy may be cleared; drop timers of earlier copies.
        handler.removeCallbacksAndMessages(null);
        if (clearAfterSeconds > 0) {
            long dueAt = System.currentTimeMillis() + clearAfterSeconds * 1000L;
            if (rememberExpiry(getContext(), text, dueAt)) {
                scheduleExpiryClear(getContext(), dueAt);
            } else {
                // Preserve the live-process expiry when the Keystore-backed recovery record fails.
                handler.postDelayed(() -> clearIfUnchanged(getContext(), text), clearAfterSeconds * 1000L);
            }
        } else {
            clearExpiry(getContext());
        }
        call.resolve(new JSObject());
    }

    static void copySensitive(Context context, String text) {
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = ClipData.newPlainText("KeeWeb", text);
        if (Build.VERSION.SDK_INT >= 33) {
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
        }
        cm.setPrimaryClip(clip);
    }

    /**
     * Clears the clipboard when it still holds the value this app put there.
     *
     * When the clip is unreadable, clear it. Android returns null while this app is in the
     * background; preserving the existing 30-second password-expiry behavior takes precedence
     * over detecting a copy another app made in that interval.
     */
    static void clearIfUnchanged(Context context, String text) {
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData current = cm.getPrimaryClip();
        if (current == null || current.getItemCount() == 0) {
            cm.clearPrimaryClip();
            clearExpiry(context);
            return;
        }
        CharSequence value = current.getItemAt(0).getText();
        if (value != null && value.toString().equals(text)) {
            cm.clearPrimaryClip();
            clearExpiry(context);
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        restoreExpiryClearWhenFocused();
    }

    @Override
    protected void handleOnPause() {
        removeFocusListener();
        super.handleOnPause();
    }

    /**
     * Process death cancels the in-memory timer. Persisting only an HMAC of the copied text lets
     * a later foreground resume restore the remaining timer without retaining a password.
     */
    private void restoreExpiryClearWhenFocused() {
        if (getActivity() == null) {
            return;
        }
        View decor = getActivity().getWindow().getDecorView();
        if (decor.hasWindowFocus()) {
            restoreExpiryClear();
            return;
        }
        removeFocusListener();
        focusView = decor;
        focusListener = hasFocus -> {
            if (hasFocus) {
                removeFocusListener();
                restoreExpiryClear();
            }
        };
        decor.getViewTreeObserver().addOnWindowFocusChangeListener(focusListener);
    }

    private void removeFocusListener() {
        if (focusView != null && focusListener != null) {
            ViewTreeObserver observer = focusView.getViewTreeObserver();
            if (observer.isAlive()) {
                observer.removeOnWindowFocusChangeListener(focusListener);
            }
        }
        focusView = null;
        focusListener = null;
    }

    private void restoreExpiryClear() {
        Context context = getContext();
        SharedPreferences state = state(context);
        long dueAt = state.getLong(CLEAR_DUE_AT, 0);
        if (dueAt == 0 || state.getString(CLEAR_DIGEST, null) == null) {
            return;
        }
        scheduleExpiryClear(context, handler, dueAt);
    }

    private void scheduleExpiryClear(Context context, long dueAt) {
        scheduleExpiryClear(context, handler, dueAt);
    }

    static void scheduleExpiryClear(Context context, Handler handler, long dueAt) {
        handler.removeCallbacksAndMessages(null);
        postExpiryClear(context, handler, dueAt);
    }

    private static void postExpiryClear(Context context, Handler handler, long dueAt) {
        handler.postDelayed(() -> clearExpiredIfDueOrReschedule(context, handler),
                Math.max(0, dueAt - System.currentTimeMillis()));
    }

    static void clearExpiredIfDueOrReschedule(Context context, Handler handler) {
        SharedPreferences state = state(context);
        long dueAt = state.getLong(CLEAR_DUE_AT, 0);
        String expected = state.getString(CLEAR_DIGEST, null);
        long now = System.currentTimeMillis();
        if (dueAt == 0 || expected == null) {
            return;
        }
        if (dueAt > now) {
            postExpiryClear(context, handler, dueAt);
            return;
        }
        clearExpiredIfOwned(context);
    }

    static void clearExpiredIfOwned(Context context) {
        SharedPreferences state = state(context);
        long dueAt = state.getLong(CLEAR_DUE_AT, 0);
        String expected = state.getString(CLEAR_DIGEST, null);
        if (dueAt == 0 || expected == null || dueAt > System.currentTimeMillis()) {
            return;
        }
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData current = cm.getPrimaryClip();
        if (current == null || current.getItemCount() == 0) {
            // Preserve the original background expiry behavior when Android withholds clipboard reads.
            cm.clearPrimaryClip();
            clearExpiry(context);
            return;
        }
        CharSequence value = current.getItemAt(0).getText();
        if (value == null) {
            clearExpiry(context);
            return;
        }
        try {
            if (expected.equals(digest(value.toString()))) {
                cm.clearPrimaryClip();
            }
            clearExpiry(context);
        } catch (Exception ignored) {
            // Keep the expiry record for a later foreground resume if the keystore is transiently unavailable.
        }
    }

    static boolean rememberExpiry(Context context, String text, long dueAt) {
        try {
            return state(context).edit().putLong(CLEAR_DUE_AT, dueAt)
                    .putString(CLEAR_DIGEST, digest(text)).commit();
        } catch (Exception ignored) {
            // The in-memory timer remains active; never persist the copied password as a fallback.
            return false;
        }
    }

    private static SharedPreferences state(Context context) {
        return context.getSharedPreferences(CLEAR_STATE, Context.MODE_PRIVATE);
    }

    private static void clearExpiry(Context context) {
        state(context).edit().clear().apply();
    }

    private static String digest(String text) throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        SecretKey key = (SecretKey) keyStore.getKey(HMAC_ALIAS, null);
        if (key == null) {
            KeyGenerator generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(HMAC_ALIAS,
                    KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY).build());
            key = generator.generateKey();
        }
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(key);
        return Base64.encodeToString(
                mac.doFinal(text.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }
}
