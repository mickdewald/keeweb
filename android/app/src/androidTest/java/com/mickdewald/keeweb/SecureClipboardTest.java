package com.mickdewald.keeweb;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewTreeObserver;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
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
        waitForWindowFocus();
        onMain(() -> context().getSharedPreferences("secure-clipboard-clear-state", Context.MODE_PRIVATE)
                .edit().clear().commit());
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

    private ClipData primaryClip() {
        AtomicReference<ClipData> clip = new AtomicReference<>();
        onMain(() -> clip.set(cm().getPrimaryClip()));
        return clip.get();
    }

    private ClipDescription primaryClipDescription() {
        AtomicReference<ClipDescription> description = new AtomicReference<>();
        onMain(() -> description.set(cm().getPrimaryClipDescription()));
        return description.get();
    }

    private boolean primaryClipMatches(String text) {
        return clipMatches(primaryClip(), text);
    }

    private static boolean clipMatches(ClipData clip, String text) {
        if (clip == null || clip.getItemCount() == 0) {
            return false;
        }
        CharSequence value = clip.getItemAt(0).getText();
        return value != null && text.contentEquals(value);
    }

    private void waitUntilPrimaryClipNoLongerMatches(String text) {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            if (!primaryClipMatches(text)) {
                return;
            }
            sleep(50);
        }
        assertTrue("clipboard still contained KeeWeb secret after expiry", !primaryClipMatches(text));
    }

    private void waitForWindowFocus() {
        CountDownLatch focused = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            View decor = activity.getWindow().getDecorView();
            if (decor.hasWindowFocus()) {
                focused.countDown();
                return;
            }
            ViewTreeObserver.OnWindowFocusChangeListener listener =
                    new ViewTreeObserver.OnWindowFocusChangeListener() {
                        @Override
                        public void onWindowFocusChanged(boolean hasFocus) {
                            if (hasFocus) {
                                decor.getViewTreeObserver().removeOnWindowFocusChangeListener(this);
                                focused.countDown();
                            }
                        }
                    };
            decor.getViewTreeObserver().addOnWindowFocusChangeListener(listener);
        });
        try {
            assertTrue("MainActivity never received window focus", focused.await(5, TimeUnit.SECONDS));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while waiting for MainActivity focus", e);
        }
    }

    @Test
    public void marksTheClipSensitive() {
        onMain(() -> SecureClipboardPlugin.copySensitive(context(), "fake-secret"));
        ClipDescription d = primaryClipDescription();
        assertNotNull("focused KeeWeb activity must read its clipboard description", d);
        assertTrue(d.getExtras().getBoolean(ClipDescription.EXTRA_IS_SENSITIVE));
    }

    @Test
    public void clearsItsOwnValue() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            SecureClipboardPlugin.clearIfUnchanged(context(), "fake-secret");
        });
        ClipData clip = primaryClip();
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
        ClipData clip = primaryClip();
        assertNotNull("focused KeeWeb activity must read the replacement clip", clip);
        assertEquals("copied-elsewhere", clip.getItemAt(0).getText().toString());
    }

    @Test
    public void clearsAnExpiredClipAfterTheProcessReturnsToForeground() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            assertTrue(SecureClipboardPlugin.rememberExpiry(
                    context(), "fake-secret", System.currentTimeMillis() - 1));
            SecureClipboardPlugin.clearExpiredIfOwned(context());
        });
        ClipData clip = primaryClip();
        assertTrue(clip == null || clip.getItemCount() == 0 || clip.getItemAt(0).getText() == null
                || !"fake-secret".contentEquals(clip.getItemAt(0).getText()));
    }

    @Test
    public void preservesAClipUntilItsPersistedExpiryIsDue() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            assertTrue(SecureClipboardPlugin.rememberExpiry(
                    context(), "fake-secret", System.currentTimeMillis() + 60_000));
            SecureClipboardPlugin.clearExpiredIfOwned(context());
        });
        ClipData clip = primaryClip();
        assertNotNull("focused KeeWeb activity must retain the unexpired clip", clip);
        assertEquals("fake-secret", clip.getItemAt(0).getText().toString());
    }

    @Test
    public void rearmsThePersistedExpiryAfterRestart() {
        Handler restoredProcessHandler = new Handler(Looper.getMainLooper());
        long dueAt = System.currentTimeMillis() + 150;
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            assertTrue(SecureClipboardPlugin.rememberExpiry(context(), "fake-secret", dueAt));
            SecureClipboardPlugin.scheduleExpiryClear(context(), restoredProcessHandler, dueAt);
        });
        waitUntilPrimaryClipNoLongerMatches("fake-secret");
    }

    @Test
    public void earlyScheduledExpiryCheckRearmsUntilThePersistedExpiryIsDue() {
        Handler restoredProcessHandler = new Handler(Looper.getMainLooper());
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            long dueAt = System.currentTimeMillis() + 1_000;
            assertTrue(SecureClipboardPlugin.rememberExpiry(context(), "fake-secret", dueAt));
            SecureClipboardPlugin.clearExpiredIfDueOrReschedule(context(), restoredProcessHandler);
            assertTrue("early expiry check must not clear before due time",
                    clipMatches(cm().getPrimaryClip(), "fake-secret"));
        });
        waitUntilPrimaryClipNoLongerMatches("fake-secret");
    }

    @Test
    public void staleExpiryCallbackUsesTheLatestPersistedDeadline() {
        Handler restoredProcessHandler = new Handler(Looper.getMainLooper());
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "old-secret");
            assertTrue(SecureClipboardPlugin.rememberExpiry(
                    context(), "old-secret", System.currentTimeMillis() - 1));
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            long newDueAt = System.currentTimeMillis() + 1_000;
            assertTrue(SecureClipboardPlugin.rememberExpiry(context(), "fake-secret", newDueAt));
            SecureClipboardPlugin.clearExpiredIfDueOrReschedule(context(), restoredProcessHandler);
            assertTrue("stale expiry callback must not clear the newer copied value",
                    clipMatches(cm().getPrimaryClip(), "fake-secret"));
        });
        waitUntilPrimaryClipNoLongerMatches("fake-secret");
    }

    @Test
    public void doesNotClearAnotherAppsValueAfterAnExpiredProcessDeathRecord() {
        onMain(() -> {
            SecureClipboardPlugin.copySensitive(context(), "fake-secret");
            assertTrue(SecureClipboardPlugin.rememberExpiry(
                    context(), "fake-secret", System.currentTimeMillis() - 1));
            cm().setPrimaryClip(ClipData.newPlainText("other", "copied-elsewhere"));
            SecureClipboardPlugin.clearExpiredIfOwned(context());
        });
        ClipData clip = primaryClip();
        assertNotNull("focused KeeWeb activity must retain the other app's clip", clip);
        assertEquals("copied-elsewhere", clip.getItemAt(0).getText().toString());
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
        waitForWindowFocus();
        ClipData clip = primaryClip();
        assertTrue(clip == null || clip.getItemCount() == 0 || clip.getItemAt(0).getText() == null
                || !"fake-secret".contentEquals(clip.getItemAt(0).getText()));
    }
}
