package com.mickdewald.keeweb;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import androidx.lifecycle.Lifecycle;
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

    // Sends the app behind the launcher so clipboard reads return null, like in real use.
    private void goHome() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context().startActivity(home);
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        sleep(1500);
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Test
    public void clearsWhileTheAppIsInTheBackground() {
        onMain(() -> SecureClipboardPlugin.copySensitive(context(), "fake-secret"));
        scenario.moveToState(Lifecycle.State.CREATED);
        goHome();
        onMain(() -> SecureClipboardPlugin.clearIfUnchanged(context(), "fake-secret"));
        // Bring the app back to the foreground so the clipboard is readable again.
        context().startActivity(new Intent(context(), MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        sleep(1500);
        ClipData clip = cm().getPrimaryClip();
        assertTrue(clip == null || clip.getItemCount() == 0 || clip.getItemAt(0).getText() == null
                || !"fake-secret".contentEquals(clip.getItemAt(0).getText()));
    }
}
