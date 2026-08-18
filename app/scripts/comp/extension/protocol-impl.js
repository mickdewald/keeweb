import * as kdbxweb from 'kdbxweb';
import { Events } from 'framework/events';
import { Launcher } from 'comp/launcher';
import { box as tweetnaclBox } from 'tweetnacl';
import { PasswordGenerator } from 'util/generators/password-generator';
import { GeneratorPresets } from 'comp/app/generator-presets';
import { Alerts } from 'comp/ui/alerts';
import { Locale } from 'util/locale';
import { RuntimeInfo } from 'const/runtime-info';
import { KnownAppVersions } from 'const/known-app-versions';
import { ExtensionConnectView } from 'views/extension/extension-connect-view';
import { ExtensionCreateGroupView } from 'views/extension/extension-create-group-view';
import { ExtensionSaveEntryView } from 'views/extension/extension-save-entry-view';
import { RuntimeDataModel } from 'models/runtime-data-model';
import { AppSettingsModel } from 'models/app-settings-model';
import { Timeouts } from 'const/timeouts';
import { SelectEntryView } from 'views/select/select-entry-view';
import { SelectEntryFieldView } from 'views/select/select-entry-field-view';
import { SelectEntryFilter } from 'comp/app/select-entry-filter';
import { createProtocolReadHandlers } from 'comp/extension/protocol-read-handlers';
import { createProtocolWriteHandlers } from 'comp/extension/protocol-write-handlers';

const KeeWebAssociationId = 'KeeWeb';
const KeeWebHash = '398d9c782ec76ae9e9877c2321cbda2b31fc6d18ccf0fed5ca4bd746bab4d64a'; // sha256('KeeWeb')
const ExtensionGroupIconId = 1;
const DefaultExtensionGroupName = 'Browser';
const ExtensionGroupNames = new Set(['KeePassXC-Browser Passwords', DefaultExtensionGroupName]);

const Errors = {
    noOpenFiles: {
        message: Locale.extensionErrorNoOpenFiles,
        code: '1'
    },
    userRejected: {
        message: Locale.extensionErrorUserRejected,
        code: '6'
    },
    noMatches: {
        message: Locale.extensionErrorNoMatches,
        code: '15'
    }
};

const connectedClients = new Map();

let logger;
let appModel;
let sendEvent;

function setupListeners() {
    Events.on('file-opened', () => {
        sendEvent({ action: 'database-unlocked' });
    });
    Events.on('one-file-closed', () => {
        if (!appModel.files.hasOpenFiles()) {
            sendEvent({ action: 'database-locked' });
        }
    });
    Events.on('all-files-closed', () => {
        sendEvent({ action: 'database-locked' });
    });
}

function incrementNonce(nonce) {
    // from libsodium/utils.c, like it is in KeePassXC
    let i = 0;
    let c = 1;
    for (; i < nonce.length; ++i) {
        c += nonce[i];
        nonce[i] = c;
        c >>= 8;
    }
}

function getClient(request) {
    if (!request.clientID) {
        throw new Error('Empty clientID');
    }
    const client = connectedClients.get(request.clientID);
    if (!client) {
        throw new Error(`Client not connected: ${request.clientID}`);
    }
    return client;
}

function decryptRequest(request) {
    const client = getClient(request);

    if (!request.nonce) {
        throw new Error('Empty nonce');
    }
    if (!request.message) {
        throw new Error('Empty message');
    }

    const nonce = kdbxweb.ByteUtils.base64ToBytes(request.nonce);
    const message = kdbxweb.ByteUtils.base64ToBytes(request.message);

    const data = tweetnaclBox.open(message, nonce, client.publicKey, client.keys.secretKey);
    if (!data) {
        throw new Error('Failed to decrypt data');
    }

    const json = new TextDecoder().decode(data);
    const payload = JSON.parse(json);

    logger.debug('Extension -> KeeWeb -> (decrypted)', payload);

    if (!payload) {
        throw new Error('Empty request payload');
    }
    if (payload.action !== request.action) {
        throw new Error(`Bad action in decrypted payload`);
    }

    return payload;
}

function encryptResponse(request, payload) {
    logger.debug('KeeWeb -> Extension (decrypted)', payload);

    const nonceBytes = kdbxweb.ByteUtils.base64ToBytes(request.nonce);
    incrementNonce(nonceBytes);
    const nonce = kdbxweb.ByteUtils.bytesToBase64(nonceBytes);

    const client = getClient(request);

    payload.nonce = nonce;

    const json = JSON.stringify(payload);
    const data = new TextEncoder().encode(json);

    const encrypted = tweetnaclBox(data, nonceBytes, client.publicKey, client.keys.secretKey);

    const message = kdbxweb.ByteUtils.bytesToBase64(encrypted);

    return {
        action: request.action,
        message,
        nonce
    };
}

function makeError(def) {
    const e = new Error(def.message);
    e.code = def.code;
    return e;
}

function ensureAtLeastOneFileIsOpen() {
    if (!appModel.files.hasOpenFiles()) {
        throw makeError(Errors.noOpenFiles);
    }
}

async function checkContentRequestPermissions(request) {
    if (!appModel.files.hasOpenFiles()) {
        if (AppSettingsModel.extensionFocusIfLocked) {
            try {
                focusKeeWeb();
                await appModel.unlockAnyFile(
                    'extensionUnlockMessage',
                    Timeouts.KeeWebConnectRequest
                );
            } catch {
                throw makeError(Errors.noOpenFiles);
            }
        } else {
            throw makeError(Errors.noOpenFiles);
        }
    }

    const client = getClient(request);
    if (client.permissions) {
        return;
    }

    if (Alerts.alertDisplayed) {
        throw new Error(Locale.extensionErrorAlertDisplayed);
    }

    focusKeeWeb();

    const config = RuntimeDataModel.extensionConnectConfig;
    const files = appModel.files.map((f) => ({
        id: f.id,
        name: f.name,
        checked: !config || config.allFiles || config.files.includes(f.id)
    }));
    if (!files.some((f) => f.checked)) {
        for (const f of files) {
            f.checked = true;
        }
    }

    const extensionConnectView = new ExtensionConnectView({
        extensionName: getHumanReadableExtensionName(client),
        identityVerified: !Launcher,
        files,
        allFiles: config?.allFiles ?? true,
        askGet: config?.askGet || 'multiple'
    });

    try {
        await alertWithTimeout({
            header: Locale.extensionConnectHeader,
            icon: 'exchange-alt',
            buttons: [Alerts.buttons.allow, Alerts.buttons.deny],
            view: extensionConnectView,
            wide: true,
            opaque: true
        });
    } catch (e) {
        client.permissionsDenied = true;
        Events.emit('browser-extension-sessions-changed');
        throw e;
    }

    RuntimeDataModel.extensionConnectConfig = extensionConnectView.config;
    client.permissions = extensionConnectView.config;
    Events.emit('browser-extension-sessions-changed');
}

function alertWithTimeout(config) {
    return new Promise((resolve, reject) => {
        let inactivityTimer = 0;

        const alert = Alerts.alert({
            ...config,
            enter: 'yes',
            esc: '',
            success: (res) => {
                clearTimeout(inactivityTimer);
                resolve(res);
            },
            cancel: () => {
                clearTimeout(inactivityTimer);
                reject(makeError(Errors.userRejected));
            }
        });

        inactivityTimer = setTimeout(() => {
            alert.closeWithResult('');
        }, Timeouts.KeeWebConnectRequest);
    });
}

function getAvailableFiles(request) {
    const client = getClient(request);
    if (!client.permissions) {
        return;
    }

    const files = appModel.files.filter(
        (file) =>
            file.active &&
            (client.permissions.allFiles || client.permissions.files.includes(file.id))
    );
    if (!files.length) {
        throw makeError(Errors.noOpenFiles);
    }

    return files;
}

function getVersion(request) {
    return isKeePassXcBrowser(request) ? KnownAppVersions.KeePassXC : RuntimeInfo.version;
}

function isKeeWebConnect(request) {
    return getClient(request).connection.extensionName === 'KeeWeb Connect';
}

function isKeePassXcBrowser(request) {
    return getClient(request).connection.extensionName === 'KeePassXC-Browser';
}

function getHumanReadableExtensionName(client) {
    return client.connection.appName
        ? `${client.connection.extensionName} (${client.connection.appName})`
        : client.connection.extensionName;
}

function focusKeeWeb() {
    logger.debug('Focus KeeWeb');
    if (Launcher) {
        if (!Launcher.isAppFocused()) {
            Launcher.showMainWindow();
        }
    } else {
        sendEvent({ action: 'attention-required' });
    }
}

let ProtocolHandlers;

function createProtocolHandlers() {
    const protocolContext = {
        kdbxweb,
        Events,
        Launcher,
        tweetnaclBox,
        PasswordGenerator,
        GeneratorPresets,
        Alerts,
        Locale,
        AppSettingsModel,
        Timeouts,
        SelectEntryView,
        SelectEntryFieldView,
        SelectEntryFilter,
        KeeWebAssociationId,
        KeeWebHash,
        Errors,
        connectedClients,
        logger,
        appModel,
        incrementNonce,
        getClient,
        decryptRequest,
        encryptResponse,
        makeError,
        ensureAtLeastOneFileIsOpen,
        checkContentRequestPermissions,
        getAvailableFiles,
        getVersion,
        isKeeWebConnect,
        getHumanReadableExtensionName,
        focusKeeWeb,
        ExtensionCreateGroupView,
        ExtensionSaveEntryView,
        RuntimeDataModel,
        ExtensionGroupIconId,
        DefaultExtensionGroupName,
        ExtensionGroupNames,
        alertWithTimeout
    };

    return {
        ...createProtocolReadHandlers(protocolContext),
        ...createProtocolWriteHandlers(protocolContext)
    };
}

const ProtocolImpl = {
    init(vars) {
        appModel = vars.appModel;
        logger = vars.logger;
        sendEvent = vars.sendEvent;
        ProtocolHandlers = createProtocolHandlers();

        setupListeners();
    },

    cleanup() {
        const wasNotEmpty = connectedClients.size;

        connectedClients.clear();

        if (wasNotEmpty) {
            Events.emit('browser-extension-sessions-changed');
        }
    },

    deleteConnection(connectionId) {
        for (const [clientId, client] of connectedClients.entries()) {
            if (client.connection.connectionId === connectionId) {
                connectedClients.delete(clientId);
            }
        }
        Events.emit('browser-extension-sessions-changed');
    },

    getClientPermissions(clientId) {
        return connectedClients.get(clientId)?.permissions;
    },

    setClientPermissions(clientId, permissions) {
        const client = connectedClients.get(clientId);
        if (client?.permissions) {
            client.permissions = { ...client.permissions, ...permissions };
        }
    },

    errorToResponse(e, request) {
        return {
            action: request?.action,
            error: e.message || 'Unknown error',
            errorCode: e.code || 0
        };
    },

    async handleRequest(request, connectionInfo) {
        const appWindowWasFocused = Launcher?.isAppFocused();

        let result;
        try {
            const handler = ProtocolHandlers[request.action];
            if (!handler) {
                throw new Error(`Handler not found: ${request.action}`);
            }
            result = await handler(request, connectionInfo);
            if (!result) {
                throw new Error(`Handler returned an empty result: ${request.action}`);
            }
        } catch (e) {
            if (!e.code) {
                logger.error(`Error in handler ${request.action}`, e);
            }
            result = this.errorToResponse(e, request);
        }

        if (!appWindowWasFocused && Launcher?.isAppFocused()) {
            Launcher.hideApp();
        }

        return result;
    },

    get sessions() {
        return [...connectedClients.entries()]
            .map(([clientId, client]) => ({
                clientId,
                connectionId: client.connection.connectionId,
                appName: client.connection.appName,
                extensionName: client.connection.extensionName,
                connectedDate: client.stats.connectedDate,
                passwordsRead: client.stats.passwordsRead,
                passwordsWritten: client.stats.passwordsWritten,
                permissions: client.permissions,
                permissionsDenied: client.permissionsDenied
            }))
            .sort((x, y) => y.connectedDate - x.connectedDate);
    }
};

export { ProtocolImpl };
