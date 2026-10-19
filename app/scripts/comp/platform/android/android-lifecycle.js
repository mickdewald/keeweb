// app/scripts/comp/platform/android/android-lifecycle.js
import { Events } from 'framework/events';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Alerts } from 'comp/ui/alerts';
import { beginBackgroundLock } from 'models/background-lock-state';
import { AndroidLockScreen } from 'comp/platform/android/android-lock-screen';
import {
    decideBackAction,
    readBackState,
    performBackAction
} from 'comp/platform/android/android-back-navigation';

const AndroidLifecycle = {
    start(appModel, app, platform = AndroidPlatform) {
        let backgroundTransitionActive = false;

        const startBackgroundLock = () => {
            if (backgroundTransitionActive) {
                return;
            }
            backgroundTransitionActive = true;
            // Invalidate pending authentication before any asynchronous file work,
            // including when no database is open or an app-owned picker is showing.
            const lockGeneration = beginBackgroundLock(appModel);
            // An open alert would make lockWorkspace() skip the lock; dismiss it first.
            Alerts.closeAll();
            // Android needs to lock even when the user disabled routine auto-save:
            // syncFile persists encrypted bytes to the cache before remote storage.
            Events.emit('app-minimized', { forceSave: true, lockGeneration });
        };

        const resume = () => {
            backgroundTransitionActive = false;
            Events.emit('android-resumed');
            if (appModel.backgroundLockActive) {
                return;
            }
            // Picks up changes another device made while the app was in the background.
            appModel.files
                .filter(
                    (f) =>
                        f.storage === 'androiddoc' &&
                        !f.syncing &&
                        !f.lockCacheInProgress &&
                        !f.pendingMutations
                )
                .forEach((f) => appModel.syncFile(f));
        };

        if (platform.isAndroid) {
            AndroidLockScreen.start(appModel);
        }
        app.addListener('backButton', () => {
            performBackAction(decideBackAction(readBackState()), { app });
        });
        // Capacitor emits this from Android Activity.onPause, before appStateChange(false)
        // from Activity.onStop. The latter remains as a fallback for older bridges.
        app.addListener('pause', startBackgroundLock);
        app.addListener('resume', () => {
            // Android emits appStateChange(true) before resume, so preserve its existing
            // foreground sync and authentication behavior without emitting it twice.
            backgroundTransitionActive = false;
        });
        app.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                resume();
            } else {
                startBackgroundLock();
            }
        });
    }
};

export { AndroidLifecycle };
