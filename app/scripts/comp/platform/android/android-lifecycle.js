// app/scripts/comp/platform/android/android-lifecycle.js
import { Events } from 'framework/events';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Alerts } from 'comp/ui/alerts';
import {
    decideBackAction,
    readBackState,
    performBackAction
} from 'comp/platform/android/android-back-navigation';

const AndroidLifecycle = {
    start(appModel, app, platform = AndroidPlatform) {
        app.addListener('backButton', () => {
            performBackAction(decideBackAction(readBackState()), { app });
        });
        app.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                Events.emit('android-resumed');
                // Picks up changes another device made while the app was in the background.
                appModel.files
                    .filter((f) => f.storage === 'androiddoc' && !f.syncing)
                    .forEach((f) => appModel.syncFile(f));
            } else if (!platform.nativeFlowPending) {
                // Maps "app went to the background" onto the existing lockOnMinimize setting.
                // A picker the app opened itself pauses the activity too; that must not lock.
                // An open alert would make lockWorkspace() skip the lock; dismiss it first.
                Alerts.closeAll();
                Events.emit('app-minimized');
            }
        });
    }
};

export { AndroidLifecycle };
