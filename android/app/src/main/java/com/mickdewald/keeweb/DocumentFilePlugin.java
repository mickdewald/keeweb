package com.mickdewald.keeweb;

import android.app.Activity;
import android.content.ContentResolver;
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
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "DocumentFile")
public class DocumentFilePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
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
            getContext().getContentResolver().takePersistableUriPermission(uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
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
                byte[] data = readAll(Uri.parse(call.getString("uri")));
                JSObject o = new JSObject();
                o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                o.put("rev", sha256(data));
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
                o.put("rev", sha256(readAll(Uri.parse(call.getString("uri")))));
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
                Uri uri = Uri.parse(call.getString("uri"));
                String expected = call.getString("expectedRev");
                if (expected != null && !expected.equals(sha256(readAll(uri)))) {
                    call.reject("Remote file changed", "REV_CONFLICT");
                    return;
                }
                byte[] data = Base64.decode(call.getString("data"), Base64.NO_WRAP);
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    out.write(data);
                }
                JSObject o = new JSObject();
                o.put("rev", sha256(data));
                call.resolve(o);
            } catch (Exception e) {
                reject(call, e);
            }
        });
    }

    private byte[] readAll(Uri uri) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        try (InputStream in = cr.openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
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

    private static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static void reject(PluginCall call, Exception e) {
        String code = e instanceof FileNotFoundException ? "NOT_FOUND"
                : e instanceof SecurityException ? "PERMISSION_LOST" : "IO";
        call.reject(e.getMessage(), code, e);
    }
}
