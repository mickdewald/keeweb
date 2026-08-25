import { Events } from 'framework/events';
import { PasswordHealthView } from 'views/password-health-view';

function cloneFilter(filter) {
    if (!filter) {
        return {};
    }
    const cloned = {
        ...filter,
        advanced: filter.advanced ? { ...filter.advanced } : filter.advanced
    };
    if (filter.textParts) {
        cloned.textParts = [...filter.textParts];
    }
    if (filter.textLowerParts) {
        cloned.textLowerParts = [...filter.textLowerParts];
    }
    return cloned;
}

function findActiveMenuSelection(sections) {
    const findInItem = (item) => {
        if (item.active && item.filterKey) {
            const option = item.options && item.options.find((candidate) => candidate.active);
            return { item, option };
        }
        if (item.items) {
            for (const child of item.items) {
                const selection = findInItem(child);
                if (selection) {
                    return selection;
                }
            }
        }
    };

    if (sections) {
        for (const section of sections) {
            const selection = findInItem(section);
            if (selection) {
                return selection;
            }
        }
    }
    return null;
}

const AppViewTransientNavigationMixin = {
    rememberWorkspaceView() {
        if (this.workspaceReturnState || !this.model.files.hasOpenFiles()) {
            return;
        }
        this.workspaceReturnState = {
            filter: cloneFilter(this.model.filter),
            sort: this.model.sort,
            activeEntryId: this.model.activeEntryId,
            menuSelection: findActiveMenuSelection(this.model.menu?.menus?.app)
        };
    },

    restoreWorkspaceView() {
        const state = this.workspaceReturnState;
        this.workspaceReturnState = null;
        if (!state) {
            return false;
        }
        this.model.sort = state.sort;
        this.model.activeEntryId = state.activeEntryId;
        if (state.menuSelection) {
            this.model.menu.select(state.menuSelection);
        }
        this.model.setFilter(state.filter);
        return true;
    },

    returnToWorkspace() {
        this.showEntries();
        this.restoreWorkspaceView();
    },

    navigateToEntry(entry) {
        entry = entry?.id && this.model.getEntriesByFilter({}, this.model.files).get(entry.id);
        if (!entry) {
            return;
        }
        this.showEntries();
        this.restoreWorkspaceView();
        if (!this.model.getEntries().get(entry.id)) {
            this.model.menu.select({ item: this.model.menu.allItemsItem });
            if (!this.model.getEntries().get(entry.id)) {
                // All Items intentionally preserves the attachment filter.
                this.model.setFilter({ attachments: false });
            }
        }
        Events.emit('select-entry', entry);
    },

    forgetWorkspaceView() {
        this.workspaceReturnState = null;
    },

    menuSelect(opt) {
        const item = opt.item;
        if (item === this.model.menu.trashItem) {
            if (this.model.filter && this.model.filter.trash) {
                this.returnToWorkspace();
                return;
            }
            this.rememberWorkspaceView();
            if (this.views.settings || (this.views.panel && !this.views.panel.isHidden())) {
                this.showEntries();
            }
            this.model.menu.select(opt);
            return;
        }

        if (item && item.filterKey && this.views.settings) {
            this.showEntries();
        } else if (this.views.panel && !this.views.panel.isHidden()) {
            this.showEntries();
        }
        this.model.menu.select(opt);
        if (item && item.filterKey) {
            this.forgetWorkspaceView();
        }
    },

    toggleSettings(page, section) {
        let menuItem = page ? this.model.menu[page + 'Section'] : null;
        if (menuItem) {
            if (section) {
                menuItem = menuItem.items.find((it) => it.section === section) || menuItem.items[0];
            } else {
                menuItem = menuItem.items[0];
            }
        }
        if (this.views.settings) {
            if (this.views.settings.page === page || !menuItem) {
                if (this.model.files.hasOpenFiles()) {
                    this.returnToWorkspace();
                } else {
                    this.showLastOpenFile();
                    this.views.open.toggleMore();
                }
            } else {
                this.model.menu.select({ item: menuItem });
            }
        } else {
            this.rememberWorkspaceView();
            this.showSettings();
            if (menuItem) {
                this.model.menu.select({ item: menuItem });
            }
        }
    },

    showPasswordHealth() {
        if (!this.model.files.hasOpenFiles()) {
            return;
        }
        if (this.views.panel instanceof PasswordHealthView) {
            this.returnToWorkspace();
            return;
        }
        this.rememberWorkspaceView();
        this.hideOpenFile();
        this.hideSettings();
        this.hideKeyChange();
        const view = new PasswordHealthView(this.model);
        view.on('close', () => this.returnToWorkspace());
        view.on('select', (entry) => this.navigateToEntry(entry));
        this.showPanelView(view);
    }
};

export { AppViewTransientNavigationMixin, cloneFilter, findActiveMenuSelection };
