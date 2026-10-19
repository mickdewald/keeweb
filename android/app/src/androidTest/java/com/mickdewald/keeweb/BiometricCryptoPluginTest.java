package com.mickdewald.keeweb;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import androidx.biometric.BiometricPrompt;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BiometricCryptoPluginTest {
    @Test
    public void keepsTheOldSharedCallbackUntilItsCancellationDispatchUnwinds() {
        FakeScheduler scheduler = new FakeScheduler();
        BiometricPromptHandoff handoff = new BiometricPromptHandoff(scheduler);
        int[] starts = {0};

        handoff.started();
        handoff.queueReplacement(() -> starts[0]++, () -> {});
        // The old AndroidX callback dispatches terminal while still registered.
        handoff.terminal();
        assertEquals(0, starts[0]);
        assertEquals(1, scheduler.posted.size());

        scheduler.runPosted();
        assertEquals(1, starts[0]);
    }

    @Test
    public void cancellationTimeoutRejectsQueuedPromptWithoutPostingReplacement() {
        FakeScheduler scheduler = new FakeScheduler();
        BiometricPromptHandoff handoff = new BiometricPromptHandoff(scheduler);
        int[] rejected = {0};

        handoff.started();
        handoff.queueReplacement(() -> assertTrue(false), () -> rejected[0]++);
        handoff.awaitCancellation(1_000);
        scheduler.runDelayed();
        assertTrue(handoff.cancellationTimedOut());
        assertEquals(1, rejected[0]);
        handoff.terminal();
        assertEquals(0, scheduler.posted.size());
    }

    @Test
    public void newestQueuedReplacementSupersedesEarlierOne() {
        FakeScheduler scheduler = new FakeScheduler();
        BiometricPromptHandoff handoff = new BiometricPromptHandoff(scheduler);
        int[] firstRejected = {0};
        int[] secondStarts = {0};

        handoff.started();
        handoff.queueReplacement(() -> assertTrue(false), () -> firstRejected[0]++);
        handoff.queueReplacement(() -> secondStarts[0]++, () -> {});
        assertEquals(1, firstRejected[0]);
        handoff.terminal();
        scheduler.runPosted();
        assertEquals(1, secondStarts[0]);
    }

    @Test
    public void supersedesThePostedReplacementBeforeItConstructsAPrompt() {
        FakeScheduler scheduler = new FakeScheduler();
        BiometricPromptHandoff handoff = new BiometricPromptHandoff(scheduler);
        int[] secondStarts = {0};
        int[] thirdStarts = {0};

        handoff.started();
        handoff.queueReplacement(() -> secondStarts[0]++, () -> {});
        handoff.terminal();
        handoff.queueReplacement(() -> thirdStarts[0]++, () -> {});
        scheduler.runPosted();

        assertEquals(0, secondStarts[0]);
        assertEquals(1, thirdStarts[0]);
    }

    private static final class FakeScheduler implements BiometricPromptHandoff.Scheduler {
        final List<Runnable> posted = new ArrayList<>();
        final List<Runnable> delayed = new ArrayList<>();

        @Override
        public void post(Runnable runnable) {
            posted.add(runnable);
        }

        @Override
        public void postDelayed(Runnable runnable, long delayMillis) {
            delayed.add(runnable);
        }

        @Override
        public void cancel(Runnable runnable) {
            delayed.remove(runnable);
        }

        void runPosted() {
            List<Runnable> actions = new ArrayList<>(posted);
            posted.clear();
            for (Runnable action : actions) {
                action.run();
            }
        }

        void runDelayed() {
            List<Runnable> actions = new ArrayList<>(delayed);
            delayed.clear();
            for (Runnable action : actions) {
                action.run();
            }
        }
    }

    @Test
    public void mapsPromptErrorsToWebAppCodes() {
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_USER_CANCELED));
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_NEGATIVE_BUTTON));
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_CANCELED));
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_TIMEOUT));
        assertEquals("LOCKOUT", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_LOCKOUT));
        assertEquals("LOCKOUT", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_LOCKOUT_PERMANENT));
        assertEquals("NO_BIOMETRICS", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_NO_BIOMETRICS));
        assertEquals("UNAVAILABLE", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_HW_UNAVAILABLE));
        assertEquals("UNAVAILABLE", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_HW_NOT_PRESENT));
        assertEquals("FAILED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_VENDOR));
    }
}
