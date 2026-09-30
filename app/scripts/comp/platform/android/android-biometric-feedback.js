import { AndroidPlatform } from 'comp/platform/android/android-platform';

// Biometric errors after which the open view simply falls back to the password field.
const SOFT_CODES = new Set(['USER_CANCELED', 'LOCKOUT', 'NO_BIOMETRICS', 'UNAVAILABLE']);

const AndroidBiometricFeedback = {
    isSoftError(err) {
        return !!err && SOFT_CODES.has(err.code);
    },

    // Called after the password field got focus: opens the keyboard and, unless the user
    // simply canceled, shows the system's message in the open view's message area.
    async show(viewEl, err, keyboard) {
        if (err.code !== 'USER_CANCELED' && err.message) {
            const box = viewEl.querySelector('.open__message');
            if (box) {
                box.querySelector('.open__message-content').textContent = err.message;
                box.classList.remove('hide');
                box.querySelector('.open__message-cancel-btn').addEventListener(
                    'click',
                    () => box.classList.add('hide'),
                    { once: true }
                );
            }
        }
        await this.showKeyboard(keyboard);
    },

    // Spec §5: with no biometric password to offer, a selected file goes straight to the
    // password field with the keyboard open.
    shouldFocusPassword({
        isAndroid = AndroidPlatform.isAndroid,
        hasFile,
        canUseEncryptedPassword
    }) {
        return !!(isAndroid && hasFile && !canUseEncryptedPassword);
    },

    async showKeyboard(keyboard) {
        try {
            await (keyboard || AndroidPlatform.plugin('Keyboard')).show();
        } catch {
            // The password field is focused anyway; the user can tap it.
        }
    }
};

export { AndroidBiometricFeedback };
