import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidDefaults } from 'comp/platform/android/android-defaults';

const AndroidInit = {
    started: false,

    start(appModel) {
        if (!AndroidPlatform.isAndroid || this.started) {
            return;
        }
        this.started = true;
        this.appModel = appModel;
        AndroidDefaults.apply();
    }
};

export { AndroidInit };
