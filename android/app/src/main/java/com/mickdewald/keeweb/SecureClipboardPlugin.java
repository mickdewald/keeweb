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
        if (clearAfterSeconds > 0) {
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

    /** Clears the clipboard only when it still holds the value this app put there. */
    static void clearIfUnchanged(Context context, String text) {
        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData current = cm.getPrimaryClip();
        if (current == null || current.getItemCount() == 0) {
            return;
        }
        CharSequence value = current.getItemAt(0).getText();
        if (value != null && value.toString().equals(text)) {
            cm.clearPrimaryClip();
        }
    }
}
