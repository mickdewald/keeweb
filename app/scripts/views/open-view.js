import * as kdbxweb from 'kdbxweb';
import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { Storage } from 'storage';
import { DropboxChooser } from 'comp/app/dropbox-chooser';
import { TouchIdRecovery } from 'comp/app/touch-id-recovery';
import { FocusDetector } from 'comp/browser/focus-detector';
import { KeyHandler } from 'comp/browser/key-handler';
import { SecureInput } from 'comp/browser/secure-input';
import { Launcher } from 'comp/launcher';
import { Alerts } from 'comp/ui/alerts';
import { UsbListener } from 'comp/app/usb-listener';
import { YubiKey } from 'comp/app/yubikey';
import { Keys } from 'const/keys';
import { Comparators } from 'util/data/comparators';
import { Features } from 'util/features';
import { UrlFormat } from 'util/formatting/url-format';
import { Locale } from 'util/locale';
import { Logger } from 'util/logger';
import { InputFx } from 'util/ui/input-fx';
import { OpenConfigView } from 'views/open-config-view';
import { StorageFileListView } from 'views/storage-file-list-view';
import { OpenChalRespView } from 'views/open-chal-resp-view';
import { omit } from 'util/fn';
import { GeneratorView } from 'views/generator-view';
import { NativeModules } from 'comp/launcher/native-modules';
import template from 'templates/open.hbs';
import { createOpenViewFileInputMixin } from 'views/open-view-file-input';
import { createOpenViewOperationsMixin } from 'views/open-view-operations';
import { createOpenViewUnlockMixin } from 'views/open-view-unlock';

const logger = new Logger('open-view');

class OpenView extends View {
    parent = '.app__body';
    modal = 'open';

    template = template;

    events = {
        'change .open__file-ctrl': 'fileSelected',
        'click .open__icon-open': 'openFile',
        'click .open__icon-new': 'createNew',
        'click .open__icon-demo': 'createDemo',
        'click .open__icon-yubikey': 'openYubiKey',
        'click .open__icon-more': 'toggleMore',
        'click .open__icon-storage': 'openStorage',
        'click .open__icon-settings': 'openSettings',
        'click .open__pass-input[readonly]': 'openFile',
        'input .open__pass-input': 'inputInput',
        'keydown .open__pass-input': 'inputKeydown',
        'keyup .open__pass-input': 'inputKeyup',
        'keypress .open__pass-input': 'inputKeypress',
        'click .open__pass-enter-btn': 'openDb',
        'click .open__settings-key-file': 'openKeyFile',
        'click .open__settings-yubikey': 'selectYubiKeyChalResp',
        'click .open__last-item': 'openLast',
        'click .open__icon-generate': 'toggleGenerator',
        'click .open__message-cancel-btn': 'openMessageCancelClick',
        dragover: 'dragover',
        dragleave: 'dragleave',
        drop: 'drop'
    };

    params = null;
    passwordInput = null;
    busy = false;
    currentSelectedIndex = -1;
    encryptedPassword = null;
    autoUnlockAttemptedRef = null;

    constructor(model) {
        super(model);
        window.$ = $;
        this.resetParams();
        this.passwordInput = new SecureInput();
        this.onKey(Keys.DOM_VK_Z, this.undoKeyPress, KeyHandler.SHORTCUT_ACTION, 'open');
        this.onKey(Keys.DOM_VK_TAB, this.tabKeyPress, null, 'open');
        this.onKey(Keys.DOM_VK_ENTER, this.enterKeyPress, null, 'open');
        this.onKey(Keys.DOM_VK_RETURN, this.enterKeyPress, null, 'open');
        this.onKey(Keys.DOM_VK_DOWN, this.moveOpenFileSelectionDown, null, 'open');
        this.onKey(Keys.DOM_VK_UP, this.moveOpenFileSelectionUp, null, 'open');
        this.listenTo(Events, 'main-window-focus', this.windowFocused.bind(this));
        this.listenTo(Events, 'usb-devices-changed', this.usbDevicesChanged.bind(this));
        this.listenTo(Events, 'unlock-message-changed', this.unlockMessageChanged.bind(this));
        this.once('remove', () => {
            this.passwordInput.reset();
        });
        this.listenTo(Events, 'user-idle', this.userIdle);
    }

    render() {
        if (this.dragTimeout) {
            clearTimeout(this.dragTimeout);
        }
        const storageProviders = [];
        if (this.model.settings.canOpenStorage) {
            Object.keys(Storage).forEach((name) => {
                const prv = Storage[name];
                if (!prv.system && prv.enabled) {
                    storageProviders.push(prv);
                }
            });
        }
        storageProviders.sort((x, y) => (x.uipos || Infinity) - (y.uipos || Infinity));
        const showMore =
            storageProviders.length ||
            this.model.settings.canOpenSettings ||
            this.model.settings.canOpenGenerator;
        const showLogo =
            !showMore &&
            !this.model.settings.canOpen &&
            !this.model.settings.canCreate &&
            !(this.model.settings.canOpenDemo && !this.model.settings.demoOpened);
        const hasYubiKeys = !!UsbListener.attachedYubiKeys;
        const canOpenYubiKey =
            hasYubiKeys &&
            this.model.settings.canOpenOtpDevice &&
            this.model.settings.yubiKeyShowIcon &&
            !this.model.files.get('yubikey');
        const canUseChalRespYubiKey = hasYubiKeys && this.model.settings.yubiKeyShowChalResp;

        super.render({
            lastOpenFiles: this.getLastOpenFiles(),
            canOpenKeyFromDropbox: !Launcher && Storage.dropbox.enabled,
            demoOpened: this.model.settings.demoOpened,
            storageProviders,
            unlockMessageRes: this.model.unlockMessageRes,
            canOpen: this.model.settings.canOpen,
            canOpenDemo: this.model.settings.canOpenDemo,
            canOpenSettings: this.model.settings.canOpenSettings,
            canOpenGenerator: this.model.settings.canOpenGenerator,
            canCreate: this.model.settings.canCreate,
            canRemoveLatest: this.model.settings.canRemoveLatest,
            canOpenYubiKey,
            canUseChalRespYubiKey,
            showMore,
            showLogo
        });
        this.inputEl = this.$el.find('.open__pass-input');
        this.passwordInput.setElement(this.inputEl);
    }

    resetParams() {
        this.params = {
            id: null,
            name: '',
            storage: null,
            path: null,
            keyFileName: null,
            keyFileData: null,
            keyFilePath: null,
            fileData: null,
            rev: null,
            opts: null,
            chalResp: null
        };
    }

    windowFocused() {
        this.inputEl.focus();
        this.checkIfEncryptedPasswordDateIsValid();
        this.displayOpenDeviceOwnerAuth();
    }

    focusInput(focusOnMobile) {
        if (FocusDetector.hasFocus() && (focusOnMobile || !Features.isMobile)) {
            this.inputEl.focus();
        }
    }

    getLastOpenFiles() {
        return this.model.fileInfos.map((fileInfo) => {
            let icon = 'file-alt';
            const storage = Storage[fileInfo.storage];
            if (storage && storage.icon) {
                icon = storage.icon;
            }
            return {
                id: fileInfo.id,
                name: fileInfo.name,
                path: this.getDisplayedPath(fileInfo),
                icon
            };
        });
    }

    getDisplayedPath(fileInfo) {
        const storage = fileInfo.storage;
        if (storage === 'file' || storage === 'webdav') {
            return fileInfo.path;
        }
        return null;
    }

    showLocalFileAlert() {
        if (this.model.settings.skipOpenLocalWarn) {
            return;
        }
        Alerts.alert({
            header: Locale.openLocalFile,
            body: Locale.openLocalFileBody,
            icon: 'file-alt',
            buttons: [
                { result: 'skip', title: Locale.openLocalFileDontShow, error: true },
                { result: 'ok', title: Locale.alertOk }
            ],
            click: '',
            esc: '',
            enter: '',
            success: (res) => {
                this.focusInput();
                if (res === 'skip') {
                    this.model.settings.skipOpenLocalWarn = true;
                }
            }
        });
    }
}

Object.assign(
    OpenView.prototype,
    createOpenViewUnlockMixin({
        Events,
        Alerts,
        UsbListener,
        YubiKey,
        Features,
        Locale,
        OpenChalRespView,
        GeneratorView
    })
);
Object.assign(
    OpenView.prototype,
    createOpenViewOperationsMixin({
        kdbxweb,
        Events,
        Storage,
        TouchIdRecovery,
        Alerts,
        Comparators,
        UrlFormat,
        Locale,
        InputFx,
        OpenConfigView,
        StorageFileListView,
        omit,
        NativeModules,
        logger
    })
);
Object.assign(
    OpenView.prototype,
    createOpenViewFileInputMixin({
        kdbxweb,
        Events,
        DropboxChooser,
        FocusDetector,
        Launcher,
        Alerts,
        Keys,
        Locale,
        logger
    })
);

export { OpenView };
