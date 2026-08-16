import { Events } from 'framework/events';
import { View } from 'framework/views/view';
import { Alerts } from 'comp/ui/alerts';
import { KeyHandler } from 'comp/browser/key-handler';
import { Keys } from 'const/keys';
import { Locale } from 'util/locale';
import triggerTemplate from 'templates/menu/menu-workspace.hbs';
import popoverTemplate from 'templates/menu/menu-workspace-popover.hbs';

function workspaceActionFromEvent(e) {
    const target = e && e.target;
    const item = target && target.closest && target.closest('.menu__workspace-item');
    if (!item) {
        return null;
    }
    return {
        action: item.getAttribute('data-action'),
        fileId: item.getAttribute('data-file-id')
    };
}

class MenuWorkspacePopoverView extends View {
    parent = 'body';

    template = popoverTemplate;

    events = {
        'click .menu__workspace-item': 'itemClick',
        'click': 'stop'
    };

    render(data) {
        super.render(data);
        if (data.position && this.el) {
            Object.assign(this.el.style, data.position);
        }
    }

    stop(e) {
        e.stopPropagation();
    }

    itemClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const selected = workspaceActionFromEvent(e);
        if (selected && selected.action) {
            this.emit('select', selected);
        }
    }
}

class MenuWorkspaceView extends View {
    template = triggerTemplate;

    events = {
        'click': 'togglePopover'
    };

    constructor(model, options) {
        super(model, options);
        this.listenTo(this.model.files, 'change', this.render);
        this.listenTo(Events, 'file-changed', this.render);
        this.listenTo(Events, 'set-filter', this.render);
        this.listenTo(Events, 'set-locale', this.render);
        this.listenTo(Events, 'menu-select', this.render);
        this.onKey(Keys.DOM_VK_D, this.openTrash, KeyHandler.SHORTCUT_ACTION);
        this.onKey(Keys.DOM_VK_D, this.openTrash, KeyHandler.SHORTCUT_OPT);
        this.bodyClick = this.bodyClick.bind(this);
        this.once('remove', () => {
            this.closePopover();
            document.body.removeEventListener('mousedown', this.bodyClick, true);
        });
    }

    render() {
        const open = !!this.views.popover;
        super.render({ ...this.triggerData(), open });
        if (open) {
            this.positionPopover();
        }
    }

    triggerData() {
        const files = this.openFiles();
        const current = this.currentFile(files);
        return {
            title: current ? current.name : Locale.menuAllItems,
            subtitle: files.length > 1 ? Locale.menuOpenDatabases.replace('{}', files.length) : '',
            modified: files.some((file) => file.modified)
        };
    }

    popoverData() {
        const files = this.openFiles();
        const current = this.currentFile(files);
        return {
            files: files.map((file) => ({
                id: file.id,
                name: file.name,
                modified: file.modified,
                current: current && file.id === current.id
            })),
            trashActive: !!(this.model.filter && this.model.filter.trash)
        };
    }

    openFiles() {
        return this.model.files.filter((file) => file.active);
    }

    currentFile(files) {
        const list = files || this.openFiles();
        const groupId = this.model.filter && this.model.filter.group;
        if (groupId) {
            const match = list.find((file) => file.getGroup && file.getGroup(groupId));
            if (match) {
                return match;
            }
        }
        return list[0];
    }

    togglePopover(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (this.views.popover) {
            this.closePopover();
            return;
        }
        const popover = new MenuWorkspacePopoverView();
        this.listenTo(popover, 'select', this.selectAction);
        popover.render({
            ...this.popoverData(),
            position: this.popoverPosition()
        });
        this.views.popover = popover;
        this.el.classList.add('menu__workspace-trigger--open');
        window.setTimeout(() => {
            document.body.addEventListener('mousedown', this.bodyClick, true);
        }, 0);
    }

    popoverPosition() {
        const trigger = this.el;
        if (!trigger || !trigger.getBoundingClientRect) {
            return {};
        }
        const rect = trigger.getBoundingClientRect();
        return {
            position: 'fixed',
            left: `${Math.round(rect.left)}px`,
            width: `${Math.round(rect.width)}px`,
            bottom: `${Math.max(8, Math.round(window.innerHeight - rect.top + 8))}px`,
            zIndex: 10000
        };
    }

    positionPopover() {
        if (this.views.popover) {
            this.views.popover.render({
                ...this.popoverData(),
                position: this.popoverPosition()
            });
        }
    }

    bodyClick(e) {
        if (this.el && this.el.contains(e.target)) {
            return;
        }
        if (
            this.views.popover &&
            this.views.popover.el &&
            this.views.popover.el.contains(e.target)
        ) {
            return;
        }
        this.closePopover();
    }

    closePopover() {
        document.body.removeEventListener('mousedown', this.bodyClick, true);
        if (this.views.popover) {
            this.views.popover.remove();
            delete this.views.popover;
        }
        if (this.el) {
            this.el.classList.remove('menu__workspace-trigger--open');
        }
    }

    selectAction({ action, fileId }) {
        this.closePopover();
        switch (action) {
            case 'file':
                this.selectFile(fileId);
                break;
            case 'open':
                Events.emit('open-file');
                break;
            case 'settings':
                Events.emit('toggle-settings', 'general');
                break;
            case 'help':
                Events.emit('toggle-settings', 'help');
                break;
            case 'generate':
                this.openGenerator();
                break;
            case 'trash':
                this.openTrash();
                break;
            case 'empty-trash':
                this.emptyTrash();
                break;
            case 'lock':
                Events.emit('lock-workspace');
                break;
            default:
                break;
        }
    }

    selectFile(fileId) {
        const file = this.model.files.get(fileId);
        const root = file && file.groups && file.groups[0];
        Events.emit('menu-select', { item: root || this.model.menu.allItemsItem });
    }

    openTrash() {
        if (this.model.menu.trashItem) {
            Events.emit('menu-select', { item: this.model.menu.trashItem });
        }
    }

    emptyTrash() {
        Alerts.yesno({
            header: Locale.menuEmptyTrashAlert,
            body: Locale.menuEmptyTrashAlertBody,
            icon: 'minus-circle',
            success() {
                Events.emit('empty-trash');
            }
        });
    }

    openGenerator() {
        const trigger = this.el;
        const rect = trigger
            ? trigger.getBoundingClientRect()
            : { right: 16, top: window.innerHeight - 16 };
        const bodyRect = document.body.getBoundingClientRect();
        Events.emit('toggle-generator', {
            pos: {
                right: bodyRect.right - rect.right,
                bottom: bodyRect.bottom - rect.top
            }
        });
    }
}

export { MenuWorkspaceView, workspaceActionFromEvent };
