import { Features } from 'util/features';
import { Launcher } from 'comp/launcher';
import { UsbListener } from 'comp/app/usb-listener';
import { item } from 'comp/settings/settings-search-item';
import { SettingsSearchCatalogGeneral } from 'comp/settings/settings-search-catalog-general';

function devicesVisible() {
    return !!(Launcher && UsbListener.supported);
}

const SettingsSearchCatalog = [
    ...SettingsSearchCatalogGeneral,
    item('shortcuts', 'shortcuts', null, null, 'shortcuts', 'setShTitle', [
        'keyboard',
        'hotkey',
        'tastenkürzel'
    ]),
    item(
        'browser',
        'browser',
        null,
        null,
        'menuSetBrowser',
        'setBrowserTitle',
        ['extension', 'chrome', 'firefox', 'safari'],
        () => Features.supportsBrowserExtensions
    ),
    item(
        'browser-focus-locked',
        'browser',
        null,
        '#settings__browser-focus-if-locked',
        'setBrowserFocusIfLocked',
        'menuSetBrowser',
        ['extension', 'focus'],
        () => Features.supportsBrowserExtensions
    ),
    item(
        'browser-focus-empty',
        'browser',
        null,
        '#settings__browser-focus-if-empty',
        'setBrowserFocusIfEmpty',
        'menuSetBrowser',
        ['extension', 'focus'],
        () => Features.supportsBrowserExtensions
    ),
    item('plugins', 'plugins', null, null, 'plugins', 'setPlInstallTitle', [
        'plugin',
        'theme',
        'language'
    ]),
    item(
        'devices',
        'devices',
        null,
        null,
        'menuSetDevices',
        'setDevicesTitle',
        ['usb', 'yubikey', 'otp'],
        devicesVisible
    ),
    item(
        'enable-usb',
        'devices',
        null,
        '#settings__devices-enable-usb',
        'setDevicesEnableUsb',
        'menuSetDevices',
        ['usb'],
        devicesVisible
    ),
    item(
        'yubikey-show-icon',
        'devices',
        null,
        '#settings__yubikey-show-icon',
        'setDevicesYubiKeyOtpShowIcon',
        'menuSetDevices',
        ['yubikey', 'otp'],
        devicesVisible
    ),
    item(
        'yubikey-match',
        'devices',
        null,
        '#settings__yubikey-match-entries',
        'setDevicesYubiKeyOtpMatchEntries',
        'menuSetDevices',
        ['yubikey', 'otp'],
        devicesVisible
    ),
    item(
        'yubikey-auto-open',
        'devices',
        null,
        '#settings__yubikey-auto-open',
        'setDevicesYubiKeyOtpAutoOpen',
        'menuSetDevices',
        ['yubikey', 'otp'],
        devicesVisible
    ),
    item('file-backup', 'file', null, '#settings__file-backup-enabled', 'setFileBackups', 'file', [
        'backup',
        'backups',
        'sicherung',
        'bak',
        'kopie'
    ]),
    item('file-master-pass', 'file', null, '#settings__file-master-pass', 'setFilePass', 'file', [
        'master',
        'password',
        'passwort',
        'key'
    ]),
    item('about', 'about', null, null, 'menuSetAbout', 'setAboutTitle', [
        'about',
        'version',
        'info'
    ]),
    item('help', 'help', null, null, 'help', 'help', ['help', 'hilfe', 'faq'])
];

export { SettingsSearchCatalog };
