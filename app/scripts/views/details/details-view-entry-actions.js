import * as kdbxweb from 'kdbxweb';
import { Events } from 'framework/events';
import { CopyPaste } from 'comp/browser/copy-paste';
import { KeyHandler } from 'comp/browser/key-handler';
import { Alerts } from 'comp/ui/alerts';
import { Keys } from 'const/keys';
import { Features } from 'util/features';
import { Locale } from 'util/locale';
import { DetailsHistoryView } from 'views/details/details-history-view';

const DetailsViewEntryActions = {
    editTitle() {
        if (this.model.backend === 'otp-device') {
            return;
        }
        const input = $('<input/>')
            .addClass('details__header-title-input')
            .attr({ autocomplete: 'off', spellcheck: 'false', placeholder: 'Title' })
            .val(this.model.title);
        input.bind({
            blur: this.titleInputBlur.bind(this),
            input: this.titleInputInput.bind(this),
            keydown: this.titleInputKeydown.bind(this),
            keypress: this.titleInputInput.bind(this)
        });
        $('.details__header-title').replaceWith(input);
        input.focus()[0].setSelectionRange(this.model.title.length, this.model.title.length);
    },

    titleInputBlur(e) {
        this.setTitle(e.target.value);
    },

    titleInputInput(e) {
        e.stopPropagation();
    },

    titleInputKeydown(e) {
        KeyHandler.reg();
        e.stopPropagation();
        const code = e.keyCode || e.which;
        if (code === Keys.DOM_VK_RETURN) {
            $(e.target).unbind('blur');
            this.setTitle(e.target.value);
        } else if (code === Keys.DOM_VK_ESCAPE) {
            $(e.target).unbind('blur');
            if (this.model.isJustCreated) {
                this.model.removeWithoutHistory();
                Events.emit('refresh');
                return;
            }
            this.render();
        } else if (code === Keys.DOM_VK_TAB) {
            e.preventDefault();
            $(e.target).unbind('blur');
            this.setTitle(e.target.value);
            if (!e.shiftKey) {
                this.focusNextField({ field: '$Title' });
            }
        }
    },

    setTitle(title) {
        if (this.model.title instanceof kdbxweb.ProtectedValue) {
            title = kdbxweb.ProtectedValue.fromString(title);
        }
        if (title !== this.model.title) {
            this.model.setField('Title', title);
            this.entryUpdated(true);
        }
        const newTitle = $('<h1 class="details__header-title"></h1>').text(title || '(no title)');
        this.$el.find('.details__header-title-input').replaceWith(newTitle);
    },

    showHistory() {
        this.removeSubView();
        const subView = new DetailsHistoryView(this.model, {
            parent: this.scroller[0],
            replace: true
        });
        this.listenTo(subView, 'close', this.historyClosed.bind(this));
        subView.render();
        this.pageResized();
        this.views.sub = subView;
    },

    historyClosed(e) {
        if (e.updated) {
            this.entryUpdated();
        } else {
            this.render();
        }
    },

    moveToTrash() {
        const doMove = () => {
            this.model.moveToTrash();
            Events.emit('refresh');
        };
        if (Features.isMobile) {
            Alerts.yesno({
                header: Locale.detDelToTrash,
                body: Locale.detDelToTrashBody,
                icon: 'trash-alt',
                success: doMove
            });
        } else {
            doMove();
        }
    },

    clone() {
        const newEntry = this.model.cloneEntry(' ' + Locale.detClonedName);
        Events.emit('select-entry', newEntry);
    },

    copyToClipboard() {
        CopyPaste.copyHtml(this.model.getHtml());
    },

    deleteFromTrash() {
        Alerts.yesno({
            header: Locale.detDelFromTrash,
            body: Locale.detDelFromTrashBody,
            hint: Locale.detDelFromTrashBodyHint,
            icon: 'minus-circle',
            success: () => {
                this.model.deleteFromTrash();
                Events.emit('refresh');
            }
        });
    },

    restoreFromTrash() {
        this.model.restoreFromTrash();
        Events.emit('refresh');
    },

    backClick() {
        Events.emit('toggle-details', false);
    }
};

export { DetailsViewEntryActions };
