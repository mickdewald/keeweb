import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';
import { FileSaver } from 'util/ui/file-saver';
import { DetailsAttachmentView } from 'views/details/details-attachment-view';
import { beginPendingMutation } from 'models/file-mutation-tracker';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import * as kdbxweb from 'kdbxweb';

function base64ToBuffer(data) {
    const bytes = kdbxweb.ByteUtils.base64ToBytes(data);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function isActive(view, entry, file) {
    return !view.removed && view.model === entry && file.active !== false;
}

function showPickerError(err) {
    if (err && err.code !== 'CANCELED') {
        Alerts.error({
            header: Locale.setFileSaveError,
            body: Locale.setFileSaveErrorBody,
            pre: err.message || String(err)
        });
    }
}

const DetailsViewAttachments = {
    toggleAttachment(e) {
        const attBtn = $(e.target).closest('.details__attachment');
        const id = attBtn.data('id');
        const attachment = this.model.attachments[id];
        if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) {
            this.downloadAttachment(attachment);
            return;
        }
        if (this.views.sub && this.views.sub.attId === id) {
            this.render();
            return;
        }
        this.removeSubView();
        const subView = new DetailsAttachmentView(attachment, {
            parent: this.scroller[0],
            replace: true
        });
        subView.attId = id;
        subView.render(this.pageResized.bind(this));
        subView.on('download', () => this.downloadAttachment(attachment));
        subView.on('delete', () => this.confirmDeleteAttachment(attachment));
        this.listenTo(subView, 'close', this.render.bind(this));
        this.views.sub = subView;
        attBtn.addClass('details__attachment--active');
    },

    downloadAttachment(attachment) {
        const data = attachment.getBinary();
        if (!data) {
            return;
        }
        const mimeType = attachment.mimeType || 'application/octet-stream';
        const blob = new Blob([data], { type: mimeType });
        FileSaver.saveAs(blob, attachment.title).catch(() => {});
    },

    dragover(e) {
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        if (
            !dt.types ||
            (dt.types.indexOf ? dt.types.indexOf('Files') === -1 : !dt.types.contains('Files'))
        ) {
            dt.dropEffect = 'none';
            return;
        }
        dt.dropEffect = 'copy';
        if (this.dragTimeout) {
            clearTimeout(this.dragTimeout);
        }
        if (this.model && !this.dragging) {
            this.dragging = true;
            this.$el.find('.details').addClass('details--drag');
        }
    },

    dragleave() {
        if (this.dragTimeout) {
            clearTimeout(this.dragTimeout);
        }
        this.dragTimeout = setTimeout(() => {
            this.$el.find('.details').removeClass('details--drag');
            this.dragging = false;
        }, 100);
    },

    drop(e) {
        e.preventDefault();
        if (!this.model) {
            return;
        }
        if (this.dragTimeout) {
            clearTimeout(this.dragTimeout);
        }
        this.$el.find('.details').removeClass('details--drag');
        this.dragging = false;
        const files = e.target.files || e.dataTransfer.files;
        this.addAttachedFiles(files);
    },

    attachmentBtnClick() {
        if (AndroidPlatform.isAndroid) {
            const entry = this.model;
            const file = entry.file;
            const completeMutation = beginPendingMutation(file);
            Promise.resolve()
                .then(() =>
                    AndroidPlatform.withNativeFlow(() =>
                        AndroidPlatform.plugin('DocumentFile').pickRead({ mimeType: '*/*' })
                    )
                )
                .then(({ data, name }) => {
                    if (!isActive(this, entry, file)) {
                        return;
                    }
                    return entry.addAttachment(name, base64ToBuffer(data));
                })
                .then(() => isActive(this, entry, file) && this.entryUpdated())
                .catch(showPickerError)
                .finally(completeMutation);
            return;
        }
        this.$el.find('.details__attachment-input-file')[0].click();
    },

    attachmentFileChange(e) {
        this.addAttachedFiles(e.target.files);
    },

    addAttachedFiles(files) {
        const entry = this.model;
        const modelFile = entry.file;
        for (const selectedFile of files) {
            const completeMutation = beginPendingMutation(modelFile);
            try {
                const reader = new FileReader();
                reader.onload = () => {
                    if (!isActive(this, entry, modelFile)) {
                        completeMutation();
                        return;
                    }
                    entry.addAttachment(selectedFile.name, reader.result).then(
                        () => {
                            try {
                                if (isActive(this, entry, modelFile)) {
                                    this.entryUpdated();
                                }
                            } finally {
                                completeMutation();
                            }
                        },
                        () => completeMutation()
                    );
                };
                reader.onerror = (e) => {
                    showPickerError(e.target.error);
                    completeMutation();
                };
                reader.onabort = completeMutation;
                reader.readAsArrayBuffer(selectedFile);
            } catch (err) {
                showPickerError(err);
                completeMutation();
            }
        }
    },

    addAttachment(name, data) {
        this.model.addAttachment(name, data).then(() => {
            this.entryUpdated();
        });
    },

    deleteKeyPress(e) {
        if (this.views.sub && this.views.sub.attId !== undefined) {
            e.preventDefault();
            const attachment = this.model.attachments[this.views.sub.attId];
            this.confirmDeleteAttachment(attachment);
        }
    },

    confirmDeleteAttachment(attachment) {
        if (!attachment) {
            return;
        }
        Alerts.yesno({
            header: Locale.detAttDelete,
            body: Locale.detAttDeleteBody.replace('{}', attachment.title),
            icon: 'trash-alt',
            success: () => {
                this.model.removeAttachment(attachment.title);
                this.entryUpdated();
                if (this.appModel?.filter?.attachments && !this.model.attachments.length) {
                    this.appModel.refresh();
                }
            }
        });
    }
};

export { DetailsViewAttachments };
