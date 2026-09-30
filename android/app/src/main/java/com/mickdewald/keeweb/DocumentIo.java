package com.mickdewald.keeweb;

import android.content.ContentResolver;
import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
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
