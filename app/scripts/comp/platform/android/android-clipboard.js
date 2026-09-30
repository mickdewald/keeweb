import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Logger } from 'util/logger';

const logger = new Logger('android-clipboard');

const AndroidClipboard = {
    copy(text, seconds, plugin = AndroidPlatform.plugin('SecureClipboard')) {
        plugin
            .copy({ text, clearAfterSeconds: seconds > 0 ? seconds : 0 })
            .catch((e) => logger.error('Native copy failed', e));
        return { success: true, seconds };
    }
};

export { AndroidClipboard };
