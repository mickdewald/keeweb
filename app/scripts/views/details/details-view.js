import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { AutoType } from 'auto-type';
import { KeyHandler } from 'comp/browser/key-handler';
import { highlightDom } from 'hbs-helpers/highlight';
import { Keys } from 'const/keys';
import { AppSettingsModel } from 'models/app-settings-model';
import { GroupModel } from 'models/group-model';
import { Locale } from 'util/locale';
import { Tip } from 'util/ui/tip';
import { Copyable } from 'framework/views/copyable';
import { Scrollable } from 'framework/views/scrollable';
import { DetailsAddFieldView } from 'views/details/details-add-field-view';
import { DetailsIssuesView } from 'views/details/details-issues-view';
import { DetailsViewAttachments } from 'views/details/details-view-attachments';
import { DetailsViewCopyAutoType } from 'views/details/details-view-copy-auto-type';
import { DetailsViewEntryActions } from 'views/details/details-view-entry-actions';
import { DetailsViewIcons } from 'views/details/details-view-icons';
import { DetailsViewMenus } from 'views/details/details-view-menus';
import { createDetailsFields, createNewCustomField } from 'views/details/details-fields';
import { FieldViewCustom } from 'views/fields/field-view-custom';
import { isEqual } from 'util/fn';
import template from 'templates/details/details.hbs';
import emptyTemplate from 'templates/details/details-empty.hbs';
import groupTemplate from 'templates/details/details-group.hbs';

class DetailsView extends View {
    parent = '.app__details';
    fieldViews = [];
    fieldCopyTip = null;

    events = {
        'click .details__colors-popup-item': 'selectColor',
        'click .details__header-icon': 'toggleIcons',
        'click .details__attachment': 'toggleAttachment',
        'click .details__header-title': 'editTitle',
        'click .details__history-link': 'showHistory',
        'click .details__buttons-trash': 'moveToTrash',
        'click .details__buttons-trash-del': 'deleteFromTrash',
        'click .details__buttons-trash-restore': 'restoreFromTrash',
        'click .details__back-button': 'backClick',
        'click .details__attachment-add': 'attachmentBtnClick',
        'change .details__attachment-input-file': 'attachmentFileChange',
        'dragover .details': 'dragover',
        'dragleave .details': 'dragleave',
        'drop .details': 'drop',
        'contextmenu .details': 'contextMenu'
    };

    constructor(model, options) {
        super(model, options);
        this.initScroll();
        this.listenTo(Events, 'entry-selected', this.showEntry);
        this.listenTo(Events, 'copy-password', this.copyPassword);
        this.listenTo(Events, 'copy-user', this.copyUserName);
        this.listenTo(Events, 'copy-url', this.copyUrl);
        this.listenTo(Events, 'copy-otp', this.copyOtp);
        this.listenTo(Events, 'toggle-settings', this.settingsToggled);
        this.listenTo(Events, 'toggle-details', this.detailsShown);
        this.listenTo(Events, 'context-menu-select', this.contextMenuSelect);
        this.listenTo(Events, 'set-locale', this.render);
        this.listenTo(Events, 'qr-read', this.otpCodeRead);
        this.listenTo(Events, 'qr-enter-manually', this.otpEnterManually);
        this.onKey(
            Keys.DOM_VK_C,
            this.copyPasswordFromShortcut,
            KeyHandler.SHORTCUT_ACTION,
            false,
            true
        );
        this.onKey(Keys.DOM_VK_B, this.copyUserName, KeyHandler.SHORTCUT_ACTION);
        this.onKey(Keys.DOM_VK_U, this.copyUrl, KeyHandler.SHORTCUT_ACTION);
        this.onKey(Keys.DOM_VK_2, this.copyOtp, KeyHandler.SHORTCUT_OPT);
        if (AutoType.enabled) {
            this.onKey(Keys.DOM_VK_T, () => this.autoType(), KeyHandler.SHORTCUT_ACTION);
        }
        this.onKey(
            Keys.DOM_VK_DELETE,
            this.deleteKeyPress,
            KeyHandler.SHORTCUT_ACTION,
            false,
            true
        );
        this.onKey(
            Keys.DOM_VK_BACK_SPACE,
            this.deleteKeyPress,
            KeyHandler.SHORTCUT_ACTION,
            false,
            true
        );
        this.once('remove', () => {
            this.removeFieldViews();
        });
    }

    removeFieldViews() {
        this.fieldViews.forEach((fieldView) => fieldView.remove());
        this.fieldViews = [];
        this.hideFieldCopyTip();
    }

    render() {
        Tip.destroyTips(this.$el);
        this.removeScroll();
        this.removeFieldViews();
        this.removeInnerViews();
        if (!this.model) {
            this.template = emptyTemplate;
            super.render();
            return;
        }
        if (this.model instanceof GroupModel) {
            this.template = groupTemplate;
            super.render();
            return;
        }
        const model = {
            deleted: this.appModel.filter.trash,
            canEditColor: this.model.file.supportsColors && !this.model.readOnly,
            canEditIcon: this.model.file.supportsIcons && !this.model.readOnly,
            showButtons: !this.model.backend && !this.model.readOnly,
            ...this.model
        };
        this.template = template;
        super.render(model);
        this.setSelectedColor(this.model.color);
        highlightDom(this.$el.find('.details__header-title')[0], this.searchTerms());
        this.addFieldViews();
        this.checkPasswordIssues();
        this.createScroll({
            root: this.$el.find('.details__body')[0],
            scroller: this.$el.find('.scroller')[0],
            bar: this.$el.find('.scroller__bar')[0]
        });
        this.$el.find('.details').removeClass('details--drag');
        this.dragging = false;
        if (this.dragTimeout) {
            clearTimeout(this.dragTimeout);
        }
        this.pageResized();
        this.showCopyTip();
    }

    getFieldView(name) {
        return this.fieldViews.find((fv) => fv.model.name === name);
    }

    searchTerms() {
        const filter = (this.appModel && this.appModel.filter) || {};
        return filter.textLowerParts || (filter.textLower ? [filter.textLower] : null);
    }

    addFieldViews() {
        const { fieldViews, fieldViewsAside } = createDetailsFields(this);

        const hideEmptyFields = AppSettingsModel.hideEmptyFields;
        const searchTerms = this.searchTerms();

        const fieldsMainEl = this.$el.find('.details__body-fields');
        const fieldsAsideEl = this.$el.find('.details__body-aside');
        for (const views of [fieldViews, fieldViewsAside]) {
            for (const fieldView of views) {
                fieldView.parent = views === fieldViews ? fieldsMainEl[0] : fieldsAsideEl[0];
                fieldView.searchTerms = searchTerms;
                fieldView.render();
                fieldView.on('change', this.fieldChanged.bind(this));
                fieldView.on('copy', (e) => this.copyFieldValue(e));
                fieldView.on('autotype', (e) => this.autoType(e.source.model.sequence));
                if (hideEmptyFields) {
                    const value = fieldView.model.value();
                    if (!value || value.length === 0 || value.byteLength === 0) {
                        if (this.model.isJustCreated) {
                            const fieldsHiddenForNewEntriesWhenEmpty = [
                                '$URL',
                                '$Notes',
                                'Tags',
                                'Expires',
                                'History'
                            ];
                            if (
                                !fieldsHiddenForNewEntriesWhenEmpty.includes(fieldView.model.name)
                            ) {
                                continue;
                            }
                        }
                        fieldView.hide();
                    }
                }
            }
        }

        this.fieldViews = fieldViews.concat(fieldViewsAside);

        if (!this.model.backend) {
            this.moreView = new DetailsAddFieldView();
            this.moreView.render();
            this.moreView.on('add-field', this.addNewField.bind(this));
            this.moreView.on('more-click', this.toggleMoreOptions.bind(this));
        }

        this.scheduleSyncDetailsLabelWidth();
    }

    detailsShown(visible) {
        if (visible) {
            this.scheduleSyncDetailsLabelWidth();
        }
    }

    scheduleSyncDetailsLabelWidth() {
        this.syncDetailsLabelWidth();
        requestAnimationFrame(() => {
            if (!this.removed) {
                this.syncDetailsLabelWidth();
            }
        });
    }

    syncDetailsLabelWidth() {
        const root = this.el;
        if (!root || !root.getClientRects().length || !root.offsetWidth) {
            return;
        }
        const labels = root.querySelectorAll(
            '.details__body-fields .details__field-label, .details__body-aside .details__field-label'
        );
        const fontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
        const minPx = Math.ceil(7 * fontSize);
        const maxPx = Math.ceil(22 * fontSize);
        let widest = minPx;
        root.classList.add('details--measure-labels');
        labels.forEach((label) => {
            const field = label.closest('.details__field');
            if (!field || field.classList.contains('hide') || label.querySelector('input')) {
                return;
            }
            const width = Math.ceil(label.getBoundingClientRect().width);
            if (width > widest) {
                widest = width;
            }
        });
        root.classList.remove('details--measure-labels');
        root.style.setProperty('--details-label-width', `${Math.min(widest, maxPx)}px`);
    }

    addNewField(title) {
        this.moreView.remove();
        this.moreView = null;
        let newFieldTitle = title || Locale.detNetField;
        if (this.model.fields[newFieldTitle]) {
            for (let i = 1; ; i++) {
                const newFieldTitleVariant = newFieldTitle + i;
                if (!this.model.fields[newFieldTitleVariant]) {
                    newFieldTitle = newFieldTitleVariant;
                    break;
                }
            }
        }

        const fieldView = createNewCustomField(
            newFieldTitle,
            {
                parent: this.$el.find('.details__body-fields')[0]
            },
            this.model
        );

        fieldView.on('change', this.fieldChanged.bind(this));
        fieldView.render();
        this.fieldViews.push(fieldView);
        this.scheduleSyncDetailsLabelWidth();
        fieldView.edit();
    }

    getUserNameCompletions(part) {
        return this.appModel.completeUserNames(part);
    }

    removeSubView() {
        this.$el.find('.details__attachment').removeClass('details__attachment--active');
        if (this.views.sub) {
            this.views.sub.remove();
            delete this.views.sub;
        }
    }

    showEntry(entry) {
        this.model = entry;
        this.initOtp();
        this.render();
        if (entry && !entry.title && entry.isJustCreated) {
            this.editTitle();
        }
    }

    initOtp() {
        this.matchingOtpEntry = null;

        if (!this.model) {
            return;
        }

        this.model.initOtpGenerator?.();
        if (this.model.backend === 'otp-device') {
            return;
        }

        this.matchingOtpEntry = this.appModel.getMatchingOtpEntry(this.model);
        this.matchingOtpEntry?.initOtpGenerator();
    }

    settingsToggled() {
        this.hideFieldCopyTip();
    }

    fieldChanged(e) {
        if (e.field) {
            if (e.field[0] === '$') {
                let fieldName = e.field.substr(1);
                if (fieldName === 'otp') {
                    if (this.otpFieldChanged(e.val)) {
                        this.entryUpdated();
                        return;
                    }
                } else if (e.newField) {
                    if (fieldName) {
                        this.model.setField(fieldName, undefined);
                    }
                    fieldName = e.newField;
                    let i = 0;
                    while (this.model.hasField(fieldName)) {
                        i++;
                        fieldName = e.newField + i;
                    }
                    const allowEmpty = this.model.group.isEntryTemplatesGroup();
                    this.model.setField(fieldName, e.val, allowEmpty);
                    this.entryUpdated();
                    return;
                } else if (fieldName === 'File') {
                    const newFile = this.appModel.files.get(e.val);
                    this.model.moveToFile(newFile);
                    this.appModel.activeEntryId = this.model.id;
                    this.entryUpdated();
                    Events.emit('entry-selected', this.model);
                    return;
                } else if (fieldName) {
                    this.model.setField(fieldName, e.val);
                }
                if (fieldName === 'Password' && this.views.issues) {
                    this.views.issues.passwordChanged();
                }
            } else if (e.field === 'Tags') {
                this.model.setTags(e.val);
                this.appModel.updateTags();
            } else if (e.field === 'Expires') {
                const dt = e.val || undefined;
                if (!isEqual(dt, this.model.expires)) {
                    this.model.setExpires(dt);
                }
            }
            this.entryUpdated(true);
            this.fieldViews.forEach(function (fieldView, ix) {
                // TODO: render the view instead
                if (
                    (fieldView instanceof FieldViewCustom &&
                        !fieldView.model.newField &&
                        !this.model.hasField(fieldView.model.title)) ||
                    (fieldView.model.isExtraUrl &&
                        !fieldView.model.newField &&
                        !this.model.hasField(fieldView.model.name.replace('$', '')))
                ) {
                    fieldView.remove();
                    this.fieldViews.splice(ix, 1);
                } else {
                    fieldView.update();
                }
            }, this);
        } else if (e.newField) {
            this.render();
            return;
        }
        if (e.tab) {
            this.focusNextField(e.tab);
        }
    }

    otpFieldChanged(value) {
        let oldValue = this.model.fields.otp;
        if (oldValue && oldValue.isProtected) {
            oldValue = oldValue.getText();
        }
        if (value && value.isProtected) {
            value = value.getText();
        }
        if (oldValue === value) {
            this.render();
            return false;
        }
        this.model.setOtpUrl(value);
        return true;
    }

    entryUpdated(skipRender) {
        Events.emit('entry-updated', { entry: this.model });
        this.initOtp();
        if (!skipRender) {
            this.render();
        }
    }

    focusNextField(config) {
        let found = false,
            nextFieldView;
        if (config.field === '$Title' && !config.prev) {
            found = true;
        }
        const start = config.prev ? this.fieldViews.length - 1 : 0;
        const end = config.prev ? -1 : this.fieldViews.length;
        const inc = config.prev ? -1 : 1;
        for (let i = start; i !== end; i += inc) {
            const fieldView = this.fieldViews[i];
            if (fieldView.model.name === config.field) {
                found = true;
            } else if (found && !fieldView.readonly && !fieldView.isHidden()) {
                nextFieldView = fieldView;
                break;
            }
        }
        if (nextFieldView) {
            nextFieldView.edit();
        }
    }

    checkPasswordIssues() {
        if (!this.model.readOnly) {
            this.views.issues = new DetailsIssuesView(this.model);
            this.views.issues.render();
        }
    }
}

Object.assign(DetailsView.prototype, Scrollable);
Object.assign(DetailsView.prototype, Copyable);
Object.assign(DetailsView.prototype, DetailsViewAttachments);
Object.assign(DetailsView.prototype, DetailsViewCopyAutoType);
Object.assign(DetailsView.prototype, DetailsViewMenus);
Object.assign(DetailsView.prototype, DetailsViewEntryActions);
Object.assign(DetailsView.prototype, DetailsViewIcons);

export { DetailsView };
