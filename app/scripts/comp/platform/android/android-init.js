import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidDefaults } from 'comp/platform/android/android-defaults';
import { AndroidLifecycle } from 'comp/platform/android/android-lifecycle';

const AndroidInit = {
    started: false,

    start(appModel) {
        if (!AndroidPlatform.isAndroid || this.started) {
            return;
        }
        this.started = true;
        this.appModel = appModel;
        AndroidDefaults.apply();
        AndroidLifecycle.start(appModel, AndroidPlatform.plugin('App'));
    }
};

export { AndroidInit };
