package com.mickdewald.keeweb;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Regression coverage for recovery records that outlive one DocumentIo instance. */
@RunWith(AndroidJUnit4.class)
public class DocumentRecoveryPersistenceTest {
    private static final long RECOVERY_QUOTA_BYTES = 512L * 1024L * 1024L;

    private ContentResolver resolver;
    private File recoveryRoot;

    @Before
    public void setUp() {
        Context instrumentationContext = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        resolver = instrumentationContext.getContentResolver();
        recoveryRoot = new File(targetContext.getCacheDir(),
                "document-recovery-persistence-" + System.nanoTime());
        assertTrue(recoveryRoot.mkdirs());
    }

    @After
    public void tearDown() {
        deleteRecursively(recoveryRoot);
    }

    @Test
    public void incompleteNextRecordDoesNotHideCommittedRecoveryAfterRestart() throws Exception {
        Uri uri = resetProvider(bytes("original"));
        DocumentIo firstInstance = documentIo(uri);
        firstInstance.write(uri, bytes("first"), DocumentIo.sha256(bytes("original")));

        File recordDir = onlyRecordDirectory();
        try (FileOutputStream out = new FileOutputStream(new File(recordDir, "record.bin.new"))) {
            // Models an interrupted next AtomicFile commit; it is not a process-kill simulation.
            out.write(bytes("incomplete next record"));
        }

        DocumentIo restartedInstance = documentIo(uri);
        DocumentWriteRecoveryStore.RecoveryRecord committed =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryRoot);
        assertArrayEquals(bytes("original"), committed.preimage);
        assertArrayEquals(bytes("first"), committed.attempt);

        String secondRev = restartedInstance.write(
                uri, bytes("second"), DocumentIo.sha256(bytes("first")));

        assertEquals(DocumentIo.sha256(bytes("second")), secondRev);
        assertArrayEquals(bytes("second"), restartedInstance.read(uri));
        DocumentWriteRecoveryStore.RecoveryRecord replacement =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryRoot);
        assertArrayEquals(bytes("first"), replacement.preimage);
        assertArrayEquals(bytes("second"), replacement.attempt);
    }

    @Test
    public void exhaustedRecoveryQuotaPreventsProviderWrite() throws Exception {
        Uri uri = resetProvider(bytes("provider original"));
        File quotaMarker = new File(recoveryRoot, "quota-marker.bin");
        try (RandomAccessFile file = new RandomAccessFile(quotaMarker, "rw")) {
            // Sparse marker: validates accounting without allocating 512 MiB of test data.
            file.setLength(RECOVERY_QUOTA_BYTES + 1L);
        }

        DocumentIo providerIo = documentIo(uri);
        expectCode("RECOVERY_UNAVAILABLE", () -> providerIo.write(
                uri, bytes("provider new"), DocumentIo.sha256(bytes("provider original"))));

        assertArrayEquals(bytes("provider original"), providerIo.read(uri));
        assertEquals(0, providerStats().getInt("writeOpenCount"));
    }

    private DocumentIo documentIo(Uri uri) {
        return new DocumentIo(resolver, recoveryRoot, Collections.singleton(uri.toString()));
    }

    private Uri resetProvider(byte[] original) {
        Bundle seed = new Bundle();
        seed.putByteArray("data", original);
        seed.putBoolean("supportsWrite", true);
        Bundle result = resolver.call(TestDocumentsProvider.AUTHORITY,
                TestDocumentsProvider.METHOD_RESET, null, seed);
        return result.getParcelable(TestDocumentsProvider.EXTRA_URI);
    }

    private File onlyRecordDirectory() {
        File[] directories = recoveryRoot.listFiles(File::isDirectory);
        assertEquals(1, directories == null ? 0 : directories.length);
        return directories[0];
    }

    private Bundle providerStats() {
        return resolver.call(TestDocumentsProvider.AUTHORITY,
                TestDocumentsProvider.METHOD_STATS, null, null);
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static void expectCode(String expected, ThrowingRunnable runnable) throws Exception {
        try {
            runnable.run();
            fail("expected " + expected);
        } catch (DocumentIo.DocumentIoException e) {
            assertEquals(expected, e.code);
        }
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        file.delete();
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
