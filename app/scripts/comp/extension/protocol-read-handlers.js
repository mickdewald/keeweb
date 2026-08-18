function createProtocolReadHandlers({
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
    focusKeeWeb
}) {
    async function findEntry(request, returnIfOneMatch, filterOptions) {
        const payload = decryptRequest(request);
        await checkContentRequestPermissions(request);

        if (!payload.url) {
            throw new Error('Empty url');
        }

        const files = getAvailableFiles(request);
        const client = getClient(request);

        const filter = new SelectEntryFilter(
            { url: payload.url, title: payload.title },
            appModel,
            files,
            filterOptions
        );
        filter.subdomains = false;

        let entries = filter.getEntries();

        filter.subdomains = true;

        let entry;

        if (entries.length) {
            if (
                entries.length === 1 &&
                returnIfOneMatch &&
                client.permissions.askGet === 'multiple'
            ) {
                entry = entries[0];
            }
        } else {
            entries = filter.getEntries();

            if (!entries.length) {
                if (AppSettingsModel.extensionFocusIfEmpty) {
                    filter.useUrl = false;
                    if (filter.title && AppSettingsModel.autoTypeTitleFilterEnabled) {
                        filter.useTitle = true;
                        entries = filter.getEntries();
                        if (!entries.length) {
                            filter.useTitle = false;
                        }
                    }
                } else {
                    throw makeError(Errors.noMatches);
                }
            }
        }

        if (!entry) {
            const extName = getHumanReadableExtensionName(client);
            const topMessage = Locale.extensionSelectPasswordFor.replace('{}', extName);
            const selectEntryView = new SelectEntryView({ filter, topMessage });

            focusKeeWeb();

            const inactivityTimer = setTimeout(() => {
                selectEntryView.emit('result', undefined);
            }, Timeouts.KeeWebConnectRequest);

            const result = await selectEntryView.showAndGetResult();

            clearTimeout(inactivityTimer);

            entry = result?.entry;
            if (!entry) {
                throw makeError(Errors.userRejected);
            }
        }

        client.stats.passwordsRead++;

        return entry;
    }

    return {
        'ping'({ data }) {
            return { data };
        },

        'change-public-keys'(request, connection) {
            let { publicKey, version, clientID: clientId } = request;

            if (connectedClients.has(clientId)) {
                throw new Error('Changing keys is not allowed');
            }

            if (!Launcher) {
                // on web there can be only one connected client
                connectedClients.clear();
            }

            const keys = tweetnaclBox.keyPair();
            publicKey = kdbxweb.ByteUtils.base64ToBytes(publicKey);

            const stats = {
                connectedDate: new Date(),
                passwordsRead: 0,
                passwordsWritten: 0
            };

            connectedClients.set(clientId, { connection, publicKey, version, keys, stats });

            Events.emit('browser-extension-sessions-changed');

            logger.info('New client key created', clientId, version);

            const nonceBytes = kdbxweb.ByteUtils.base64ToBytes(request.nonce);
            incrementNonce(nonceBytes);
            const nonce = kdbxweb.ByteUtils.bytesToBase64(nonceBytes);

            return {
                action: 'change-public-keys',
                version: getVersion(request),
                publicKey: kdbxweb.ByteUtils.bytesToBase64(keys.publicKey),
                nonce,
                success: 'true',
                ...(isKeeWebConnect(request) ? { appName: 'KeeWeb' } : undefined)
            };
        },

        async 'get-databasehash'(request) {
            decryptRequest(request);

            if (request.triggerUnlock) {
                await checkContentRequestPermissions(request);
            } else {
                ensureAtLeastOneFileIsOpen();
            }

            return encryptResponse(request, {
                hash: KeeWebHash,
                success: 'true',
                version: getVersion(request)
            });
        },

        'generate-password'(request) {
            const password = PasswordGenerator.generate(GeneratorPresets.browserExtensionPreset);

            return encryptResponse(request, {
                version: getVersion(request),
                success: 'true',
                entries: [{ password }]
            });
        },

        'lock-database'(request) {
            decryptRequest(request);
            ensureAtLeastOneFileIsOpen();

            Events.emit('lock-workspace');

            if (Alerts.alertDisplayed) {
                focusKeeWeb();
            }

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request)
            });
        },

        'associate'(request) {
            decryptRequest(request);
            ensureAtLeastOneFileIsOpen();

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                hash: KeeWebHash,
                id: KeeWebAssociationId
            });
        },

        'test-associate'(request) {
            const payload = decryptRequest(request);
            // ensureAtLeastOneFileIsOpen();

            if (payload.id !== KeeWebAssociationId) {
                throw makeError(Errors.noOpenFiles);
            }

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                hash: KeeWebHash,
                id: payload.id
            });
        },

        async 'get-logins'(request) {
            const entry = await findEntry(request, true);

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                hash: KeeWebHash,
                count: 1,
                entries: [
                    {
                        group: entry.group.title,
                        login: entry.user || '',
                        name: entry.title || '',
                        password: entry.password?.getText() || '',
                        skipAutoSubmit: 'false',
                        stringFields: [],
                        uuid: kdbxweb.ByteUtils.bytesToHex(entry.entry.uuid.bytes)
                    }
                ],
                id: ''
            });
        },

        async 'get-totp-by-url'(request) {
            const entry = await findEntry(request, true, { otp: true });

            entry.initOtpGenerator();

            if (!entry.otpGenerator) {
                throw makeError(Errors.noMatches);
            }

            let selectEntryFieldView;
            if (entry.needsTouch) {
                selectEntryFieldView = new SelectEntryFieldView({
                    needsTouch: true,
                    deviceShortName: entry.device.shortName
                });
                selectEntryFieldView.render();
            }

            const otpPromise = new Promise((resolve, reject) => {
                selectEntryFieldView?.on('result', () => reject(makeError(Errors.userRejected)));
                entry.otpGenerator.next((err, otp) => {
                    if (otp) {
                        resolve(otp);
                    } else {
                        reject(err || makeError(Errors.userRejected));
                    }
                });
            });

            let totp;
            try {
                totp = await otpPromise;
            } finally {
                selectEntryFieldView?.remove();
            }

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                totp
            });
        },

        async 'get-any-field'(request) {
            const entry = await findEntry(request, false);

            const selectEntryFieldView = new SelectEntryFieldView({
                entry
            });
            const inactivityTimer = setTimeout(() => {
                selectEntryFieldView.emit('result', undefined);
            }, Timeouts.KeeWebConnectRequest);

            const field = await selectEntryFieldView.showAndGetResult();

            clearTimeout(inactivityTimer);

            if (!field) {
                throw makeError(Errors.userRejected);
            }

            let value = entry.getAllFields()[field];
            if (value.isProtected) {
                value = value.getText();
            }

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                field,
                value
            });
        },

        async 'get-totp'(request) {
            decryptRequest(request);
            await checkContentRequestPermissions(request);

            throw new Error('Not implemented');
        }
    };
}

export { createProtocolReadHandlers };
