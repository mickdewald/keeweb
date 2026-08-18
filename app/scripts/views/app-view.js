import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { IdleTracker } from 'comp/browser/idle-tracker';
import { KeyHandler } from 'comp/browser/key-handler';
import { Launcher } from 'comp/launcher';
import { SettingsManager } from 'comp/settings/settings-manager';
import { Alerts } from 'comp/ui/alerts';
import { Keys } from 'const/keys';
import { UpdateModel } from 'models/update-model';
import { Features } from 'util/features';
import { Locale } from 'util/locale';
import { DetailsView } from 'views/details/details-view';
import { DragView } from 'views/drag-view';
import { FooterView } from 'views/footer-view';
import { GeneratorPresetsView } from 'views/generator-presets-view';
import { GrpView } from 'views/grp-view';
import { ListView } from 'views/list-view';
import { ListWrapView } from 'views/list-wrap-view';
import { MenuView } from 'views/menu/menu-view';
import { TagView } from 'views/tag-view';
import { TitlebarView } from 'views/titlebar-view';
import { SelectEntryView } from 'views/select/select-entry-view';
import { SelectEntryFilter } from 'comp/app/select-entry-filter';
import { CopyPaste } from 'comp/browser/copy-paste';
import { AppViewPanelsMixin } from 'views/app-view-panels';
import { AppViewLockMixin } from 'views/app-view-lock';
import { Timeouts } from 'const/timeouts';
import template from 'templates/app.hbs';

class AppView extends View {
    parent = 'body';

    template = template;

    events = {
        contextmenu: 'contextMenu',
        drop: 'drop',
        dragenter: 'dragover',
        dragover: 'dragover',
        'click a[target=_blank]': 'extLinkClick',
        mousedown: 'bodyClick'
    };

    titlebarStyle = 'default';

    constructor(model) {
        super(model);

        this.titlebarStyle = this.model.settings.titlebarStyle;
        if (Features.isDesktop && Features.isMac && this.titlebarStyle === 'default') {
            this.titlebarStyle = 'hidden-inset';
        }

        this.views.menu = new MenuView(this.model.menu, {
            ownParent: true,
            appModel: this.model
        });
        this.views.menuDrag = new DragView('x', { parent: '.app__menu-drag' });
        this.views.footer = new FooterView(this.model, { ownParent: true });
        this.views.listWrap = new ListWrapView(this.model, { ownParent: true });
        this.views.list = new ListView(this.model, { ownParent: true });
        this.views.listDrag = new DragView('x', { parent: '.app__list-drag' });
        this.views.list.dragView = this.views.listDrag;
        this.views.details = new DetailsView(undefined, { ownParent: true });
        this.views.details.appModel = this.model;
        if (this.titlebarStyle !== 'default' && Features.renderCustomTitleBar) {
            this.views.titlebar = new TitlebarView(this.model);
        }

        this.views.menu.listenDrag(this.views.menuDrag);
        this.views.list.listenDrag(this.views.listDrag);

        this.listenTo(this.model.settings, 'change:theme', this.setTheme);
        this.listenTo(this.model.settings, 'change:locale', this.setLocale);
        this.listenTo(this.model.settings, 'change:fontSize', this.setFontSize);
        this.listenTo(this.model.settings, 'change:autoSaveInterval', this.setupAutoSave);
        this.listenTo(this.model.files, 'change', this.fileListUpdated);

        this.listenTo(Events, 'select-all', this.selectAll);
        this.listenTo(Events, 'menu-select', this.menuSelect);
        this.listenTo(Events, 'lock-workspace', this.lockWorkspace);
        this.listenTo(Events, 'show-file', this.showFileSettings);
        this.listenTo(Events, 'open-file', this.toggleOpenFile);
        this.listenTo(Events, 'save-all', this.saveAll);
        this.listenTo(Events, 'remote-key-changed', this.remoteKeyChanged);
        this.listenTo(Events, 'key-change-pending', this.keyChangePending);
        this.listenTo(Events, 'toggle-settings', this.toggleSettings);
        this.listenTo(Events, 'toggle-menu', this.toggleMenu);
        this.listenTo(Events, 'toggle-details', this.toggleDetails);
        this.listenTo(Events, 'show-open-view', this.showOpenIfNotThere);
        this.listenTo(Events, 'edit-group', this.editGroup);
        this.listenTo(Events, 'edit-tag', this.editTag);
        this.listenTo(Events, 'edit-generator-presets', this.editGeneratorPresets);
        this.listenTo(Events, 'show-password-health', this.showPasswordHealth);
        this.listenTo(Events, 'launcher-open-file', this.launcherOpenFile);
        this.listenTo(Events, 'user-idle', this.userIdle);
        this.listenTo(Events, 'os-lock', this.osLocked);
        this.listenTo(Events, 'power-monitor-suspend', this.osLocked);
        this.listenTo(Events, 'app-minimized', this.appMinimized);
        this.listenTo(Events, 'show-context-menu', this.showContextMenu);
        this.listenTo(Events, 'second-instance', this.showSingleInstanceAlert);
        this.listenTo(Events, 'enter-full-screen', this.enterFullScreen);
        this.listenTo(Events, 'leave-full-screen', this.leaveFullScreen);
        this.listenTo(Events, 'import-csv-requested', this.showImportCsv);
        this.listenTo(Events, 'launcher-before-quit', this.launcherBeforeQuit);

        this.listenTo(UpdateModel, 'change:updateReady', this.updateApp);

        window.onbeforeunload = this.beforeUnload.bind(this);
        window.onresize = this.windowResize.bind(this);
        window.onblur = this.windowBlur.bind(this);

        this.onKey(Keys.DOM_VK_ESCAPE, this.escPressed);
        this.onKey(Keys.DOM_VK_BACK_SPACE, this.backspacePressed);
        this.onKey(Keys.DOM_VK_K, this.showCmdPalette, KeyHandler.SHORTCUT_ACTION);
        if (Launcher && Launcher.devTools) {
            this.onKey(
                Keys.DOM_VK_I,
                this.openDevTools,
                KeyHandler.SHORTCUT_ACTION + KeyHandler.SHORTCUT_OPT,
                '*'
            );
        }

        this.setWindowClass();
        this.setupAutoSave();
    }

    setWindowClass() {
        const browserCssClass = Features.browserCssClass;
        if (browserCssClass) {
            document.body.classList.add(browserCssClass);
        }
        if (this.titlebarStyle !== 'default') {
            document.body.classList.add('titlebar-' + this.titlebarStyle);
            if (Features.renderCustomTitleBar) {
                document.body.classList.add('titlebar-custom');
            }
        }
        if (this.model.settings.compactLayout) {
            document.body.classList.add('layout-compact');
        }
        if (Features.isDesktop && Features.isMac && this.titlebarStyle === 'hidden-inset') {
            document.body.classList.add('macos-vibrancy');
        }
        if (Features.isMobile) {
            document.body.classList.add('mobile');
        }
    }

    render() {
        super.render({
            beta: this.model.isBeta,
            titlebarStyle: this.titlebarStyle,
            customTitlebar: Features.renderCustomTitleBar
        });
        this.panelEl = this.$el.find('.app__panel:first');
        this.views.listWrap.render();
        this.views.menu.render();
        this.views.menuDrag.render();
        this.views.footer.render();
        this.views.footer.hide();
        this.views.list.render();
        this.views.listDrag.render();
        this.views.details.render();
        this.views.titlebar?.render();
        this.showLastOpenFile();
    }

    updateApp() {
        if (UpdateModel.updateStatus === 'ready' && !Launcher && !this.model.files.hasOpenFiles()) {
            window.location.reload();
        }
    }

    showCmdPalette() {
        if (!this.model.files.hasOpenFiles() || this.views.cmdPalette) {
            return;
        }
        const filter = new SelectEntryFilter({}, this.model, this.model.files);
        const view = new SelectEntryView({
            isAutoType: false,
            filter,
            topMessage: Locale.cmdPaletteTopMessage
        });
        view.on('result', (result) => {
            view.off('result');
            view.remove();
            this.views.cmdPalette = null;
            const entry = result && result.entry;
            if (!entry) {
                return;
            }
            if (result.select) {
                const visible = this.model.getEntries();
                if (!visible.get(entry.id)) {
                    // attachments must be reset explicitly: setFilter keeps it when undefined
                    this.model.setFilter({ attachments: false });
                }
                Events.emit('select-entry', entry);
                return;
            }
            const password = entry.password;
            const text = password && password.isProtected ? password.getText() : password;
            if (text) {
                if (!CopyPaste.simpleCopy) {
                    CopyPaste.createHiddenInput(text);
                }
                const copyRes = CopyPaste.copy(text);
                if (copyRes && this.model.settings.lockOnCopy) {
                    setTimeout(() => {
                        Events.emit('lock-workspace');
                    }, Timeouts.BeforeAutoLock);
                }
            }
        });
        view.render();
        this.views.cmdPalette = view;
    }

    fileListUpdated() {
        if (this.model.files.hasOpenFiles()) {
            this.showEntries();
        } else {
            this.showOpenFile();
            this.selectLastOpenFile();
        }
    }

    showFileSettings(e) {
        const menuItem = this.model.menu.filesSection.items.find(
            (item) => item.file.id === e.fileId
        );
        if (this.views.settings) {
            if (this.views.settings.file === menuItem.file) {
                this.showEntries();
            } else {
                this.model.menu.select({ item: menuItem });
            }
        } else {
            this.showSettings(menuItem);
        }
    }

    toggleOpenFile() {
        if (this.views.open) {
            if (this.model.files.hasOpenFiles()) {
                this.showEntries();
            }
        } else {
            this.showOpenFile();
        }
    }

    windowResize() {
        Events.emit('page-geometry', { source: 'window' });
    }

    windowBlur(e) {
        if (e.target === window) {
            Events.emit('page-blur');
        }
    }

    enterFullScreen() {
        this.$el.addClass('fullscreen');
    }

    leaveFullScreen() {
        this.$el.removeClass('fullscreen');
    }

    escPressed() {
        if (this.views.open && this.model.files.hasOpenFiles()) {
            this.showEntries();
        }
    }

    backspacePressed(e) {
        if (e.target === document.body) {
            e.preventDefault();
        }
    }

    openDevTools() {
        if (Launcher && Launcher.devTools) {
            Launcher.openDevTools();
        }
    }

    selectAll() {
        this.menuSelect({ item: this.model.menu.allItemsSection.items[0] });
    }

    menuSelect(opt) {
        this.model.menu.select(opt);
        if (opt.item && opt.item.filterKey && this.views.settings) {
            this.showEntries();
        } else if (this.views.panel && !this.views.panel.isHidden()) {
            this.showEntries();
        }
    }

    selectLastOpenFile() {
        const fileToShow = this.model.fileInfos[0];
        if (fileToShow) {
            this.views.open.showOpenFileInfo(fileToShow);
        }
    }

    saveAll() {
        this.model.files.forEach(function (file) {
            this.model.syncFile(file);
        }, this);
    }

    setupAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        if (this.model.settings.autoSaveInterval > 0) {
            this.autoSaveTimer = setInterval(
                this.saveAll.bind(this),
                this.model.settings.autoSaveInterval * 1000 * 60
            );
        }
    }

    remoteKeyChanged(e) {
        this.showKeyChange(e.file, { remote: true });
    }

    keyChangePending(e) {
        this.showKeyChange(e.file, { expired: true });
    }

    keyChangeAccept(e) {
        this.showEntries();
        if (e.expired) {
            e.file.setPassword(e.password);
            if (e.keyFileData && e.keyFileName) {
                e.file.setKeyFile(e.keyFileData, e.keyFileName);
            } else {
                e.file.removeKeyFile();
            }
        } else {
            this.model.syncFile(e.file, {
                remoteKey: {
                    password: e.password,
                    keyFileName: e.keyFileName,
                    keyFileData: e.keyFileData
                }
            });
        }
    }

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
                    this.showEntries();
                } else {
                    this.showLastOpenFile();
                    this.views.open.toggleMore();
                }
            } else {
                this.model.menu.select({ item: menuItem });
            }
        } else {
            this.showSettings();
            if (menuItem) {
                this.model.menu.select({ item: menuItem });
            }
        }
    }

    toggleMenu() {
        this.views.menu.switchVisibility();
    }

    toggleDetails(visible) {
        this.$el.toggleClass('app--details-visible', visible);
        this.views.menu.switchVisibility(false);
    }

    showOpenIfNotThere() {
        if (!this.views.open) {
            this.showLastOpenFile();
        }
    }

    editGroup(group) {
        if (group && !(this.views.panel instanceof GrpView)) {
            this.showEditGroup(group);
        } else {
            this.showEntries();
        }
    }

    editTag(tag) {
        if (tag && !(this.views.panel instanceof TagView)) {
            this.showEditTag();
            this.views.panel.showTag(tag);
        } else {
            this.showEntries();
        }
    }

    editGeneratorPresets() {
        if (!(this.views.panel instanceof GeneratorPresetsView)) {
            if (this.views.settings) {
                this.showEntries();
            }
            this.showPanelView(new GeneratorPresetsView(this.model));
        } else {
            this.showEntries();
        }
    }

    showSingleInstanceAlert() {
        this.hideOpenFile();
        Alerts.error({
            header: Locale.appTabWarn,
            body: Locale.appTabWarnBody,
            esc: false,
            enter: false,
            click: false,
            buttons: []
        });
    }

    dragover(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'none';
    }

    drop(e) {
        e.preventDefault();
    }

    setTheme() {
        SettingsManager.setTheme(this.model.settings.theme);
    }

    setFontSize() {
        SettingsManager.setFontSize(this.model.settings.fontSize);
    }

    setLocale() {
        SettingsManager.setLocale(this.model.settings.locale);
        if (this.views.settings.isVisible()) {
            this.hideSettings();
            this.showSettings();
        }
        this.$el.find('.app__beta:first').text(Locale.appBeta);
    }

    extLinkClick(e) {
        if (Launcher) {
            e.preventDefault();
            const link = e.target.closest('a');
            if (link?.href) {
                Launcher.openLink(link.href);
            }
        }
    }

    bodyClick(e) {
        IdleTracker.regUserAction();
        Events.emit('click', e);
    }
}

Object.assign(AppView.prototype, AppViewPanelsMixin);
Object.assign(AppView.prototype, AppViewLockMixin);

export { AppView };
