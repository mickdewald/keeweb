package com.mickdewald.keeweb;

/** Serializes AndroidX's activity-scoped biometric callback handoff. */
final class BiometricPromptHandoff {
    interface Scheduler {
        void post(Runnable runnable);
        void postDelayed(Runnable runnable, long delayMillis);
        void cancel(Runnable runnable);
    }

    private final Scheduler scheduler;
    private boolean active;
    private boolean cancellationTimedOut;
    private Runnable queuedStart;
    private Runnable queuedReject;
    private Runnable cancellationTimeout;
    private boolean replacementPosted;

    BiometricPromptHandoff(Scheduler scheduler) {
        this.scheduler = scheduler;
    }

    void started() {
        active = true;
        cancellationTimedOut = false;
    }

    boolean isActive() {
        return active;
    }

    boolean hasQueuedReplacement() {
        return queuedStart != null;
    }

    boolean cancellationTimedOut() {
        return cancellationTimedOut;
    }

    void queueReplacement(Runnable start, Runnable reject) {
        rejectQueued();
        queuedStart = start;
        queuedReject = reject;
    }

    void awaitCancellation(long timeoutMillis) {
        if (cancellationTimeout != null) {
            return;
        }
        cancellationTimeout = () -> {
            if (!active) {
                return;
            }
            cancellationTimedOut = true;
            rejectQueued();
        };
        scheduler.postDelayed(cancellationTimeout, timeoutMillis);
    }

    void terminal() {
        if (!active) {
            return;
        }
        active = false;
        cancellationTimedOut = false;
        if (cancellationTimeout != null) {
            scheduler.cancel(cancellationTimeout);
            cancellationTimeout = null;
        }
        if (queuedStart != null && !replacementPosted) {
            replacementPosted = true;
            scheduler.post(this::startPostedReplacement);
        }
    }

    private void startPostedReplacement() {
        replacementPosted = false;
        Runnable start = queuedStart;
        queuedStart = null;
        queuedReject = null;
        if (start != null) {
            start.run();
        }
    }

    void rejectQueued() {
        if (queuedReject != null) {
            queuedReject.run();
        }
        queuedStart = null;
        queuedReject = null;
    }
}
