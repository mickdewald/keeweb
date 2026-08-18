function createProtocolWriteHandlers({
    kdbxweb,
    Events,
    Alerts,
    Locale,
    ExtensionCreateGroupView,
    ExtensionSaveEntryView,
    RuntimeDataModel,
    KeeWebHash,
    ExtensionGroupIconId,
    DefaultExtensionGroupName,
    ExtensionGroupNames,
    appModel,
    getClient,
    decryptRequest,
    encryptResponse,
    checkContentRequestPermissions,
    alertWithTimeout,
    getAvailableFiles,
    getVersion,
    getHumanReadableExtensionName,
    focusKeeWeb
}) {
    return {
        async 'set-login'(request) {
            const payload = decryptRequest(request);
            await checkContentRequestPermissions(request);

            focusKeeWeb();

            if (!payload.url) {
                throw new Error('Empty url');
            }
            const url = new URL(payload.url);

            const files = getAvailableFiles(request);
            const client = getClient(request);

            let selectedGroup;

            let entryToUpdate;
            if (payload.uuid) {
                for (const file of files) {
                    const entryId = kdbxweb.ByteUtils.bytesToBase64(
                        kdbxweb.ByteUtils.hexToBytes(payload.uuid)
                    );
                    const foundEntry = file.getEntry(file.subId(entryId));
                    if (foundEntry) {
                        if (entryToUpdate) {
                            throw new Error('Two entries with the same ID found');
                        } else {
                            entryToUpdate = foundEntry;
                            selectedGroup = foundEntry.group;
                        }
                    }
                }
                if (!entryToUpdate) {
                    throw new Error('Updated entry not found');
                }
            }

            if (
                client.permissions.askSave === 'auto' &&
                client.permissions.saveTo &&
                !selectedGroup
            ) {
                const file = files.find((f) => f.id === client.permissions.saveTo.fileId);
                selectedGroup = file?.getGroup(client.permissions.saveTo.groupId);
            }

            if (client.permissions.askSave !== 'auto' || !selectedGroup) {
                if (!selectedGroup && RuntimeDataModel.extensionSaveConfig) {
                    const file = files.find(
                        (f) => f.id === RuntimeDataModel.extensionSaveConfig.fileId
                    );
                    selectedGroup = file?.getGroup(RuntimeDataModel.extensionSaveConfig.groupId);
                }

                const allGroups = [];
                for (const file of files) {
                    file.forEachGroup((group) => {
                        const spaces = [];
                        for (let parent = group; parent.parentGroup; parent = parent.parentGroup) {
                            spaces.push(' ', ' ');
                        }

                        if (
                            !selectedGroup &&
                            group.iconId === ExtensionGroupIconId &&
                            ExtensionGroupNames.has(group.title)
                        ) {
                            selectedGroup = group;
                        }

                        allGroups.push({
                            id: group.id,
                            fileId: file.id,
                            spaces,
                            title: group.title,
                            selected: group.id === selectedGroup?.id
                        });
                    });
                }
                if (!selectedGroup) {
                    allGroups.splice(1, 0, {
                        id: '',
                        fileId: files[0].id,
                        spaces: [' ', ' '],
                        title: `${DefaultExtensionGroupName} (${Locale.extensionSaveEntryNewGroup})`,
                        selected: true
                    });
                }

                const saveEntryView = new ExtensionSaveEntryView({
                    extensionName: getHumanReadableExtensionName(client),
                    url: payload.url,
                    user: payload.login,
                    askSave: RuntimeDataModel.extensionSaveConfig?.askSave || 'always',
                    update: !!entryToUpdate,
                    allGroups
                });

                await alertWithTimeout({
                    header: Locale.extensionSaveEntryHeader,
                    icon: 'plus',
                    buttons: [Alerts.buttons.allow, Alerts.buttons.deny],
                    view: saveEntryView
                });

                const config = { ...saveEntryView.config };
                if (!entryToUpdate) {
                    if (config.groupId) {
                        const file = files.find((f) => f.id === config.fileId);
                        selectedGroup = file.getGroup(config.groupId);
                    } else {
                        selectedGroup = appModel.createNewGroupWithName(
                            files[0].groups[0],
                            files[0],
                            DefaultExtensionGroupName
                        );
                        selectedGroup.setIcon(ExtensionGroupIconId);
                        config.groupId = selectedGroup.id;
                    }

                    RuntimeDataModel.extensionSaveConfig = config;
                    client.permissions.saveTo = { fileId: config.fileId, groupId: config.groupId };
                }

                client.permissions.askSave = config.askSave;
            }

            const entryFields = {
                Title: url.hostname,
                UserName: payload.login,
                Password: kdbxweb.ProtectedValue.fromString(payload.password || ''),
                URL: payload.url
            };

            if (entryToUpdate) {
                for (const [field, value] of Object.entries(entryFields)) {
                    if (value) {
                        entryToUpdate.setField(field, value);
                    }
                }
            } else {
                appModel.createNewEntryWithFields(selectedGroup, entryFields);
            }

            client.stats.passwordsWritten++;

            Events.emit('browser-extension-sessions-changed');
            Events.emit('refresh');

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                count: null,
                entries: null,
                hash: KeeWebHash
            });
        },

        async 'get-database-groups'(request) {
            decryptRequest(request);
            await checkContentRequestPermissions(request);

            const makeGroups = (group) => {
                const res = {
                    name: group.title,
                    uuid: kdbxweb.ByteUtils.bytesToHex(group.group.uuid.bytes),
                    children: []
                };
                for (const subGroup of group.items) {
                    if (subGroup.matches()) {
                        res.children.push(makeGroups(subGroup));
                    }
                }
                return res;
            };

            const groups = [];
            for (const file of getAvailableFiles(request)) {
                for (const group of file.groups) {
                    groups.push(makeGroups(group));
                }
            }

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                groups: { groups }
            });
        },

        async 'create-new-group'(request) {
            const payload = decryptRequest(request);
            await checkContentRequestPermissions(request);

            if (!payload.groupName) {
                throw new Error('No groupName');
            }

            const groupNames = payload.groupName
                .split('/')
                .map((g) => g.trim())
                .filter((g) => g);

            if (!groupNames.length) {
                throw new Error('Empty group path');
            }

            const files = getAvailableFiles(request);

            for (const file of files) {
                for (const rootGroup of file.groups) {
                    let foundGroup = rootGroup;
                    const pendingGroups = [...groupNames];
                    while (pendingGroups.length && foundGroup) {
                        const title = pendingGroups.shift();
                        foundGroup = foundGroup.items.find((g) => g.title === title);
                    }
                    if (foundGroup) {
                        return encryptResponse(request, {
                            success: 'true',
                            version: getVersion(request),
                            name: foundGroup.title,
                            uuid: kdbxweb.ByteUtils.bytesToHex(foundGroup.group.uuid.bytes)
                        });
                    }
                }
            }

            const client = getClient(request);
            const createGroupView = new ExtensionCreateGroupView({
                extensionName: getHumanReadableExtensionName(client),
                groupPath: groupNames.join(' / '),
                files: files.map((f, ix) => ({ id: f.id, name: f.name, selected: ix === 0 }))
            });

            await alertWithTimeout({
                header: Locale.extensionNewGroupHeader,
                icon: 'folder-plus',
                buttons: [Alerts.buttons.allow, Alerts.buttons.deny],
                view: createGroupView
            });

            const selectedFile = files.find((f) => f.id === createGroupView.selectedFile);

            let newGroup = selectedFile.groups[0];
            const pendingGroups = [...groupNames];

            while (pendingGroups.length) {
                const title = pendingGroups.shift();
                const item = newGroup.items.find((g) => g.title === title);
                if (item) {
                    newGroup = item;
                } else {
                    newGroup = appModel.createNewGroupWithName(newGroup, selectedFile, title);
                }
            }

            return encryptResponse(request, {
                success: 'true',
                version: getVersion(request),
                name: newGroup.title,
                uuid: kdbxweb.ByteUtils.bytesToHex(newGroup.group.uuid.bytes)
            });
        }
    };
}

export { createProtocolWriteHandlers };
