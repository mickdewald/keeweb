// app/scripts/comp/platform/android/android-lifecycle.js
import { Events } from 'framework/events';
import {
    decideBackAction,
    readBackState,
    performBackAction
} from 'comp/platform/android/android-back-navigation';

const AndroidLifecycle = {
    start(appModel, app) {
        app.addListener('backButton', () => {
            performBackAction(decideBackAction(readBackState()), { app });
        });
        app.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                Events.emit('android-resumed');
            } else {
                // Maps "app went to the background" onto the existing lockOnMinimize setting.
                Events.emit('app-minimized');
            }
        });
    }
};

export { AndroidLifecycle };
