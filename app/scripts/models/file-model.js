import * as kdbxweb from 'kdbxweb';
import demoFileData from 'demo.kdbx';
import { Model } from 'framework/model';
import { GroupCollection } from 'collections/group-collection';
import { GroupModel } from 'models/group-model';
import { AppSettingsModel } from 'models/app-settings-model';
import { Logger } from 'util/logger';
import { Locale } from 'util/locale';
import { StringFormat } from 'util/formatting/string-format';
import { ChalRespCalculator } from 'comp/app/chal-resp-calculator';
import { FileModelSettingsMixin } from 'models/file-model-settings';
import { FileModelSerializationMixin } from 'models/file-model-serialization';

const logger = new Logger('file');

class FileModel extends Model {
    constructor(data) {
        super({
            entryMap: {},
            groupMap: {},
            ...data
        });
    }

    open(password, fileData, keyFileData, callback) {
        try {
            const challengeResponse = ChalRespCalculator.build(this.chalResp);
            const credentials = new kdbxweb.Credentials(password, keyFileData, challengeResponse);
            const ts = logger.ts();

            kdbxweb.Kdbx.load(fileData, credentials)
                .then((db) => {
                    this.db = db;
                })
                .then(() => {
                    this.readModel();
                    this.setOpenFile({ passwordLength: password ? password.textLength : 0 });
                    if (keyFileData) {
                        kdbxweb.ByteUtils.zeroBuffer(keyFileData);
                    }
                    logger.info(
                        'Opened file ' +
                            this.name +
                            ': ' +
                            logger.ts(ts) +
                            ', ' +
                            this.kdfArgsToString(this.db.header) +
                            ', ' +
                            Math.round(fileData.byteLength / 1024) +
                            ' kB'
                    );
                    callback();
                })
                .catch((err) => {
                    if (
                        err.code === kdbxweb.Consts.ErrorCodes.InvalidKey &&
                        password &&
                        !password.byteLength
                    ) {
                        logger.info(
                            'Error opening file with empty password, try to open with null password'
                        );
                        return this.open(null, fileData, keyFileData, callback);
                    }
                    logger.error('Error opening file', err.code, err.message, err);
                    callback(err);
                });
        } catch (e) {
            logger.error('Error opening file', e, e.code, e.message, e);
            callback(e);
        }
    }

    kdfArgsToString(header) {
        if (header.kdfParameters) {
            return header.kdfParameters
                .keys()
                .map((key) => {
                    const val = header.kdfParameters.get(key);
                    if (val instanceof ArrayBuffer) {
                        return undefined;
                    }
                    return key + '=' + val;
                })
                .filter((p) => p)
                .join('&');
        } else if (header.keyEncryptionRounds) {
            return header.keyEncryptionRounds + ' rounds';
        } else {
            return '?';
        }
    }

    create(name, callback) {
        const password = kdbxweb.ProtectedValue.fromString('');
        const credentials = new kdbxweb.Credentials(password);
        this.db = kdbxweb.Kdbx.create(credentials, name);
        this.name = name;
        this.readModel();
        this.set({ active: true, created: true, name });
        callback();
    }

    importWithXml(fileXml, callback) {
        try {
            const ts = logger.ts();
            const password = kdbxweb.ProtectedValue.fromString('');
            const credentials = new kdbxweb.Credentials(password);
            kdbxweb.Kdbx.loadXml(fileXml, credentials)
                .then((db) => {
                    this.db = db;
                })
                .then(() => {
                    this.readModel();
                    this.set({ active: true, created: true });
                    logger.info('Imported file ' + this.name + ': ' + logger.ts(ts));
                    callback();
                })
                .catch((err) => {
                    logger.error('Error importing file', err.code, err.message, err);
                    callback(err);
                });
        } catch (e) {
            logger.error('Error importing file', e, e.code, e.message, e);
            callback(e);
        }
    }

    openDemo(callback) {
        const password = kdbxweb.ProtectedValue.fromString('demo');
        const credentials = new kdbxweb.Credentials(password);
        const demoFile = kdbxweb.ByteUtils.arrayToBuffer(
            kdbxweb.ByteUtils.base64ToBytes(demoFileData)
        );
        kdbxweb.Kdbx.load(demoFile, credentials)
            .then((db) => {
                this.db = db;
            })
            .then(() => {
                this.name = 'Demo';
                this.readModel();
                this.setOpenFile({ passwordLength: 4, demo: true });
                callback();
            });
    }

    setOpenFile(props) {
        this.set({
            ...props,
            active: true,
            oldKeyFileName: this.keyFileName,
            oldPasswordLength: props.passwordLength,
            passwordChanged: false,
            keyFileChanged: false
        });
        this.oldPasswordHash = this.db.credentials.passwordHash;
        this.oldKeyFileHash = this.db.credentials.keyFileHash;
        this.oldKeyChangeDate = this.db.meta.keyChanged;
    }

    readModel() {
        const groups = new GroupCollection();
        this.set(
            {
                uuid: this.db.getDefaultGroup().uuid.toString(),
                groups,
                formatVersion: this.db.header.versionMajor,
                defaultUser: this.db.meta.defaultUser,
                recycleBinEnabled: this.db.meta.recycleBinEnabled,
                historyMaxItems: this.db.meta.historyMaxItems,
                historyMaxSize: this.db.meta.historyMaxSize,
                keyEncryptionRounds: this.db.header.keyEncryptionRounds,
                keyChangeForce: this.db.meta.keyChangeForce,
                kdfName: this.readKdfName(),
                kdfParameters: this.readKdfParams()
            },
            { silent: true }
        );
        this.db.groups.forEach(function (group) {
            let groupModel = this.getGroup(this.subId(group.uuid.id));
            if (groupModel) {
                groupModel.setGroup(group, this);
            } else {
                groupModel = GroupModel.fromGroup(group, this);
            }
            groups.push(groupModel);
        }, this);
        this.buildObjectMap();
        this.resolveFieldReferences();
    }

    readKdfName() {
        if (this.db.header.versionMajor === 4 && this.db.header.kdfParameters) {
            const kdfParameters = this.db.header.kdfParameters;
            let uuid = kdfParameters.get('$UUID');
            if (uuid) {
                uuid = kdbxweb.ByteUtils.bytesToBase64(uuid);
                switch (uuid) {
                    case kdbxweb.Consts.KdfId.Argon2d:
                        return 'Argon2d';
                    case kdbxweb.Consts.KdfId.Argon2id:
                        return 'Argon2id';
                    case kdbxweb.Consts.KdfId.Aes:
                        return 'Aes';
                }
            }
            return 'Unknown';
        } else {
            return 'Aes';
        }
    }

    readKdfParams() {
        const kdfParameters = this.db.header.kdfParameters;
        if (!kdfParameters) {
            return undefined;
        }
        let uuid = kdfParameters.get('$UUID');
        if (!uuid) {
            return undefined;
        }
        uuid = kdbxweb.ByteUtils.bytesToBase64(uuid);
        switch (uuid) {
            case kdbxweb.Consts.KdfId.Argon2d:
            case kdbxweb.Consts.KdfId.Argon2id:
                return {
                    parallelism: kdfParameters.get('P').valueOf(),
                    iterations: kdfParameters.get('I').valueOf(),
                    memory: kdfParameters.get('M').valueOf()
                };
            case kdbxweb.Consts.KdfId.Aes:
                return {
                    rounds: kdfParameters.get('R').valueOf()
                };
            default:
                return undefined;
        }
    }

    subId(id) {
        return this.id + ':' + id;
    }

    buildObjectMap() {
        const entryMap = {};
        const groupMap = {};
        this.forEachGroup(
            (group) => {
                groupMap[group.id] = group;
                group.forEachOwnEntry(null, (entry) => {
                    entryMap[entry.id] = entry;
                });
            },
            { includeDisabled: true }
        );
        this.entryMap = entryMap;
        this.groupMap = groupMap;
    }

    resolveFieldReferences() {
        const entryMap = this.entryMap;
        Object.keys(entryMap).forEach((e) => {
            entryMap[e].resolveFieldReferences();
        });
    }

    reload() {
        this.buildObjectMap();
        this.readModel();
        this.emit('reload', this);
    }

    mergeOrUpdate(fileData, remoteKey, callback) {
        let credentials;
        let credentialsPromise = Promise.resolve();
        if (remoteKey) {
            credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(''));
            credentialsPromise = credentials.ready.then(() => {
                const promises = [];
                if (remoteKey.password) {
                    promises.push(credentials.setPassword(remoteKey.password));
                } else {
                    credentials.passwordHash = this.db.credentials.passwordHash;
                }
                if (remoteKey.keyFileName) {
                    if (remoteKey.keyFileData) {
                        promises.push(credentials.setKeyFile(remoteKey.keyFileData));
                    } else {
                        credentials.keyFileHash = this.db.credentials.keyFileHash;
                    }
                }
                return Promise.all(promises);
            });
        } else {
            credentials = this.db.credentials;
        }
        credentialsPromise.then(() => {
            kdbxweb.Kdbx.load(fileData, credentials)
                .then((remoteDb) => {
                    if (this.modified) {
                        try {
                            if (remoteKey && remoteDb.meta.keyChanged > this.db.meta.keyChanged) {
                                this.db.credentials = remoteDb.credentials;
                                this.keyFileName = remoteKey.keyFileName || '';
                                if (remoteKey.password) {
                                    this.passwordLength = remoteKey.password.textLength;
                                }
                            }
                            this.db.merge(remoteDb);
                        } catch (e) {
                            logger.error('File merge error', e);
                            return callback(e);
                        }
                    } else {
                        this.db = remoteDb;
                    }
                    this.dirty = true;
                    this.reload();
                    callback();
                })
                .catch((err) => {
                    logger.error('Error opening file to merge', err.code, err.message, err);
                    callback(err);
                });
        });
    }

    getLocalEditState() {
        return this.db.getLocalEditState();
    }

    setLocalEditState(editState) {
        this.db.setLocalEditState(editState);
    }

    close() {
        this.set({
            keyFileName: '',
            passwordLength: 0,
            modified: false,
            dirty: false,
            active: false,
            created: false,
            groups: null,
            passwordChanged: false,
            keyFileChanged: false,
            syncing: false
        });
        if (this.chalResp && !AppSettingsModel.yubiKeyRememberChalResp) {
            ChalRespCalculator.clearCache(this.chalResp);
        }
    }

    getEntry(id) {
        return this.entryMap[id];
    }

    getGroup(id) {
        return this.groupMap[id];
    }

    forEachEntry(filter, callback) {
        let top = this;
        if (filter.trash) {
            top = this.getGroup(
                this.db.meta.recycleBinUuid ? this.subId(this.db.meta.recycleBinUuid.id) : null
            );
        } else if (filter.group) {
            top = this.getGroup(filter.group);
        }
        if (top) {
            if (top.forEachOwnEntry) {
                top.forEachOwnEntry(filter, callback);
            }
            if (!filter.group || filter.subGroups) {
                top.forEachGroup((group) => {
                    group.forEachOwnEntry(filter, callback);
                }, filter);
            }
        }
    }

    forEachGroup(callback, filter) {
        this.groups.forEach((group) => {
            if (callback(group) !== false) {
                group.forEachGroup(callback, filter);
            }
        });
    }

    getTrashGroup() {
        return this.db.meta.recycleBinEnabled
            ? this.getGroup(this.subId(this.db.meta.recycleBinUuid.id))
            : null;
    }

    getEntryTemplatesGroup() {
        return this.db.meta.entryTemplatesGroup
            ? this.getGroup(this.subId(this.db.meta.entryTemplatesGroup.id))
            : null;
    }

    createEntryTemplatesGroup() {
        const rootGroup = this.groups[0];
        const templatesGroup = GroupModel.newGroup(rootGroup, this);
        templatesGroup.setName(StringFormat.capFirst(Locale.templates));
        this.db.meta.entryTemplatesGroup = templatesGroup.group.uuid;
        this.reload();
        return templatesGroup;
    }

    setModified() {
        if (!this.demo) {
            this.set({ modified: true, dirty: true });
        }
    }

    static createKeyFileWithHash(hash) {
        const hashData = kdbxweb.ByteUtils.base64ToBytes(hash);
        const hexHash = kdbxweb.ByteUtils.bytesToHex(hashData);
        return kdbxweb.ByteUtils.stringToBytes(hexHash);
    }
}

Object.assign(FileModel.prototype, FileModelSerializationMixin);
Object.assign(FileModel.prototype, FileModelSettingsMixin);

FileModel.defineModelProperties({
    id: '',
    uuid: '',
    name: '',
    db: null,
    entryMap: null,
    groupMap: null,
    keyFileName: '',
    keyFilePath: null,
    chalResp: null,
    passwordLength: 0,
    path: '',
    opts: null,
    storage: null,
    modified: false,
    dirty: false,
    active: false,
    created: false,
    demo: false,
    groups: null,
    oldPasswordLength: 0,
    oldKeyFileName: '',
    passwordChanged: false,
    keyFileChanged: false,
    keyChangeForce: -1,
    syncing: false,
    syncError: null,
    syncDate: null,
    backup: null,
    formatVersion: null,
    defaultUser: null,
    recycleBinEnabled: null,
    historyMaxItems: null,
    historyMaxSize: null,
    keyEncryptionRounds: null,
    kdfName: null,
    kdfParameters: null,
    fingerprint: null, // obsolete
    oldPasswordHash: null,
    oldKeyFileHash: null,
    oldKeyChangeDate: null,
    encryptedPassword: null,
    encryptedPasswordDate: null,
    supportsTags: true,
    supportsColors: true,
    supportsIcons: true,
    supportsExpiration: true,
    defaultGroupHash: ''
});

export { FileModel };
