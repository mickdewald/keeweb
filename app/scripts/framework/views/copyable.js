import { Events } from 'framework/events';
import { AppSettingsModel } from 'models/app-settings-model';
import { Locale } from 'util/locale';
import { Tip } from 'util/ui/tip';
import { Timeouts } from 'const/timeouts';

const Copyable = {
    hideFieldCopyTip() {
        if (this.fieldCopyTip) {
            this.fieldCopyTip.hide();
            this.fieldCopyTip = null;
        }
    },

    fieldCopied(e) {
        this.showFieldCopyTip(
            e,
            e.copyRes.seconds
                ? Locale.detFieldCopiedTime.replace('{}', e.copyRes.seconds)
                : Locale.detFieldCopied
        );
        setTimeout(() => {
            if (e.source.model.name === '$Password' && AppSettingsModel.lockOnCopy) {
                setTimeout(() => {
                    Events.emit('lock-workspace');
                }, Timeouts.BeforeAutoLock);
            }
        }, Timeouts.CopyTip);
    },

    fieldCopyFailed(e) {
        this.showFieldCopyTip(e, Locale.detFieldCopyFailed);
    },

    showFieldCopyTip(e, msg) {
        this.hideFieldCopyTip();
        const copyAnchor = e.copyAnchorEl || e.source?.copyAnchorEl;
        const anchorEl = copyAnchor || e.source?.labelEl?.[0];
        if (!anchorEl || !anchorEl.isConnected || e.source?.removed) {
            return;
        }
        let tip;
        if (!this.isHidden()) {
            tip = Tip.createTip(anchorEl, {
                title: msg,
                placement: copyAnchor ? 'left' : 'right',
                fast: true,
                force: true,
                noInit: true
            });
            this.fieldCopyTip = tip;
            tip.show();
        }
        setTimeout(() => {
            if (tip) {
                tip.hide();
            }
            if (this.fieldCopyTip === tip) {
                this.fieldCopyTip = null;
            }
        }, Timeouts.CopyTip);
    }
};

export { Copyable };
