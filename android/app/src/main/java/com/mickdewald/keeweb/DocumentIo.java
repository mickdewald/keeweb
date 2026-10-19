package com.mickdewald.keeweb;

import android.content.ContentResolver;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Collections;
import java.util.Set;

/** Reads documents and writes only after hash checks, recovery, and readback verification. */
class DocumentIo {
    static class DocumentIoException extends Exception {
        final String code;

        DocumentIoException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private final ContentResolver resolver;
    private final DocumentWriteRecoveryStore recoveryStore;
    private final Set<String> transientWriteUris;

    DocumentIo(ContentResolver resolver) {
        this(resolver, null);
    }

    DocumentIo(ContentResolver resolver, File recoveryRoot) {
        this(resolver, recoveryRoot, Collections.emptySet());
    }

    DocumentIo(ContentResolver resolver, File recoveryRoot, Set<String> transientWriteUris) {
        this.resolver = resolver;
        this.recoveryStore = recoveryRoot == null ? null : new DocumentWriteRecoveryStore(recoveryRoot);
        this.transientWriteUris = transientWriteUris == null ? Collections.emptySet() : transientWriteUris;
    }

    byte[] read(Uri uri) throws Exception {
        try (InputStream in = open(resolver.openInputStream(uri));
                ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } catch (FileNotFoundException e) {
            throw new DocumentIoException("NOT_FOUND", e.getMessage());
        }
    }

    String write(Uri uri, byte[] data, String expectedRev) throws Exception {
        requireExpectedRev(expectedRev);
        byte[] current = read(uri);
        if (!sha256(current).equalsIgnoreCase(expectedRev)) {
            throw new DocumentIoException("REV_CONFLICT", "Document changed before write");
        }
        if (!writable(uri)) {
            throw new DocumentIoException("READ_ONLY", "Document provider did not grant write access");
        }
        if (recoveryStore == null) {
            throw new DocumentIoException("IO", "Document write recovery store is unavailable");
        }
        /*
         * This is a practical same-file write, not provider-level CAS. Another client can
         * still write between our read and truncating write; recovery keeps both byte sets.
         */
        recoveryStore.prepare(uri, expectedRev.toLowerCase(java.util.Locale.ROOT), current, data);
        try {
            try (OutputStream out = open(resolver.openOutputStream(uri, "wt"))) {
                out.write(data);
            } catch (FileNotFoundException e) {
                throw new DocumentIoException("NOT_FOUND", e.getMessage());
            }
            String rev = verifiedRev(data, read(uri));
            return rev;
        } catch (Exception e) {
            throw e;
        }
    }

    /** Writes a newly created empty document and verifies the exact bytes before success. */
    String writeNew(Uri uri, byte[] data) throws Exception {
        if (read(uri).length != 0) {
            throw new DocumentIoException("EXPORT_EXISTING", "Refusing to overwrite a nonempty document");
        }
        try (OutputStream out = open(resolver.openOutputStream(uri, "wt"))) {
            out.write(data);
        } catch (FileNotFoundException e) {
            throw new DocumentIoException("NOT_FOUND", e.getMessage());
        }
        return verifiedRev(data, read(uri));
    }

    /** True while the app still holds the persisted read grant for this document. */
    boolean grantHeld(Uri uri) {
        for (UriPermission p : resolver.getPersistedUriPermissions()) {
            if (p.isReadPermission() && p.getUri().equals(uri)) {
                return true;
            }
        }
        return false;
    }

    boolean writable(Uri uri) throws Exception {
        if ("file".equals(uri.getScheme())) {
            String path = uri.getPath();
            return path != null && new File(path).canWrite();
        }
        Integer flags = documentFlags(uri);
        if (flags == null || (flags & android.provider.DocumentsContract.Document.FLAG_SUPPORTS_WRITE) == 0) {
            return false;
        }
        if (transientWriteUris.contains(uri.toString())) {
            return true;
        }
        UriPermission persisted = persistedPermission(uri);
        return persisted != null && persisted.isWritePermission();
    }

    /** True only when the provider can answer the metadata query and finds no document. */
    boolean documentMissing(Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME},
                null, null, null)) {
            return cursor != null && !cursor.moveToFirst();
        } catch (SecurityException e) {
            return true;
        } catch (Exception e) {
            // Providers can fail metadata queries while offline. Keep that retryable.
            return false;
        }
    }

    /**
     * The code the web app sees for a failed call. PERMISSION_LOST (choose the file again) only
     * when access is really gone; a missing or unreadable document while the grant is still held
     * (e.g. Drive offline and not cached) is UNAVAILABLE, a temporary error.
     */
    static String errorCode(Exception e, boolean grantHeld) {
        return errorCode(e, grantHeld, false);
    }

    static String errorCode(Exception e, boolean grantHeld, boolean documentMissing) {
        if (e instanceof SecurityException) {
            return "PERMISSION_LOST";
        }
        boolean notFound = e instanceof FileNotFoundException
                || (e instanceof DocumentIoException && "NOT_FOUND".equals(((DocumentIoException) e).code));
        if (notFound) {
            return grantHeld && !documentMissing ? "UNAVAILABLE" : "PERMISSION_LOST";
        }
        if (e instanceof DocumentIoException) {
            return ((DocumentIoException) e).code;
        }
        return grantHeld && e instanceof IOException ? "UNAVAILABLE" : "IO";
    }

    static String verifiedRev(byte[] written, byte[] readBack) throws DocumentIoException {
        if (!Arrays.equals(written, readBack)) {
            // E.g. a provider that ignored the truncation; sync keeps the file dirty and cached.
            throw new DocumentIoException("IO", "write verification failed");
        }
        return sha256(readBack);
    }

    private static void requireExpectedRev(String expectedRev) throws DocumentIoException {
        if (expectedRev == null || !expectedRev.matches("(?i)[0-9a-f]{64}")) {
            throw new DocumentIoException("REV_REQUIRED", "A valid expected revision is required");
        }
    }

    private Integer documentFlags(Uri uri) throws Exception {
        try (Cursor cursor = resolver.query(uri,
                new String[] {android.provider.DocumentsContract.Document.COLUMN_FLAGS}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getInt(0);
            }
            return null;
        }
    }

    private UriPermission persistedPermission(Uri uri) {
        for (UriPermission p : resolver.getPersistedUriPermissions()) {
            if (p.getUri().equals(uri)) {
                return p;
            }
        }
        return null;
    }

    static String sha256(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder();
            for (byte b : d) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static <T> T open(T stream) throws FileNotFoundException {
        if (stream == null) {
            throw new FileNotFoundException("Provider returned no stream");
        }
        return stream;
    }
}
