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
}
