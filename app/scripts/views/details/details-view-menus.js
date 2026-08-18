import { Events } from 'framework/events';
import { AutoType } from 'auto-type';
import { AppSettingsModel } from 'models/app-settings-model';
import { Locale } from 'util/locale';
import { DropdownView } from 'views/dropdown-view';

const DetailsViewMenus = {
    toggleMoreOptions() {
        if (this.views.dropdownView) {
            this.views.dropdownView.remove();
            this.views.dropdownView = null;
        } else {
            setTimeout(() => {
                const dropdownView = new DropdownView();
                this.listenTo(dropdownView, 'cancel', this.toggleMoreOptions);
                this.listenTo(dropdownView, 'select', this.moreOptionsSelect);
                const hideEmptyFields = AppSettingsModel.hideEmptyFields;
                const moreOptions = [];
                if (hideEmptyFields) {
                    this.fieldViews.forEach((fieldView) => {
                        if (fieldView.isHidden()) {
                            moreOptions.push({
                                value: 'add:' + fieldView.model.name,
                                icon: 'pencil-alt',
                                text: Locale.detMenuAddField.replace('{}', fieldView.model.title)
                            });
                        }
                    }, this);
                    moreOptions.push({
                        value: 'add-new',
                        icon: 'plus',
                        text: Locale.detMenuAddNewField
                    });
                    if (this.model.url) {
                        moreOptions.push({
                            value: 'add-website',
                            icon: 'plus',
                            text: Locale.detMenuAddNewWebsite
                        });
                    }
                    moreOptions.push({
                        value: 'toggle-empty',
                        icon: 'eye',
                        text: Locale.detMenuShowEmpty
                    });
                } else {
                    moreOptions.push({
                        value: 'add-new',
                        icon: 'plus',
                        text: Locale.detMenuAddNewField
                    });
                    if (this.model.url) {
                        moreOptions.push({
                            value: 'add-website',
                            icon: 'plus',
                            text: Locale.detMenuAddNewWebsite
                        });
                    }
                    moreOptions.push({
                        value: 'toggle-empty',
                        icon: 'eye-slash',
                        text: Locale.detMenuHideEmpty
                    });
                }
                moreOptions.push({ value: 'otp', icon: 'clock', text: Locale.detSetupOtp });
                if (AutoType.enabled) {
                    moreOptions.push({
                        value: 'auto-type',
                        icon: 'keyboard',
                        text: Locale.detAutoTypeSettings
                    });
                }
                moreOptions.push({ value: 'clone', icon: 'clone', text: Locale.detClone });
                moreOptions.push({
                    value: 'copy-to-clipboard',
                    icon: 'copy',
                    text: Locale.detCopyEntryToClipboard
                });
                const rect = this.moreView.labelEl[0].getBoundingClientRect();
                dropdownView.render({
                    position: { top: rect.bottom, left: rect.left },
                    options: moreOptions
                });
                this.views.dropdownView = dropdownView;
            });
        }
    },

    moreOptionsSelect(e) {
        this.views.dropdownView.remove();
        this.views.dropdownView = null;
        switch (e.item) {
            case 'add-new':
                this.addNewField();
                break;
            case 'add-website':
                this.addNewField(this.model.getNextUrlFieldName());
                break;
            case 'toggle-empty': {
                const hideEmptyFields = AppSettingsModel.hideEmptyFields;
                AppSettingsModel.hideEmptyFields = !hideEmptyFields;
                this.render();
                break;
            }
            case 'otp':
                this.setupOtp();
                break;
            case 'auto-type':
                this.toggleAutoType();
                break;
            case 'clone':
                this.clone();
                break;
            case 'copy-to-clipboard':
                this.copyToClipboard();
                break;
            default:
                if (e.item.lastIndexOf('add:', 0) === 0) {
                    const fieldName = e.item.substr(4);
                    const fieldView = this.fieldViews.find((f) => f.model.name === fieldName);
                    fieldView.show();
                    this.scheduleSyncDetailsLabelWidth();
                    fieldView.edit();
                }
        }
    },

    contextMenu(e) {
        const canCopy = document.queryCommandSupported('copy');
        const options = [];
        if (canCopy) {
            if (this.model.backend === 'otp-device') {
                options.push({
                    value: 'det-copy-otp',
                    icon: 'copy',
                    text: Locale.detMenuCopyOtp
                });
            } else {
                options.push({
                    value: 'det-copy-password',
                    icon: 'copy',
                    text: Locale.detMenuCopyPassword
                });
            }
            options.push({
                value: 'det-copy-user',
                icon: 'copy',
                text: Locale.detMenuCopyUser
            });
        }
        if (!this.model.backend) {
            options.push({ value: 'det-add-new', icon: 'plus', text: Locale.detMenuAddNewField });
            options.push({ value: 'det-clone', icon: 'clone', text: Locale.detClone });
            if (canCopy) {
                options.push({
                    value: 'copy-to-clipboard',
                    icon: 'clipboard',
                    text: Locale.detCopyEntryToClipboard
                });
            }
        }
        if (AutoType.enabled) {
            options.push({ value: 'det-auto-type', icon: 'keyboard', text: Locale.detAutoType });
        }
        Events.emit('show-context-menu', Object.assign(e, { options }));
    },

    contextMenuSelect(e) {
        switch (e.item) {
            case 'det-copy-password':
                this.copyPassword();
                break;
            case 'det-copy-user':
                this.copyUserName();
                break;
            case 'det-copy-otp':
                this.copyOtp();
                break;
            case 'det-add-new':
                this.addNewField();
                break;
            case 'det-clone':
                this.clone();
                break;
            case 'det-auto-type':
                this.autoType();
                break;
            case 'copy-to-clipboard':
                this.copyToClipboard();
                break;
        }
    }
};

export { DetailsViewMenus };
