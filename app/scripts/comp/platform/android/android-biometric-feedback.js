import { AndroidPlatform } from 'comp/platform/android/android-platform';

// The last Keyboard.show() call; hideKeyboard() waits for it.
let pendingShow = Promise.resolve();

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

    showKeyboard(keyboard) {
        pendingShow = (async () => {
            try {
                await (keyboard || AndroidPlatform.plugin('Keyboard')).show();
            } catch {
                // The password field is focused anyway; the user can tap it.
            }
        })();
        return pendingShow;
    },

    // Waits for a pending show(): Capacitor shows the keyboard with a delay, so a hide()
    // issued meanwhile would be undone by it.
    async hideKeyboard(keyboard) {
        await pendingShow;
        try {
            await (keyboard || AndroidPlatform.plugin('Keyboard')).hide();
        } catch {
            // Nothing to hide.
        }
    }
};

export { AndroidBiometricFeedback };
