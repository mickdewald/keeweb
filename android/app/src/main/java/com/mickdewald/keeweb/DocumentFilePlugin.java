package com.mickdewald.keeweb;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "DocumentFile")
public class DocumentFilePlugin extends Plugin {
    private static final int GRANT =
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    // One thread: this app's reads and writes of a document never interleave.
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private DocumentIo documents() {
        return new DocumentIo(getContext().getContentResolver());
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Picker canceled", "CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            // Keeps read/write access across restarts; without it the next sync fails.
            getContext().getContentResolver().takePersistableUriPermission(uri, GRANT);
        } catch (SecurityException e) {
            reject(call, e);
            return;
        }
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", displayName(uri));
        call.resolve(o);
    }

    @PluginMethod
    public void read(PluginCall call) {
        io.execute(() -> {
            try {
                byte[] data = documents().read(Uri.parse(call.getString("uri")));
                JSObject o = new JSObject();
                o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                o.put("rev", DocumentIo.sha256(data));
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    @PluginMethod
    public void stat(PluginCall call) {
        io.execute(() -> {
            try {
                JSObject o = new JSObject();
                o.put("rev", DocumentIo.sha256(documents().read(Uri.parse(call.getString("uri")))));
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        io.execute(() -> {
            try {
                byte[] data = Base64.decode(call.getString("data"), Base64.NO_WRAP);
                String rev = documents().write(
                        Uri.parse(call.getString("uri")), data, call.getString("expectedRev"));
                JSObject o = new JSObject();
                o.put("rev", rev);
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    /** Gives up the persisted grant of a document the app no longer uses. */
    @PluginMethod
    public void release(PluginCall call) {
        io.execute(() -> {
            try {
                getContext().getContentResolver()
                        .releasePersistableUriPermission(Uri.parse(call.getString("uri")), GRANT);
                call.resolve();
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri,
                new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                return c.getString(0);
            }
        }
        return "Database.kdbx";
    }

    private void reject(PluginCall call, Exception e) {
        String uri = call.getString("uri");
        boolean grantHeld = false;
        try {
            grantHeld = uri != null && documents().grantHeld(Uri.parse(uri));
        } catch (Exception ignored) {
            // Grant state unknown: treat it as not held, which at worst offers to choose again.
        }
        call.reject(e.getMessage(), DocumentIo.errorCode(e, grantHeld), e);
    }
}
