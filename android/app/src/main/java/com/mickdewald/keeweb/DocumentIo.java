package com.mickdewald.keeweb;

import android.content.ContentResolver;
import android.content.UriPermission;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Arrays;

/** Reads and writes a document with content-hash revisions; never writes over unknown content. */
class DocumentIo {
    static class DocumentIoException extends Exception {
        final String code;

        DocumentIoException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private final ContentResolver resolver;

    DocumentIo(ContentResolver resolver) {
        this.resolver = resolver;
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

    /** Writes only over the content the caller last saw; returns the rev of what is on disk. */
    String write(Uri uri, byte[] data, String expectedRev) throws Exception {
        if (expectedRev == null) {
            throw new DocumentIoException("REV_REQUIRED", "No revision to compare with");
        }
        if (!expectedRev.equals(sha256(read(uri)))) {
            throw new DocumentIoException("REV_CONFLICT", "Remote file changed");
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

    /**
     * The code the web app sees for a failed call. PERMISSION_LOST (choose the file again) only
     * when access is really gone; a missing or unreadable document while the grant is still held
     * (e.g. Drive offline and not cached) is UNAVAILABLE, a temporary error.
     */
    static String errorCode(Exception e, boolean grantHeld) {
        if (e instanceof SecurityException) {
            return "PERMISSION_LOST";
        }
        boolean notFound = e instanceof FileNotFoundException
                || (e instanceof DocumentIoException && "NOT_FOUND".equals(((DocumentIoException) e).code));
        if (notFound) {
            return grantHeld ? "UNAVAILABLE" : "PERMISSION_LOST";
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
