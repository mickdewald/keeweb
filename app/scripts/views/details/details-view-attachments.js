import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';
import { FileSaver } from 'util/ui/file-saver';
import { DetailsAttachmentView } from 'views/details/details-attachment-view';

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
        FileSaver.saveAs(blob, attachment.title);
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
        this.$el.find('.details__attachment-input-file')[0].click();
    },

    attachmentFileChange(e) {
        this.addAttachedFiles(e.target.files);
    },

    addAttachedFiles(files) {
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = () => {
                this.addAttachment(file.name, reader.result);
            };
            reader.readAsArrayBuffer(file);
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
