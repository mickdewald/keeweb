import { Launcher } from 'comp/launcher';
import { AppSettingsModel } from 'models/app-settings-model';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidClipboard } from 'comp/platform/android/android-clipboard';

const CopyPaste = {
    simpleCopy: !!(Launcher && Launcher.clipboardSupported) || AndroidPlatform.isAndroid,

    async copy(text) {
        if (AndroidPlatform.isAndroid) {
            return AndroidClipboard.copy(text, AppSettingsModel.clipboardSeconds);
        }
        if (this.simpleCopy) {
            const clipboardSeconds = AppSettingsModel.clipboardSeconds;
            try {
                await Launcher.setClipboardText(text, clipboardSeconds);
            } catch (error) {
                return false;
            }
            return { success: true, seconds: clipboardSeconds };
        } else {
            try {
                if (document.execCommand('copy')) {
                    return { success: true };
                }
            } catch (e) {}
            return false;
        }
    },

    createHiddenInput(text) {
        const hiddenInput = $('<input/>')
            .val(text)
            .attr({ type: 'text', 'class': 'hide-by-pos' })
            .appendTo(document.body);
        hiddenInput[0].selectionStart = 0;
        hiddenInput[0].selectionEnd = text.length;
        hiddenInput.focus();
        hiddenInput.on({
            'copy cut paste'() {
                setTimeout(() => hiddenInput.blur(), 0);
            },
            blur() {
                hiddenInput.remove();
            }
        });
    },

    copyHtml(html) {
        const el = document.createElement('div');
        el.style.userSelect = 'auto';
        el.style.webkitUserSelect = 'auto';
        el.style.mozUserSelect = 'auto';
        el.innerHTML = html;
        document.body.appendChild(el);

        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const result = document.execCommand('copy');

        el.remove();
        return result;
    }
};

export { CopyPaste };
