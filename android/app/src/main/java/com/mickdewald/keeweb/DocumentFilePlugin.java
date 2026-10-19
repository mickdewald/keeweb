package com.mickdewald.keeweb;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.security.SecureRandom;
import java.io.File;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "DocumentFile")
public class DocumentFilePlugin extends Plugin {
    private static final int READ_GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION;
    private static final int WRITE_GRANT = Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private static final int PICK_GRANT = READ_GRANT | WRITE_GRANT;
    private static final int TREE_GRANT =
            READ_GRANT | WRITE_GRANT;
    private static final SecureRandom RANDOM = new SecureRandom();
    // One thread: this app's reads and writes of a document never interleave.
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Set<String> transientWriteUris = Collections.synchronizedSet(new HashSet<>());
    private boolean pickerActive;

    private DocumentIo documents() {
        return new DocumentIo(getContext().getContentResolver(),
                new File(getContext().getFilesDir(), "document-write-recovery"), transientWriteUris);
    }

    @PluginMethod
    public void pick(PluginCall call) {
        if (!beginPicker(call)) {
            return;
        }
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(PICK_GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchPicker(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        endPicker();
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            call.reject("Picker canceled", "CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            int grant = takeOpenDocumentPersistedPermission(uri, result.getData());
            if ((grant & WRITE_GRANT) != 0) {
                transientWriteUris.add(uri.toString());
            } else {
                transientWriteUris.remove(uri.toString());
            }
        } catch (SecurityException e) {
            reject(call, e);
            return;
        }
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", displayName(uri));
        putWritable(o, uri);
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
                putWritable(o, Uri.parse(call.getString("uri")));
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
                Uri uri = Uri.parse(call.getString("uri"));
                o.put("rev", DocumentIo.sha256(documents().read(uri)));
                putWritable(o, uri);
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

    /**
     * Exports only to a newly created document under a user-selected directory. Unlike
     * ACTION_CREATE_DOCUMENT, the user never selects an existing document to overwrite.
     */
    @PluginMethod
    public void exportNew(PluginCall call) {
        if (exportExtension(call.getString("extension", "bin")) == null) {
            call.reject("Export extension must contain 1 to 12 letters or digits", "EXPORT_INVALID");
            return;
        }
        if (!beginPicker(call)) {
            return;
        }
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(TREE_GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchPicker(call, i, "exported");
    }

    @ActivityCallback
    private void exported(PluginCall call, ActivityResult result) {
        if (call == null) {
            endPicker();
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            endPicker();
            call.reject("Export canceled", "CANCELED");
            return;
        }
        Uri tree = result.getData().getData();
        try {
            takeRequiredPersistedPermission(tree, result.getData(), TREE_GRANT);
        } catch (SecurityException e) {
            endPicker();
            reject(call, e);
            return;
        }
        io.execute(() -> {
            try {
                exportNew(call, tree);
            } finally {
                endPicker();
            }
        });
    }

    private void exportNew(PluginCall call, Uri tree) {
        try {
            DocumentIo documentIo = documents();
            requireCreateSupport(tree);
            Set<DocumentIdentity> protectedUris = protectedUris(call);
            Uri parent = exportParentUri(tree);
            Uri created = DocumentsContract.createDocument(getContext().getContentResolver(), parent,
                    call.getString("mimeType", "application/octet-stream"), exportName(call));
            if (created == null) {
                throw new DocumentIo.DocumentIoException("EXPORT_CREATE", "Provider did not create a document");
            }
            if (isProtectedExportUri(created, protectedUris)) {
                throw new DocumentIo.DocumentIoException("EXPORT_EXISTING", "Provider returned a protected document");
            }
            byte[] data = Base64.decode(call.getString("data"), Base64.NO_WRAP);
            String rev = documentIo.writeNew(created, data);
            JSObject out = new JSObject();
            out.put("uri", created.toString());
            out.put("name", displayName(created));
            out.put("rev", rev);
            call.resolve(out);
        } catch (Exception e) {
            call.reject(e.getMessage(), DocumentIo.errorCode(e, false), e);
        }
    }

    private void requireCreateSupport(Uri tree) throws Exception {
        Uri directory = exportParentUri(tree);
        try (Cursor c = getContext().getContentResolver().query(directory,
                new String[] {DocumentsContract.Document.COLUMN_FLAGS}, null, null, null)) {
            if (c == null || !c.moveToFirst()
                    || (c.getInt(0) & DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE) == 0) {
                throw new DocumentIo.DocumentIoException("EXPORT_CREATE", "Directory does not support new documents");
            }
        }
    }

    static Uri exportParentUri(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(
                tree, DocumentsContract.getTreeDocumentId(tree));
    }

    private String exportName(PluginCall call) {
        String extension = exportExtension(call.getString("extension", "bin"));
        String source = call.getString("suggestedName", "KeeWeb-export");
        String base = source.replaceAll("[^A-Za-z0-9._-]", "_");
        if (base.isEmpty()) {
            base = "KeeWeb-export";
        }
        int dot = base.lastIndexOf('.');
        String existing = dot >= 0 ? exportExtension(base.substring(dot + 1)) : null;
        if (existing != null) {
            extension = existing;
            base = base.substring(0, dot);
        }
        byte[] suffix = new byte[16];
        RANDOM.nextBytes(suffix);
        StringBuilder hex = new StringBuilder();
        for (byte b : suffix) {
            hex.append(String.format("%02x", b));
        }
        return base + "-" + hex + "." + extension;
    }

    static String exportExtension(String extension) {
        return extension != null && extension.matches("[A-Za-z0-9]{1,12}")
                ? extension.toLowerCase(java.util.Locale.ROOT) : null;
    }

    @PluginMethod
    public void pickRead(PluginCall call) {
        if (!beginPicker(call)) {
            return;
        }
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mimeType", "*/*"));
        i.addFlags(READ_GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchPicker(call, i, "pickedRead");
    }

    @ActivityCallback
    private void pickedRead(PluginCall call, ActivityResult result) {
        if (call == null) {
            endPicker();
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            endPicker();
            call.reject("Picker canceled", "CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            int grant = result.getData().getFlags() & READ_GRANT;
            if (grant != 0) {
                getContext().getContentResolver().takePersistableUriPermission(uri, grant);
            }
        } catch (SecurityException ignored) {
            // The transient read grant still covers this requested import.
        }
        io.execute(() -> {
            try {
                byte[] data = documents().read(uri);
                JSObject out = new JSObject();
                out.put("uri", uri.toString());
                out.put("name", displayName(uri));
                out.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
                out.put("rev", DocumentIo.sha256(data));
                call.resolve(out);
            } catch (Exception e) {
                reject(call, e);
            } finally {
                endPicker();
            }
        });
    }

    private synchronized boolean beginPicker(PluginCall call) {
        if (pickerActive) {
            call.reject("Another document picker is already active", "PICKER_BUSY");
            return false;
        }
        pickerActive = true;
        return true;
    }

    private void launchPicker(PluginCall call, Intent intent, String callback) {
        try {
            startActivityForResult(call, intent, callback);
        } catch (Exception e) {
            endPicker();
            call.reject(e.getMessage(), "IO", e);
        }
    }

    private synchronized void endPicker() {
        pickerActive = false;
    }

    private void takeRequiredPersistedPermission(Uri uri, Intent result, int required) {
        int grant = result.getFlags() & required;
        if (grant != required) {
            throw new SecurityException("Picker did not grant required document access");
        }
        getContext().getContentResolver().takePersistableUriPermission(uri, grant);
    }

    private int takeOpenDocumentPersistedPermission(Uri uri, Intent result) {
        int grant = persistableOpenDocumentGrant(result.getFlags());
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, grant);
        } catch (SecurityException e) {
            if ((grant & WRITE_GRANT) == 0) {
                throw e;
            }
            getContext().getContentResolver().takePersistableUriPermission(uri, READ_GRANT);
        }
        return grant;
    }

    static int persistableOpenDocumentGrant(int flags) {
        int grant = flags & PICK_GRANT;
        if ((grant & READ_GRANT) == 0) {
            throw new SecurityException("Picker did not grant required document read access");
        }
        return grant;
    }

    private Set<DocumentIdentity> protectedUris(PluginCall call) throws Exception {
        Set<DocumentIdentity> protectedUris = persistedDocumentUris();
        JSArray explicit = call.getArray("protectedUris");
        if (explicit != null) {
            for (int i = 0; i < explicit.length(); i++) {
                String value = explicit.optString(i, null);
                if (value == null) {
                    throw new DocumentIo.DocumentIoException("EXPORT_INVALID", "Protected URI must be a string");
                }
                DocumentIdentity identity = DocumentIdentity.from(Uri.parse(value));
                if (identity == null) {
                    throw new DocumentIo.DocumentIoException(
                            "EXPORT_INVALID", "Protected URI is not a document URI");
                }
                protectedUris.add(identity);
            }
        }
        return protectedUris;
    }

    private Set<DocumentIdentity> persistedDocumentUris() {
        Set<DocumentIdentity> identities = new HashSet<>();
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            DocumentIdentity identity = DocumentIdentity.from(permission.getUri());
            if (identity != null) {
                identities.add(identity);
            }
        }
        return identities;
    }

    static boolean isProtectedExportUri(Uri candidate, Set<DocumentIdentity> protectedUris) {
        DocumentIdentity identity = DocumentIdentity.from(candidate);
        return identity != null && protectedUris.contains(identity);
    }

    static final class DocumentIdentity {
        final String authority;
        final String documentId;

        DocumentIdentity(String authority, String documentId) {
            this.authority = authority;
            this.documentId = documentId;
        }

        static DocumentIdentity from(Uri uri) {
            if (uri == null || uri.getAuthority() == null) {
                return null;
            }
            try {
                return new DocumentIdentity(uri.getAuthority(), DocumentsContract.getDocumentId(uri));
            } catch (IllegalArgumentException e) {
                return null;
            }
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof DocumentIdentity)) {
                return false;
            }
            DocumentIdentity that = (DocumentIdentity) other;
            return authority.equals(that.authority) && documentId.equals(that.documentId);
        }

        @Override
        public int hashCode() {
            return 31 * authority.hashCode() + documentId.hashCode();
        }
    }

    /** Gives up the persisted grant of a document the app no longer uses. */
    @PluginMethod
    public void release(PluginCall call) {
        io.execute(() -> {
            try {
                Uri uri = Uri.parse(call.getString("uri"));
                int grant = persistedGrantFlags(uri);
                if (grant != 0) {
                    getContext().getContentResolver().releasePersistableUriPermission(uri, grant);
                }
                transientWriteUris.remove(uri.toString());
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

    private void putWritable(JSObject object, Uri uri) {
        try {
            object.put("writable", documents().writable(uri));
        } catch (Exception e) {
            object.put("writable", false);
        }
    }

    private void reject(PluginCall call, Exception e) {
        String uri = call.getString("uri");
        boolean grantHeld = false;
        boolean documentMissing = false;
        try {
            if (uri != null) {
                Uri parsedUri = Uri.parse(uri);
                grantHeld = documents().grantHeld(parsedUri);
                documentMissing = grantHeld && documents().documentMissing(parsedUri);
            }
        } catch (Exception ignored) {
            // Grant state unknown: treat it as not held, which at worst offers to choose again.
        }
        call.reject(e.getMessage(), DocumentIo.errorCode(e, grantHeld, documentMissing), e);
    }

    private int persistedGrantFlags(Uri uri) {
        for (android.content.UriPermission permission : getContext().getContentResolver()
                .getPersistedUriPermissions()) {
            if (permission.getUri().equals(uri)) {
                int grant = permission.isReadPermission() ? READ_GRANT : 0;
                return permission.isWritePermission()
                        ? grant | Intent.FLAG_GRANT_WRITE_URI_PERMISSION : grant;
            }
        }
        return 0;
    }
}
