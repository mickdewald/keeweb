import * as kdbxweb from 'kdbxweb';
import { Events } from 'framework/events';
import { CopyPaste } from 'comp/browser/copy-paste';
import { OtpQrReader } from 'comp/format/otp-qr-reader';
import { Timeouts } from 'const/timeouts';
import { AppSettingsModel } from 'models/app-settings-model';
import { Locale } from 'util/locale';
import { Tip } from 'util/ui/tip';
import { DetailsAutoTypeView } from 'views/details/details-auto-type-view';
import { FieldViewCustom } from 'views/fields/field-view-custom';
import { Launcher } from 'comp/launcher';

const DetailsViewCopyAutoType = {
    copyKeyPress(editView) {
        if (!editView || this.isHidden()) {
            return false;
        }
        if (!window.getSelection().toString()) {
            const fieldText = editView.getTextValue();
            if (!fieldText) {
                return;
            }
            if (!CopyPaste.simpleCopy) {
                CopyPaste.createHiddenInput(fieldText);
            }
            const copyRes = CopyPaste.copy(fieldText);
            this.copyFieldValue({ source: editView, copyRes });

            return true;
        }
        return false;
    },

    copyPasswordFromShortcut(e) {
        if (!this.model) {
            return;
        }
        if (this.model.backend === 'otp-device') {
            this.copyOtp();
            e.preventDefault();
        }
        const copied = this.copyKeyPress(this.getFieldView('$Password'));
        if (copied) {
            e.preventDefault();
        }
    },

    copyPassword() {
        this.copyKeyPress(this.getFieldView('$Password'));
    },

    copyUserName() {
        this.copyKeyPress(this.getFieldView('$UserName'));
    },

    copyUrl() {
        this.copyKeyPress(this.getFieldView('$URL'));
    },

    copyOtp() {
        const otpField = this.getFieldView('$otp');
        if (this.model.backend === 'otp-device') {
            if (!otpField) {
                return false;
            }
            otpField.copyValue();
            return true;
        }
        this.copyKeyPress(otpField);
    },

    showCopyTip() {
        if (this.helpTipCopyShown) {
            return;
        }
        this.helpTipCopyShown = AppSettingsModel.helpTipCopyShown;
        if (this.helpTipCopyShown) {
            return;
        }
        AppSettingsModel.helpTipCopyShown = true;
        this.helpTipCopyShown = true;
        const label = this.moreView.labelEl;
        const tip = new Tip(label, { title: Locale.detCopyHint, placement: 'right' });
        tip.show();
        this.fieldCopyTip = tip;
        setTimeout(() => {
            tip.hide();
        }, Timeouts.AutoHideHint);
    },

    setupOtp() {
        OtpQrReader.read();
    },

    otpCodeRead(otp) {
        this.model.setOtp(otp);
        this.entryUpdated();
    },

    otpEnterManually() {
        if (this.model.fields.otp) {
            const otpField = this.fieldViews.find((f) => f.model.name === '$otp');
            if (otpField) {
                otpField.edit();
            }
        } else {
            this.moreView.remove();
            this.moreView = null;
            const fieldView = new FieldViewCustom(
                {
                    name: '$otp',
                    title: 'otp',
                    newField: 'otp',
                    value: kdbxweb.ProtectedValue.fromString('')
                },
                {
                    parent: this.$el.find('.details__body-fields')[0]
                }
            );
            fieldView.on('change', this.fieldChanged.bind(this));
            fieldView.render();
            this.fieldViews.push(fieldView);
            this.scheduleSyncDetailsLabelWidth();
            fieldView.edit();
        }
    },

    toggleAutoType() {
        if (this.views.autoType) {
            this.views.autoType.remove();
            delete this.views.autoType;
            return;
        }
        this.views.autoType = new DetailsAutoTypeView(this.model);
        this.views.autoType.render();
    },

    autoType(sequence) {
        const entry = this.model;
        const hasOtp =
            sequence?.includes('{TOTP}') || (entry.backend === 'otp-device' && !sequence);
        if (hasOtp) {
            const otpField = this.getFieldView('$otp');
            otpField.refreshOtp((err) => {
                if (!err) {
                    Events.emit('auto-type', {
                        entry,
                        sequence,
                        context: { resolved: { totp: otpField.otpValue } }
                    });
                }
            });
        } else {
            Events.emit('auto-type', { entry, sequence });
        }
    },

    copyFieldValue(e) {
        this.fieldCopied(e);
        if (AppSettingsModel.minimizeOnFieldCopy) {
            Launcher.minimizeApp();
        }
    }
};

export { DetailsViewCopyAutoType };
