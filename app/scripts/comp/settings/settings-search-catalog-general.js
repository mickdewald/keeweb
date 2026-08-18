import { item } from 'comp/settings/settings-search-item';

const SettingsSearchCatalogGeneral = [
    item('general', 'general', 'top', null, 'setGenTitle', 'menuSetGeneral', [
        'settings',
        'general',
        'allgemein'
    ]),
    item('appearance', 'general', 'appearance', '#appearance', 'setGenAppearance', 'setGenTitle', [
        'theme',
        'ui',
        'oberfläche'
    ]),
    item(
        'locale',
        'general',
        'appearance',
        '#settings__general-locale',
        'setGenLocale',
        'setGenAppearance',
        ['language', 'sprache', 'lang']
    ),
    item(
        'theme',
        'general',
        'appearance',
        '.settings__general-themes',
        'setGenTheme',
        'setGenAppearance',
        ['dark', 'light', 'dunkel', 'hell']
    ),
    item(
        'auto-switch-theme',
        'general',
        'appearance',
        '#settings__general-auto-switch-theme',
        'setGenAutoSwitchTheme',
        'setGenAppearance',
        ['theme', 'system']
    ),
    item(
        'font-size',
        'general',
        'appearance',
        '#settings__general-font-size',
        'setGenFontSize',
        'setGenAppearance',
        ['font', 'schrift']
    ),
    item(
        'titlebar-style',
        'general',
        'appearance',
        '#settings__general-titlebar-style',
        'setGenTitlebarStyle',
        'setGenAppearance',
        ['window', 'titlebar', 'fenster']
    ),
    item(
        'show-subgroups',
        'general',
        'appearance',
        '#settings__general-expand',
        'setGenShowSubgroups',
        'setGenAppearance'
    ),
    item(
        'table-view',
        'general',
        'appearance',
        '#settings__general-table-view',
        'setGenTableView',
        'setGenAppearance',
        ['table', 'tabelle']
    ),
    item(
        'colorful-icons',
        'general',
        'appearance',
        '#settings__general-colorful-icons',
        'setGenColorfulIcons',
        'setGenAppearance',
        [
            'colorful',
            'colour',
            'color',
            'icons',
            'grayscale',
            'grey',
            'gray',
            'farbig',
            'farbe',
            'bunt',
            'symbole',
            'liste'
        ]
    ),
    item('function', 'general', 'function', '#function', 'setGenFunction', 'setGenTitle', [
        'function',
        'arbeitsweise'
    ]),
    item(
        'auto-save',
        'general',
        'function',
        '#settings__general-auto-save',
        'setGenAutoSyncOnClose',
        'setGenFunction',
        ['save', 'sync', 'autosave']
    ),
    item(
        'auto-save-interval',
        'general',
        'function',
        '#settings__general-auto-save-interval',
        'setGenAutoSyncTimer',
        'setGenFunction',
        ['save', 'sync', 'timer']
    ),
    item(
        'remember-key-files',
        'general',
        'function',
        '#settings__general-remember-key-files',
        'setGenRememberKeyFiles',
        'setGenFunction',
        ['keyfile', 'key file']
    ),
    item(
        'clipboard',
        'general',
        'function',
        '#settings__general-clipboard',
        'setGenClearClip',
        'setGenFunction',
        ['clipboard', 'zwischenablage']
    ),
    item(
        'minimize-on-close',
        'general',
        'function',
        '#settings__general-minimize',
        'setGenMinInstead',
        'setGenFunction',
        ['minimize', 'minimieren']
    ),
    item(
        'minimize-on-copy',
        'general',
        'function',
        '#settings__general-minimize-on-field-copy',
        'setGenMinOnFieldCopy',
        'setGenFunction',
        ['minimize', 'copy']
    ),
    item(
        'direct-autotype',
        'general',
        'function',
        '#settings__general-direct-autotype',
        'setGenDirectAutotype',
        'setGenFunction',
        ['autotype', 'auto-type']
    ),
    item(
        'autotype-title-filter',
        'general',
        'function',
        '#settings__general-autotype-title-filter',
        'setGenAutoTypeTitleFilterEnabled',
        'setGenFunction',
        ['autotype']
    ),
    item(
        'field-label-autotype',
        'general',
        'function',
        '#settings__general-field-label-dblclick-autotype',
        'setGenFieldLabelDblClickAutoType',
        'setGenFunction',
        ['autotype', 'double-click']
    ),
    item(
        'use-markdown',
        'general',
        'function',
        '#settings__general-use-markdown',
        'setGenUseMarkdown',
        'setGenFunction',
        ['markdown', 'notes']
    ),
    item(
        'group-icon-for-entries',
        'general',
        'function',
        '#settings__general-use-group-icon-for-entries',
        'setGenUseGroupIconForEntries',
        'setGenFunction',
        ['icon', 'group']
    ),
    item(
        'touch-id',
        'general',
        'function',
        '#settings__general-device-owner-auth',
        'setGenTouchId',
        'setGenFunction',
        ['touch id', 'biometric', 'fingerprint', 'face id']
    ),
    item(
        'touch-id-timeout',
        'general',
        'function',
        '#settings__general-device-owner-auth-timeout',
        'setGenTouchIdPass',
        'setGenFunction',
        ['touch id', 'password']
    ),
    item('audit', 'general', 'audit', '#audit', 'setGenAudit', 'setGenTitle', [
        'audit',
        'security'
    ]),
    item(
        'audit-passwords',
        'general',
        'audit',
        '#settings__general-audit-passwords',
        'setGenAuditPasswords',
        'setGenAudit',
        ['password', 'strength', 'weak']
    ),
    item(
        'audit-entropy',
        'general',
        'audit',
        '#settings__general-audit-password-entropy',
        'setGenAuditPasswordEntropy',
        'setGenAudit',
        ['entropy', 'random']
    ),
    item(
        'exclude-pins',
        'general',
        'audit',
        '#settings__general-exclude-pins-from-audit',
        'setGenExcludePinsFromAudit',
        'setGenAudit',
        ['pin']
    ),
    item(
        'hibp',
        'general',
        'audit',
        '#settings__general-check-passwords-on-hibp',
        'setGenCheckPasswordsOnHIBP',
        'setGenAudit',
        ['hibp', 'pwned', 'breach', 'have i been']
    ),
    item(
        'password-age',
        'general',
        'audit',
        '#settings__general-audit-password-age',
        'setGenAuditPasswordAge',
        'setGenAudit',
        ['old', 'age', 'expired']
    ),
    item('lock', 'general', 'lock', '#lock', 'setGenLock', 'setGenTitle', [
        'lock',
        'autolock',
        'sperren'
    ]),
    item(
        'idle-lock',
        'general',
        'lock',
        '#settings__general-idle-minutes',
        'setGenLockInactive',
        'setGenLock',
        ['idle', 'timeout']
    ),
    item(
        'lock-minimize',
        'general',
        'lock',
        '#settings__general-lock-on-minimize',
        'setGenLockMinimize',
        'setGenLock'
    ),
    item(
        'lock-copy',
        'general',
        'lock',
        '#settings__general-lock-on-copy',
        'setGenLockCopy',
        'setGenLock'
    ),
    item(
        'lock-autotype',
        'general',
        'lock',
        '#settings__general-lock-on-auto-type',
        'setGenLockAutoType',
        'setGenLock'
    ),
    item(
        'lock-os',
        'general',
        'lock',
        '#settings__general-lock-on-os-lock',
        'setGenLockOrSleep',
        'setGenLock',
        ['sleep', 'screensaver']
    ),
    item('storage', 'general', 'storage', '#storage', 'setGenStorage', 'setGenTitle', [
        'storage',
        'cloud',
        'dropbox',
        'webdav',
        'gdrive',
        'onedrive'
    ]),
    item(
        'offline-storage',
        'general',
        'storage',
        '#settings__general-disable-offline-storage',
        'setGenDisableOfflineStorage',
        'setGenStorage',
        ['offline', 'cache']
    ),
    item(
        'short-lived-token',
        'general',
        'storage',
        '#settings__general-short-lived-storage-token',
        'setGenShortLivedStorageToken',
        'setGenStorage',
        ['token', 'session']
    ),
    item('advanced', 'general', 'advanced', '#advanced', 'advanced', 'setGenTitle', [
        'advanced',
        'logs',
        'devtools'
    ]),
    item(
        'show-advanced',
        'general',
        'advanced',
        '.settings__general-show-advanced',
        'setGenShowAdvanced',
        'advanced'
    ),
    item(
        'dev-tools',
        'general',
        'advanced',
        '.settings__general-dev-tools-link',
        'setGenDevTools',
        'advanced',
        ['devtools', 'console']
    ),
    item(
        'app-logs',
        'general',
        'advanced',
        '.settings__general-show-logs-link',
        'setGenShowAppLogs',
        'advanced',
        ['logs']
    ),
    item(
        'reload-app',
        'general',
        'advanced',
        '.settings__general-reload-app-link',
        'setGenReloadApp',
        'advanced',
        ['reload', 'restart']
    )
];

export { SettingsSearchCatalogGeneral };
