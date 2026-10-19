package com.mickdewald.keeweb;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import android.content.Context;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DocumentIoTest {
    private DocumentIo io;
    private File file;
    private Uri uri;
    private File recoveryDir;

    @Before
    public void setUp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        file = new File(context.getCacheDir(), "doc-io-test.kdbx");
        recoveryDir = new File(context.getCacheDir(), "document-write-recovery-test");
        deleteRecursively(recoveryDir);
        recoveryDir.mkdirs();
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes("original content"));
        }
        uri = Uri.fromFile(file);
        io = new DocumentIo(context.getContentResolver(), recoveryDir);
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private void expectCode(String code, ThrowingRunnable r) throws Exception {
        try {
            r.run();
            fail("expected " + code);
        } catch (DocumentIo.DocumentIoException e) {
            assertEquals(code, e.code);
        }
    }

    interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static void deleteRecursively(File f) {
        if (f == null || !f.exists()) {
            return;
        }
        File[] children = f.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        f.delete();
    }

    @Test
    public void writesANewEmptyDocumentAndLeavesTheOriginalUntouched() throws Exception {
        File exported = new File(file.getParentFile(), "doc-io-export.kdbx");
        exported.delete();
        assertEquals(true, exported.createNewFile());
        String newRev = io.writeNew(Uri.fromFile(exported), bytes("new"));
        assertArrayEquals(bytes("new"), io.read(Uri.fromFile(exported)));
        assertArrayEquals(bytes("original content"), io.read(uri));
        assertEquals(DocumentIo.sha256(bytes("new")), newRev);
    }

    @Test
    public void writesInPlaceWhenExpectedRevisionStillMatchesAndVerifiesTruncation() throws Exception {
        String originalRev = DocumentIo.sha256(bytes("original content"));
        String newRev = io.write(uri, bytes("new"), originalRev);

        assertArrayEquals(bytes("new"), io.read(uri));
        assertEquals(DocumentIo.sha256(bytes("new")), newRev);
        DocumentWriteRecoveryStore.RecoveryRecord record =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryDir);
        assertArrayEquals(bytes("original content"), record.preimage);
        assertArrayEquals(bytes("new"), record.attempt);
    }

    @Test
    public void verifiedSaveReplacesThePriorRecoveryPairForTheSameUri() throws Exception {
        io.write(uri, bytes("first"), DocumentIo.sha256(bytes("original content")));
        io.write(uri, bytes("second"), DocumentIo.sha256(bytes("first")));

        DocumentWriteRecoveryStore.RecoveryRecord record =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryDir);
        assertArrayEquals(bytes("first"), record.preimage);
        assertArrayEquals(bytes("second"), record.attempt);
        assertEquals(1, recoveryDir.listFiles(File::isDirectory).length);
    }

    @Test
    public void failedRecordReplacementKeepsThePreviousCommittedPairAndProviderBytes() throws Exception {
        io.write(uri, bytes("first"), DocumentIo.sha256(bytes("original content")));
        File recordDir = recoveryDir.listFiles(File::isDirectory)[0];
        assertEquals(true, new File(recordDir, "record.bin.new").mkdir());

        expectCode("RECOVERY_UNAVAILABLE", () -> io.write(
                uri, bytes("second"), DocumentIo.sha256(bytes("first"))));

        assertArrayEquals(bytes("first"), io.read(uri));
        DocumentWriteRecoveryStore.RecoveryRecord record =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryDir);
        assertArrayEquals(bytes("original content"), record.preimage);
        assertArrayEquals(bytes("first"), record.attempt);
    }

    @Test
    public void failedRecordRenameReadbackKeepsThePreviousCommittedPairAndProviderBytes() throws Exception {
        io.write(uri, bytes("first"), DocumentIo.sha256(bytes("original content")));
        File recordDir = recoveryDir.listFiles(File::isDirectory)[0];
        File nextRecord = new File(recordDir, "record.bin.new");
        try (FileOutputStream out = new FileOutputStream(nextRecord)) {
            out.write(bytes("stale"));
        }
        assertEquals(true, nextRecord.setWritable(true, false));
        assertEquals(true, recordDir.setWritable(false, false));
        try {
            expectCode("RECOVERY_UNAVAILABLE", () -> io.write(
                    uri, bytes("second"), DocumentIo.sha256(bytes("first"))));
        } finally {
            recordDir.setWritable(true, false);
            nextRecord.delete();
        }

        assertArrayEquals(bytes("first"), io.read(uri));
        DocumentWriteRecoveryStore.RecoveryRecord record =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryDir);
        assertArrayEquals(bytes("original content"), record.preimage);
        assertArrayEquals(bytes("first"), record.attempt);
    }

    @Test
    public void refusesToWriteANonemptyExportTarget() throws Exception {
        expectCode("EXPORT_EXISTING", () -> io.writeNew(uri, bytes("new")));
        assertArrayEquals(bytes("original content"), io.read(uri));
    }

    @Test
    public void reportsAMissingDocumentAsNotFound() throws Exception {
        file.delete();
        expectCode("NOT_FOUND", () -> io.read(uri));
        expectCode("REV_REQUIRED", () -> io.write(uri, bytes("new"), "any"));
    }

    @Test
    public void failsVerificationWhenTheReadBackDiffers() throws Exception {
        expectCode("IO", () -> DocumentIo.verifiedRev(bytes("written"), bytes("writ")));
        assertEquals(DocumentIo.sha256(bytes("same")), DocumentIo.verifiedRev(bytes("same"), bytes("same")));
    }

    @Test
    public void classifiesAMissingDocumentByWhetherTheGrantIsStillHeld() {
        // Drive offline and not cached: FileNotFoundException although the grant is held.
        java.io.FileNotFoundException fnf = new java.io.FileNotFoundException("offline");
        assertEquals("UNAVAILABLE", DocumentIo.errorCode(fnf, true));
        assertEquals("PERMISSION_LOST", DocumentIo.errorCode(fnf, false));
        DocumentIo.DocumentIoException missing = new DocumentIo.DocumentIoException("NOT_FOUND", "x");
        assertEquals("UNAVAILABLE", DocumentIo.errorCode(missing, true));
        assertEquals("PERMISSION_LOST", DocumentIo.errorCode(missing, false));
        assertEquals("PERMISSION_LOST", DocumentIo.errorCode(new SecurityException("revoked"), true));
        assertEquals("UNAVAILABLE", DocumentIo.errorCode(new java.io.IOException("timeout"), true));
        assertEquals("IO", DocumentIo.errorCode(new java.io.IOException("timeout"), false));
        assertEquals("IO", DocumentIo.errorCode(new IllegalStateException("bug"), true));
        for (String code : new String[] {"REV_REQUIRED", "REV_CONFLICT", "READ_ONLY",
                "RECOVERY_UNAVAILABLE", "EXPORT_EXISTING", "IO"}) {
            assertEquals(code, DocumentIo.errorCode(new DocumentIo.DocumentIoException(code, "x"), true));
        }
    }

    @Test
    public void requiresARealSha256ExpectedRevisionBeforeOpeningForWrite() throws Exception {
        expectCode("REV_REQUIRED", () -> io.write(uri, bytes("new"), null));
        expectCode("REV_REQUIRED", () -> io.write(uri, bytes("new"), ""));
        expectCode("REV_REQUIRED", () -> io.write(uri, bytes("new"), "not-a-sha"));

        assertArrayEquals(bytes("original content"), io.read(uri));
    }

    @Test
    public void revisionMismatchDoesNotOpenProviderForWriteOrChangeBytes() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("provider original"));
        seed.putBoolean("supportsWrite", true);
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);

        DocumentIo providerIo = new DocumentIo(resolver, recoveryDir, transientWrite(original));
        expectCode("REV_CONFLICT", () -> providerIo.write(
                original, bytes("new"), DocumentIo.sha256(bytes("other"))));

        assertArrayEquals(bytes("provider original"), providerIo.read(original));
        assertEquals(0, providerStats(resolver).getInt("writeOpenCount"));
    }

    @Test
    public void readOnlyDocumentDoesNotOpenForWriteAndLeavesBytesUnchanged() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("provider original"));
        seed.putBoolean("supportsWrite", false);
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);

        DocumentIo providerIo = new DocumentIo(resolver, recoveryDir, transientWrite(original));
        expectCode("READ_ONLY", () -> providerIo.write(
                original, bytes("new"), DocumentIo.sha256(bytes("provider original"))));

        assertArrayEquals(bytes("provider original"), providerIo.read(original));
        assertEquals(0, providerStats(resolver).getInt("writeOpenCount"));
    }

    @Test
    public void writeSupportedDocumentWithoutTrackedGrantIsReadOnly() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("provider original"));
        seed.putBoolean("supportsWrite", true);
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);

        DocumentIo providerIo = new DocumentIo(resolver, recoveryDir);
        assertEquals(false, providerIo.writable(original));
        expectCode("READ_ONLY", () -> providerIo.write(
                original, bytes("new"), DocumentIo.sha256(bytes("provider original"))));

        assertArrayEquals(bytes("provider original"), providerIo.read(original));
        assertEquals(0, providerStats(resolver).getInt("writeOpenCount"));
    }

    @Test
    public void trackedTransientWriteGrantAllowsProviderWrite() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("provider original"));
        seed.putBoolean("supportsWrite", true);
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);

        DocumentIo providerIo = new DocumentIo(resolver, recoveryDir, transientWrite(original));
        String rev = providerIo.write(
                original, bytes("provider new"), DocumentIo.sha256(bytes("provider original")));

        assertEquals(DocumentIo.sha256(bytes("provider new")), rev);
        assertArrayEquals(bytes("provider new"), providerIo.read(original));
        assertEquals(1, providerStats(resolver).getInt("writeOpenCount"));
    }

    @Test
    public void failedWriteVerificationKeepsPreimageAndAttemptForRecovery() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("provider original tail"));
        seed.putBoolean("supportsWrite", true);
        seed.putBoolean("ignoreTruncate", true);
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);

        DocumentIo providerIo = new DocumentIo(resolver, recoveryDir, transientWrite(original));
        expectCode("IO", () -> providerIo.write(
                original, bytes("short"), DocumentIo.sha256(bytes("provider original tail"))));

        DocumentWriteRecoveryStore.RecoveryRecord record =
                DocumentWriteRecoveryStore.latestCommittedRecord(recoveryDir);
        assertArrayEquals(bytes("provider original tail"), record.preimage);
        assertArrayEquals(bytes("short"), record.attempt);
    }

    @Test
    public void recoveryWriteFailurePreventsProviderWrite() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        Context targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ContentResolver resolver = context.getContentResolver();
        File blockedRecovery = new File(targetContext.getCacheDir(), "document-recovery-blocker");
        deleteRecursively(blockedRecovery);
        try (FileOutputStream out = new FileOutputStream(blockedRecovery)) {
            out.write(bytes("not a directory"));
        }
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("provider original"));
        seed.putBoolean("supportsWrite", true);
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);

        DocumentIo providerIo = new DocumentIo(resolver, blockedRecovery, transientWrite(original));
        expectCode("RECOVERY_UNAVAILABLE", () -> providerIo.write(
                original, bytes("new"), DocumentIo.sha256(bytes("provider original"))));

        assertArrayEquals(bytes("provider original"), providerIo.read(original));
        assertEquals(0, providerStats(resolver).getInt("writeOpenCount"));
    }

    @Test
    public void openDocumentPermissionMaskRequiresReadButPersistsGrantedWriteWhenPresent() {
        int persistable = android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;
        int read = android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION;
        int write = android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

        assertEquals(read, DocumentFilePlugin.persistableOpenDocumentGrant(read | persistable));
        assertEquals(read | write,
                DocumentFilePlugin.persistableOpenDocumentGrant(read | write | persistable));
        try {
            DocumentFilePlugin.persistableOpenDocumentGrant(write | persistable);
            fail("expected missing read grant");
        } catch (SecurityException e) {
            assertEquals("Picker did not grant required document read access", e.getMessage());
        }
    }

    @Test
    public void aKnownMissingDocumentNeedsReselectionEvenWhenItsGrantRemains() {
        DocumentIo.DocumentIoException missing = new DocumentIo.DocumentIoException("NOT_FOUND", "x");
        assertEquals("PERMISSION_LOST", DocumentIo.errorCode(missing, true, true));
        assertEquals("UNAVAILABLE", DocumentIo.errorCode(missing, true, false));
    }

    @Test
    public void aDocumentWithoutPersistedGrantCountsAsLost() throws Exception {
        file.delete();
        assertEquals(false, io.grantHeld(uri));
        try {
            io.read(uri);
            fail("expected NOT_FOUND");
        } catch (Exception e) {
            assertEquals("PERMISSION_LOST", DocumentIo.errorCode(e, io.grantHeld(uri)));
        }
    }

    @Test
    public void rejectsAProtectedDocumentReturnedThroughATreeAlias() {
        Uri document = DocumentsContract.buildDocumentUri("example.documents", "original");
        Uri tree = Uri.parse("content://example.documents/tree/root");
        Uri treeAlias = DocumentsContract.buildDocumentUriUsingTree(tree, "original");
        Set<DocumentFilePlugin.DocumentIdentity> protectedUris = new HashSet<>();
        protectedUris.add(DocumentFilePlugin.DocumentIdentity.from(document));

        assertEquals(true, DocumentFilePlugin.isProtectedExportUri(treeAlias, protectedUris));
    }

    @Test
    public void createsExportsUnderTheSelectedTreeDocument() {
        Uri tree = Uri.parse("content://example.documents/tree/primary%3AExports");
        Uri parent = DocumentFilePlugin.exportParentUri(tree);

        assertEquals("example.documents", parent.getAuthority());
        assertEquals("primary:Exports", DocumentsContract.getDocumentId(parent));
        assertEquals("content://example.documents/tree/primary%3AExports/document/primary%3AExports",
                parent.toString());
    }

    @Test
    public void acceptsPortableExportExtensionsAndRejectsUnsafeOnes() {
        assertEquals("xml", DocumentFilePlugin.exportExtension("XML"));
        assertEquals("attachment12", DocumentFilePlugin.exportExtension("attachment12"));
        assertEquals(null, DocumentFilePlugin.exportExtension("tar.gz"));
        assertEquals(null, DocumentFilePlugin.exportExtension("longextension13"));
    }

    @Test
    public void providerCreatesANewDocumentWithoutTouchingTheOriginal() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("original content"));
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);
        Uri tree = Uri.parse("content://" + TestDocumentsProvider.AUTHORITY + "/tree/"
                + TestDocumentsProvider.ROOT_ID);
        Uri created = DocumentsContract.createDocument(resolver,
                DocumentFilePlugin.exportParentUri(tree), "application/octet-stream", "export.kdbx");

        assertEquals("export.kdbx", DocumentsContract.getDocumentId(created));
        DocumentIo providerIo = new DocumentIo(resolver);
        providerIo.writeNew(created, bytes("new content"));
        assertArrayEquals(bytes("new content"), providerIo.read(created));
        assertArrayEquals(bytes("original content"), providerIo.read(original));
    }

    @Test
    public void providerRefusesAnExistingExportNameWithoutTouchingTheOriginal() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getContext();
        ContentResolver resolver = context.getContentResolver();
        Bundle seed = new Bundle();
        seed.putByteArray("data", bytes("original content"));
        Uri original = resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_RESET,
                null, seed).getParcelable(TestDocumentsProvider.EXTRA_URI);
        Uri tree = Uri.parse("content://" + TestDocumentsProvider.AUTHORITY + "/tree/"
                + TestDocumentsProvider.ROOT_ID);

        Uri created = DocumentsContract.createDocument(resolver,
                DocumentFilePlugin.exportParentUri(tree), "application/octet-stream", "original.kdbx");

        assertEquals(null, created);
        assertArrayEquals(bytes("original content"), new DocumentIo(resolver).read(original));
    }

    private static Bundle providerStats(ContentResolver resolver) {
        return resolver.call(TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.METHOD_STATS, null, null);
    }

    private static Set<String> transientWrite(Uri uri) {
        return Collections.singleton(uri.toString());
    }
}
