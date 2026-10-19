package com.mickdewald.keeweb;

import android.net.Uri;
import android.util.AtomicFile;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;

/** App-private recovery records for SAF writes that touched an external provider. */
class DocumentWriteRecoveryStore {
    private static final int MAGIC = 0x4b575246; // KWRF
    private static final int VERSION = 1;
    private static final long MAX_RECORD_BYTES = 128L * 1024L * 1024L;
    private static final long MAX_TOTAL_BYTES = 512L * 1024L * 1024L;
    private final File root;

    DocumentWriteRecoveryStore(File root) {
        this.root = root;
    }

    void prepare(Uri uri, String expectedRev, byte[] preimage, byte[] attempt)
            throws DocumentIo.DocumentIoException {
        long recordBytes = checkedSize(preimage) + checkedSize(attempt) + 4096L;
        if (recordBytes > MAX_RECORD_BYTES) {
            throw recoveryUnavailable("document write recovery record is too large");
        }
        ensureRoot();
        File dir = new File(root, keyFor(uri));
        if (dir.exists() && !dir.isDirectory()) {
            throw recoveryUnavailable("document write recovery record path is not a directory");
        }
        long priorBytes = directorySize(dir);
        if (directorySize(root) - priorBytes + recordBytes > MAX_TOTAL_BYTES) {
            throw recoveryUnavailable("document write recovery quota exceeded");
        }
        if (!dir.exists() && !dir.mkdir()) {
            throw recoveryUnavailable("cannot create document write recovery record");
        }
        try {
            writeRecord(new File(dir, "record.bin"), expectedRev, preimage, attempt);
        } catch (DocumentIo.DocumentIoException e) {
            throw e;
        } catch (Exception e) {
            throw recoveryUnavailable("cannot commit document write recovery record");
        }
    }

    static RecoveryRecord latestCommittedRecord(File root) throws Exception {
        File[] records = root == null ? null : root.listFiles(File::isDirectory);
        if (records == null || records.length == 0) {
            throw new java.io.FileNotFoundException("No recovery record");
        }
        Arrays.sort(records, Comparator.comparingLong(File::lastModified).reversed());
        for (File dir : records) {
            File record = new File(dir, "record.bin");
            if (record.exists()) {
                return readRecord(record);
            }
        }
        throw new java.io.FileNotFoundException("No committed recovery record");
    }

    static final class RecoveryRecord {
        final String expectedRev;
        final byte[] preimage;
        final byte[] attempt;

        RecoveryRecord(String expectedRev, byte[] preimage, byte[] attempt) {
            this.expectedRev = expectedRev;
            this.preimage = preimage;
            this.attempt = attempt;
        }
    }

    private void ensureRoot() throws DocumentIo.DocumentIoException {
        if (root.exists() && !root.isDirectory()) {
            throw recoveryUnavailable("document write recovery path is not a directory");
        }
        if (!root.exists() && !root.mkdirs()) {
            throw recoveryUnavailable("cannot create document write recovery directory");
        }
    }

    private static void writeRecord(File file, String expectedRev, byte[] preimage, byte[] attempt)
            throws Exception {
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream out = null;
        try {
            out = atomic.startWrite();
            DataOutputStream data = new DataOutputStream(out);
            data.writeInt(MAGIC);
            data.writeInt(VERSION);
            data.writeUTF(expectedRev);
            data.writeInt(preimage.length);
            data.write(preimage);
            data.writeInt(attempt.length);
            data.write(attempt);
            data.flush();
            out.getFD().sync();
            atomic.finishWrite(out);
            RecoveryRecord committed = readRecord(file);
            if (!expectedRev.equals(committed.expectedRev)
                    || !Arrays.equals(preimage, committed.preimage)
                    || !Arrays.equals(attempt, committed.attempt)) {
                throw recoveryUnavailable("document write recovery record was not committed");
            }
        } catch (Exception e) {
            if (out != null) {
                atomic.failWrite(out);
            }
            throw e;
        }
    }

    private static long checkedSize(byte[] data) throws DocumentIo.DocumentIoException {
        if (data == null) {
            throw recoveryUnavailable("document write recovery data missing");
        }
        return data.length;
    }

    private static DocumentIo.DocumentIoException recoveryUnavailable(String message) {
        return new DocumentIo.DocumentIoException("RECOVERY_UNAVAILABLE", message);
    }

    private static long directorySize(File file) {
        if (file == null || !file.exists()) {
            return 0L;
        }
        if (file.isFile()) {
            return file.length();
        }
        long total = 0L;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                total += directorySize(child);
            }
        }
        return total;
    }

    private static RecoveryRecord readRecord(File file) throws Exception {
        try (DataInputStream in = new DataInputStream(new FileInputStream(file))) {
            if (in.readInt() != MAGIC || in.readInt() != VERSION) {
                throw new java.io.IOException("Invalid recovery record");
            }
            String expectedRev = in.readUTF();
            byte[] preimage = readBytes(in);
            byte[] attempt = readBytes(in);
            if (in.available() != 0) {
                throw new java.io.IOException("Invalid recovery record trailing data");
            }
            return new RecoveryRecord(expectedRev, preimage, attempt);
        }
    }

    private static byte[] readBytes(DataInputStream in) throws Exception {
        int length = in.readInt();
        if (length < 0 || length > MAX_RECORD_BYTES) {
            throw new java.io.IOException("Invalid recovery record length");
        }
        byte[] bytes = new byte[length];
        in.readFully(bytes);
        return bytes;
    }

    private static String keyFor(Uri uri) throws DocumentIo.DocumentIoException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(uri.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : digest) {
                out.append(String.format("%02x", b));
            }
            return out.toString();
        } catch (Exception e) {
            throw recoveryUnavailable("cannot identify document write recovery record");
        }
    }
}
