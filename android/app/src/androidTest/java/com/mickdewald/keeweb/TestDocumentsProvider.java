package com.mickdewald.keeweb;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import java.io.File;
import java.io.FileOutputStream;

/** A minimal test-only provider for exercising DocumentsContract.createDocument. */
public class TestDocumentsProvider extends ContentProvider {
    static final String AUTHORITY = "com.mickdewald.keeweb.test.documents";
    static final String ROOT_ID = "root";
    static final String ORIGINAL_ID = "original.kdbx";
    static final String METHOD_RESET = "reset";
    static final String METHOD_STATS = "stats";
    private static final String METHOD_CREATE_DOCUMENT = "android:createDocument";
    static final String EXTRA_URI = "uri";
    private File root;
    private boolean supportsWrite = true;
    private boolean ignoreTruncate;
    private int writeOpenCount;

    @Override
    public boolean onCreate() {
        root = new File(getContext().getCacheDir(), "test-documents-provider");
        root.mkdirs();
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        if (METHOD_RESET.equals(method)) {
            clearRoot();
            writeOpenCount = 0;
            supportsWrite = extras == null || extras.getBoolean("supportsWrite", true);
            ignoreTruncate = extras != null && extras.getBoolean("ignoreTruncate", false);
            File original = documentFile(ORIGINAL_ID);
            write(original, extras == null ? new byte[0] : extras.getByteArray("data"));
            return result(uriFor(ORIGINAL_ID));
        }
        if (METHOD_STATS.equals(method)) {
            Bundle result = new Bundle();
            result.putInt("writeOpenCount", writeOpenCount);
            return result;
        }
        if (!METHOD_CREATE_DOCUMENT.equals(method)) {
            return super.call(method, arg, extras);
        }
        Uri parent = extras == null ? null : extras.getParcelable(EXTRA_URI);
        if (parent == null) {
            return emptyResult();
        }
        if (!ROOT_ID.equals(DocumentsContract.getDocumentId(parent))) {
            return emptyResult();
        }
        String displayName = extras == null ? null
                : extras.getString(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
        if (displayName == null || displayName.contains("/") || documentFile(displayName).exists()) {
            return emptyResult();
        }
        try {
            if (!documentFile(displayName).createNewFile()) {
                return emptyResult();
            }
            return result(uriFor(displayName));
        } catch (Exception e) {
            return emptyResult();
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs,
            String sortOrder) {
        String id = DocumentsContract.getDocumentId(uri);
        if (!ROOT_ID.equals(id) && !documentFile(id).exists()) {
            return new MatrixCursor(columns(projection));
        }
        String[] columns = columns(projection);
        MatrixCursor cursor = new MatrixCursor(columns);
        MatrixCursor.RowBuilder row = cursor.newRow();
        for (String column : columns) {
            if (DocumentsContract.Document.COLUMN_FLAGS.equals(column)) {
                int flags = ROOT_ID.equals(id) ? DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE : 0;
                if (!ROOT_ID.equals(id) && supportsWrite) {
                    flags |= DocumentsContract.Document.FLAG_SUPPORTS_WRITE;
                }
                row.add(flags);
            } else if (DocumentsContract.Document.COLUMN_DISPLAY_NAME.equals(column)) {
                row.add(id);
            } else if (DocumentsContract.Document.COLUMN_DOCUMENT_ID.equals(column)) {
                row.add(id);
            } else {
                row.add(null);
            }
        }
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        File file = documentFile(DocumentsContract.getDocumentId(uri));
        if (mode.contains("w")) {
            writeOpenCount++;
            if (!supportsWrite) {
                throw new java.io.FileNotFoundException("readonly");
            }
        }
        int flags = mode.contains("w")
                ? ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_CREATE
                        | (ignoreTruncate ? 0 : ParcelFileDescriptor.MODE_TRUNCATE)
                : ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(file, flags);
    }

    @Override
    public String getType(Uri uri) {
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    private Uri uriFor(String id) {
        return DocumentsContract.buildDocumentUri(AUTHORITY, id);
    }

    private Bundle result(Uri uri) {
        Bundle result = new Bundle();
        result.putParcelable(EXTRA_URI, uri);
        return result;
    }

    private Bundle emptyResult() {
        return new Bundle();
    }

    private String[] columns(String[] projection) {
        return projection == null
                ? new String[] {DocumentsContract.Document.COLUMN_DOCUMENT_ID}
                : projection;
    }

    private File documentFile(String id) {
        return new File(root, id);
    }

    private void clearRoot() {
        File[] files = root.listFiles();
        if (files != null) {
            for (File file : files) {
                file.delete();
            }
        }
    }

    private void write(File file, byte[] data) {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(data == null ? new byte[0] : data);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
