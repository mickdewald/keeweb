import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { KeyHandler } from 'comp/browser/key-handler';
import { Keys } from 'const/keys';
import { UpdateModel } from 'models/update-model';
import { GeneratorView } from 'views/generator-view';
import template from 'templates/footer.hbs';

class FooterView extends View {
    parent = '.app__footer';

    template = template;

    events = {
        'click .footer__db-item': 'showFile',
        'click .footer__db-open': 'openFile',
        'click .footer__btn-help': 'toggleHelp',
        'click .footer__btn-settings': 'toggleSettings',
        'click .footer__btn-generate': 'genPass',
        'click .footer__btn-lock': 'lockWorkspace'
    };

    constructor(model, options) {
        super(model, options);

        this.onKey(Keys.DOM_VK_L, this.lockWorkspace, KeyHandler.SHORTCUT_ACTION, false, true);
        this.onKey(Keys.DOM_VK_G, this.genPass, KeyHandler.SHORTCUT_ACTION);
        this.onKey(Keys.DOM_VK_O, this.openFile, KeyHandler.SHORTCUT_ACTION);
        this.onKey(Keys.DOM_VK_S, this.saveAll, KeyHandler.SHORTCUT_ACTION);
        this.onKey(Keys.DOM_VK_COMMA, this.toggleSettings, KeyHandler.SHORTCUT_ACTION);

        this.listenTo(this, 'hide', this.viewHidden);
        this.listenTo(this.model.files, 'change', this.render);
        this.listenTo(Events, 'file-changed', this.render);
        this.listenTo(Events, 'set-locale', this.render);
        this.listenTo(UpdateModel, 'change:updateStatus', this.render);
        this.listenTo(Events, 'toggle-generator', this.genPass);
    }

    render() {
        super.render({
            files: this.model.files,
            updateAvailable: ['ready', 'found'].indexOf(UpdateModel.updateStatus) >= 0
        });
    }

    viewHidden() {
        if (this.views.gen) {
            this.views.gen.remove();
            delete this.views.gen;
        }
    }

    lockWorkspace(e) {
        if (this.model.files.hasOpenFiles()) {
            e.preventDefault();
            Events.emit('lock-workspace');
        }
    }

    genPass(e) {
        if (e && e.stopPropagation) {
            e.stopPropagation();
        }
        if (this.views.gen) {
            this.views.gen.remove();
            return;
        }
        let right;
        let bottom;
        if (e && e.pos) {
            right = e.pos.right;
            bottom = e.pos.bottom;
        } else {
            const el = this.$el.find('.footer__btn-generate')[0];
            const rect = el
                ? el.getBoundingClientRect()
                : { right: 24, top: window.innerHeight - 24 };
            const bodyRect = document.body.getBoundingClientRect();
            right = bodyRect.right - rect.right;
            bottom = bodyRect.bottom - rect.top;
        }
        const generator = new GeneratorView({ copy: true, pos: { right, bottom } });
        generator.render();
        generator.once('remove', () => {
            delete this.views.gen;
        });
        this.views.gen = generator;
    }

    showFile(e) {
        const fileId = $(e.target).closest('.footer__db-item').data('file-id');
        const file = fileId && this.model.files.get(fileId);
        if (!file) {
            return;
        }
        const root = file.groups && file.groups[0];
        Events.emit('menu-select', { item: root || this.model.menu.allItemsItem });
    }

    openFile() {
        Events.emit('open-file');
    }

    saveAll() {
        Events.emit('save-all');
    }

    toggleHelp() {
        Events.emit('toggle-settings', 'help');
    }

    toggleSettings() {
        Events.emit('toggle-settings', 'general');
    }
}

export { FooterView };
