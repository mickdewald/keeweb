import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { Locale } from 'util/locale';

// The last Keyboard.show() call; hideKeyboard() waits for it.
let pendingShow = Promise.resolve();

// Biometric errors after which the open view simply falls back to the password field.
const SOFT_CODES = new Set(['USER_CANCELED', 'LOCKOUT', 'NO_BIOMETRICS', 'UNAVAILABLE']);

const AndroidBiometricFeedback = {
    isSoftError(err) {
        return !!err && SOFT_CODES.has(err.code);
    },

    // Called after the password field got focus: opens the keyboard and, unless the user
    // simply canceled, shows the system message separately from pending unlock status.
    async show(viewEl, err, keyboard) {
        if (err.code !== 'USER_CANCELED' && err.message) {
            let box = viewEl.querySelector('.open__biometric-message');
            if (!box) {
                box = document.createElement('div');
                box.className = 'open__message open__biometric-message hide';
                box.innerHTML =
                    '<div class="open__message-content"></div>' +
                    `<button class="open__biometric-message-cancel-btn" ` +
                    `type="button" title="${Locale.alertCancel}" ` +
                    `aria-label="${Locale.alertCancel}">` +
                    '<i class="fa fa-times-circle open__biometric-message-cancel-btn-icon" ' +
                    'aria-hidden="true"></i></button>';
                viewEl.appendChild(box);
                box.querySelector('.open__biometric-message-cancel-btn').addEventListener(
                    'click',
                    () => box.classList.add('hide')
                );
            }
            if (box) {
                box.querySelector('.open__message-content').textContent = err.message;
                box.classList.remove('hide');
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
