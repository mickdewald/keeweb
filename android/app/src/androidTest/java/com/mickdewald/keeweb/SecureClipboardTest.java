package com.mickdewald.keeweb;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SecureClipboardTest {
    // Android 10+ only lets the foreground app read the clipboard, so keep an activity resumed.
    private ActivityScenario<MainActivity> scenario;

    @Before
    public void launchForeground() {
        scenario = ActivityScenario.launch(MainActivity.class);
    }

    @After
    public void closeForeground() {
        scenario.close();
    }

    private Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    private ClipboardManager cm() {
        return (ClipboardManager) context().getSystemService(Context.CLIPBOARD_SERVICE);
    }

    private void onMain(Runnable r) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(r);
    }

    @Test
    public void marksTheClipSensitive() {
        onMain(() -> SecureClipboardPlugin.copySensitive(context(), "fake-secret"));
        ClipDescription d = cm().getPrimaryClipDescription();
        assertTrue(d.getExtras().getBoolean(ClipDescription.EXTRA_IS_SENSITIVE));
    }

    @Test
    public void clearsItsOwnValue() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            SecureClipboardPlugin.clearIfUnchanged(context(), "fake-secret");
        });
        ClipData clip = cm().getPrimaryClip();
        assertTrue(clip == null || clip.getItemCount() == 0 || clip.getItemAt(0).getText() == null
                || clip.getItemAt(0).getText().length() == 0);
    }

    @Test
    public void keepsAValueCopiedElsewhere() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            cm().setPrimaryClip(ClipData.newPlainText("other", "copied-elsewhere"));
            SecureClipboardPlugin.clearIfUnchanged(context(), "fake-secret");
        });
        assertEquals("copied-elsewhere", cm().getPrimaryClip().getItemAt(0).getText().toString());
    }
}
