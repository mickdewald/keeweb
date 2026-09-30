package com.mickdewald.keeweb;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import android.content.Context;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DocumentIoTest {
    private DocumentIo io;
    private File file;
    private Uri uri;

    @Before
    public void setUp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        io = new DocumentIo(context.getContentResolver());
        file = new File(context.getCacheDir(), "doc-io-test.kdbx");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes("original content"));
        }
        uri = Uri.fromFile(file);
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

    @Test
    public void writesWhenTheRevisionMatchesAndReturnsTheVerifiedHash() throws Exception {
        String rev = DocumentIo.sha256(io.read(uri));
        String newRev = io.write(uri, bytes("new"), rev);
        assertArrayEquals(bytes("new"), io.read(uri));
        assertEquals(DocumentIo.sha256(bytes("new")), newRev);
    }

    @Test
    public void refusesAStaleRevisionAndLeavesTheFileUntouched() throws Exception {
        expectCode("REV_CONFLICT", () -> io.write(uri, bytes("new"), "deadbeef"));
        assertArrayEquals(bytes("original content"), io.read(uri));
    }

    @Test
    public void refusesAWriteWithoutRevision() throws Exception {
        expectCode("REV_REQUIRED", () -> io.write(uri, bytes("new"), null));
        assertArrayEquals(bytes("original content"), io.read(uri));
    }

    @Test
    public void reportsAMissingDocumentAsNotFound() throws Exception {
        file.delete();
        expectCode("NOT_FOUND", () -> io.read(uri));
        expectCode("NOT_FOUND", () -> io.write(uri, bytes("new"), "any"));
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
        for (String code : new String[] {"REV_CONFLICT", "REV_REQUIRED", "IO"}) {
            assertEquals(code, DocumentIo.errorCode(new DocumentIo.DocumentIoException(code, "x"), true));
        }
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
}
