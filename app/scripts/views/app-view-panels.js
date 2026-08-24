import { Events } from 'framework/events';
import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';
import { Logger } from 'util/logger';
import { CsvParser } from 'util/data/csv-parser';
import { DropdownView } from 'views/dropdown-view';
import { GrpView } from 'views/grp-view';
import { KeyChangeView } from 'views/key-change-view';
import { OpenView } from 'views/open-view';
import { SettingsView } from 'views/settings/settings-view';
import { TagView } from 'views/tag-view';
import { ImportCsvView } from 'views/import-csv-view';

const AppViewPanelsMixin = {
    showOpenFile() {
        this.hideContextMenu();
        this.views.menu.hide();
        this.views.menuDrag.$el.parent().hide();
        this.views.listWrap.hide();
        this.views.list.hide();
        this.views.listDrag.hide();
        this.views.details.hide();
        this.views.footer.hide();
        this.hidePanelView();
        this.hideSettings();
        this.hideOpenFile();
        this.hideKeyChange();
        this.hideImportCsv();
        this.views.open = new OpenView(this.model);
        this.views.open.render();
        this.views.open.on('close', () => {
            this.showEntries();
        });
    },

    showLastOpenFile() {
        this.showOpenFile();
        const lastOpenFile = this.model.fileInfos[0];
        if (lastOpenFile) {
            this.views.open.currentSelectedIndex = 0;
            this.views.open.showOpenFileInfo(lastOpenFile);
        }
    },

    launcherOpenFile(file) {
        if (file && file.data && /\.kdbx$/i.test(file.data)) {
            this.showOpenFile();
            this.views.open.showOpenLocalFile(file.data, file.key);
        }
    },

    showEntries() {
        if (this.model.settings.compactLayout) {
            this.views.menu.hide();
            this.views.menuDrag.$el.parent().hide();
        } else {
            this.views.menu.show();
            this.views.menuDrag.$el.parent().show();
        }
        this.views.listWrap.show();
        this.views.listDrag.show();
        this.views.details.show();
        this.views.footer.hide();
        this.hidePanelView();
        this.hideOpenFile();
        this.hideSettings();
        this.hideKeyChange();
        this.hideImportCsv();

        this.views.list.show();
    },

    hideOpenFile() {
        if (this.views.open) {
            this.views.open.remove();
            this.views.open = null;
        }
    },

    hidePanelView() {
        if (this.views.panel) {
            this.views.panel.remove();
            this.views.panel = null;
            this.panelEl.addClass('hide');
        }
    },

    showPanelView(view) {
        this.views.listWrap.hide();
        this.views.list.hide();
        this.views.listDrag.hide();
        this.views.details.hide();
        this.hidePanelView();
        view.render();
        this.views.panel = view;
        this.panelEl.removeClass('hide');
    },

    hideSettings() {
        if (this.views.settings) {
            this.model.menu.setMenu('app');
            this.views.settings.remove();
            this.views.settings = null;
        }
    },

    hideKeyChange() {
        if (this.views.keyChange) {
            this.views.keyChange.hide();
            this.views.keyChange = null;
        }
    },

    hideImportCsv() {
        if (this.views.importCsv) {
            this.views.importCsv.remove();
            this.views.importCsv = null;
        }
    },

    showSettings(selectedMenuItem) {
        this.model.menu.setMenu('settings');
        this.views.menu.show();
        this.views.menuDrag.$el.parent().show();
        this.views.listWrap.hide();
        this.views.list.hide();
        this.views.listDrag.hide();
        this.views.details.hide();
        this.hidePanelView();
        this.hideOpenFile();
        this.hideKeyChange();
        this.hideImportCsv();
        this.views.footer.hide();
        this.views.settings = new SettingsView(this.model);
        this.views.settings.render();
        if (!selectedMenuItem) {
            selectedMenuItem = this.model.menu.generalSection.items[0];
        }
        this.model.menu.select({ item: selectedMenuItem });
        this.views.menu.switchVisibility(false);
    },

    showEditGroup(group) {
        this.showPanelView(new GrpView(group));
    },

    showEditTag() {
        this.showPanelView(new TagView(this.model));
    },

    showKeyChange(file, viewConfig) {
        if (Alerts.alertDisplayed) {
            return;
        }
        if (this.views.keyChange && this.views.keyChange.model.remote) {
            return;
        }
        this.hideSettings();
        this.hidePanelView();
        this.views.menu.hide();
        this.views.listWrap.hide();
        this.views.list.hide();
        this.views.listDrag.hide();
        this.views.details.hide();
        this.views.keyChange = new KeyChangeView({
            file,
            expired: viewConfig.expired,
            remote: viewConfig.remote
        });
        this.views.keyChange.render();
        this.views.keyChange.on('accept', this.keyChangeAccept.bind(this));
        this.views.keyChange.on('cancel', this.showEntries.bind(this));
    },

    isContextMenuAllowed(e) {
        return ['input', 'textarea'].indexOf(e.target.tagName.toLowerCase()) < 0;
    },

    contextMenu(e) {
        if (this.isContextMenuAllowed(e)) {
            e.preventDefault();
        }
    },

    showContextMenu(e) {
        if (e.options && this.isContextMenuAllowed(e)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            if (this.views.contextMenu) {
                this.views.contextMenu.remove();
            }
            const menu = new DropdownView(e);
            menu.render({
                position: { left: e.pageX, top: e.pageY },
                options: e.options
            });
            menu.on('cancel', (e) => this.hideContextMenu());
            menu.on('select', (e) => this.contextMenuSelect(e));
            this.views.contextMenu = menu;
        }
    },

    hideContextMenu() {
        if (this.views.contextMenu) {
            this.views.contextMenu.remove();
            delete this.views.contextMenu;
        }
    },

    contextMenuSelect(e) {
        this.hideContextMenu();
        Events.emit('context-menu-select', e);
    },

    showImportCsv(file) {
        const reader = new FileReader();
        const logger = new Logger('import-csv');
        logger.info('Reading CSV...');
        reader.onload = (e) => {
            logger.info('Parsing CSV...');
            const ts = logger.ts();
            const parser = new CsvParser();
            let data;
            try {
                data = parser.parse(e.target.result);
            } catch (e) {
                logger.error('Error parsing CSV', e);
                Alerts.error({ header: Locale.openFailedRead, body: e.toString() });
                return;
            }
            logger.info(`Parsed CSV: ${data.rows.length} records, ${logger.ts(ts)}`);

            // TODO: refactor this
            this.hideSettings();
            this.hidePanelView();
            this.hideOpenFile();
            this.hideKeyChange();
            this.views.menu.hide();
            this.views.listWrap.hide();
            this.views.list.hide();
            this.views.listDrag.hide();
            this.views.details.hide();

            this.views.importCsv = new ImportCsvView(data, {
                appModel: this.model,
                fileName: file.name
            });
            this.views.importCsv.render();
            this.views.importCsv.on('cancel', () => {
                if (this.model.files.hasOpenFiles()) {
                    this.showEntries();
                } else {
                    this.showOpenFile();
                }
            });
            this.views.importCsv.on('done', () => {
                this.model.refresh();
                this.showEntries();
            });
        };
        reader.onerror = () => {
            Alerts.error({ header: Locale.openFailedRead });
        };
        reader.readAsText(file);
    }
};

export { AppViewPanelsMixin };
