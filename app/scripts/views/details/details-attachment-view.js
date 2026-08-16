import { View } from 'framework/views/view';
import template from 'templates/details/details-attachment.hbs';

class DetailsAttachmentView extends View {
    template = template;

    events = {
        'click .details__attachment-preview-back': 'closeAttachment',
        'click .details__attachment-preview-download-btn': 'downloadAttachment',
        'click .details__attachment-preview-delete-btn': 'deleteAttachment'
    };

    render(complete) {
        super.render();
        const blob = new Blob([this.model.getBinary()], { type: this.model.mimeType });
        const dataEl = this.$el.find('.details__attachment-preview-data');
        switch ((this.model.mimeType || '').split('/')[0]) {
            case 'text': {
                const reader = new FileReader();
                reader.addEventListener('loadend', () => {
                    $('<pre/>').text(reader.result).appendTo(dataEl);
                    complete();
                });
                reader.readAsText(blob);
                return;
            }
            case 'image':
                $('<img/>').attr('src', URL.createObjectURL(blob)).appendTo(dataEl);
                complete();
                return;
        }
        this.$el.addClass('details__attachment-preview--empty');
        this.$el.find('.details__attachment-preview-icon').addClass('fa-' + this.model.icon);
        complete();
    }

    downloadAttachment() {
        this.emit('download');
    }

    deleteAttachment() {
        this.emit('delete');
    }

    closeAttachment() {
        this.emit('close');
    }
}

export { DetailsAttachmentView };
