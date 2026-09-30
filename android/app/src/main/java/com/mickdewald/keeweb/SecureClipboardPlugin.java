package com.mickdewald.keeweb;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureClipboard")
public class SecureClipboardPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());

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
            // Limitation: this timer lives in the app process. If Android kills the process
            // before it fires, the clipboard is not cleared (no WorkManager on purpose).
            handler.postDelayed(() -> clearIfUnchanged(getContext(), text), clearAfterSeconds * 1000L);
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
     * When the clip is readable and differs, something else was copied meanwhile: keep it.
     * On Android 10+ a background app cannot read the clipboard (getPrimaryClip returns null),
     * and this timer usually fires while the user is in another app. An unreadable clip is
     * therefore cleared unconditionally. Accepted cost: a value another app copied within the
     * clear window may be removed, as in other password managers.
     */
    static void clearIfUnchanged(Context context, String text) {
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData current = cm.getPrimaryClip();
        if (current == null || current.getItemCount() == 0) {
            cm.clearPrimaryClip();
            return;
        }
        CharSequence value = current.getItemAt(0).getText();
        if (value != null && value.toString().equals(text)) {
            cm.clearPrimaryClip();
        }
    }
}
