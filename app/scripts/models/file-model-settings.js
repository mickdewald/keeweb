import * as kdbxweb from 'kdbxweb';
import { Events } from 'framework/events';
import { AppSettingsModel } from 'models/app-settings-model';
import { ChalRespCalculator } from 'comp/app/chal-resp-calculator';
import { IconUrlFormat } from 'util/formatting/icon-url-format';

const FileModelSettingsMixin = {
    setSyncProgress() {
        this.set({ syncing: true });
    },

    setSyncComplete(path, storage, error) {
        if (!error) {
            this.db.removeLocalEditState();
        }
        const modified = this.modified && !!error;
        this.set({
            created: false,
            path: path || this.path,
            storage: storage || this.storage,
            modified,
            dirty: error ? this.dirty : false,
            syncing: false,
            syncError: error
        });

        if (!error && this.passwordChanged && this.encryptedPassword) {
            this.set({
                encryptedPassword: null,
                encryptedPasswordDate: null
            });
        }

        if (!this.open) {
            return;
        }
        this.setOpenFile({ passwordLength: this.passwordLength });
        this.forEachEntry({ includeDisabled: true }, (entry) => entry.setSaved());
    },

    setPassword(password) {
        this.db.credentials.setPassword(password);
        this.db.meta.keyChanged = new Date();
        this.set({ passwordLength: password.textLength, passwordChanged: true });
        this.setModified();
    },

    resetPassword() {
        this.db.credentials.passwordHash = this.oldPasswordHash;
        if (this.db.credentials.keyFileHash === this.oldKeyFileHash) {
            this.db.meta.keyChanged = this.oldKeyChangeDate;
        }
        this.set({ passwordLength: this.oldPasswordLength, passwordChanged: false });
    },

    setKeyFile(keyFile, keyFileName) {
        this.db.credentials.setKeyFile(keyFile);
        this.db.meta.keyChanged = new Date();
        this.set({ keyFileName, keyFileChanged: true });
        this.setModified();
    },

    generateAndSetKeyFile() {
        return kdbxweb.Credentials.createRandomKeyFile().then((keyFile) => {
            const keyFileName = 'Generated';
            this.setKeyFile(keyFile, keyFileName);
            return keyFile;
        });
    },

    resetKeyFile() {
        this.db.credentials.keyFileHash = this.oldKeyFileHash;
        if (this.db.credentials.passwordHash === this.oldPasswordHash) {
            this.db.meta.keyChanged = this.oldKeyChangeDate;
        }
        this.set({ keyFileName: this.oldKeyFileName, keyFileChanged: false });
    },

    removeKeyFile() {
        this.db.credentials.setKeyFile(null);
        const changed = !!this.oldKeyFileHash;
        if (!changed && this.db.credentials.passwordHash === this.oldPasswordHash) {
            this.db.meta.keyChanged = this.oldKeyChangeDate;
        }
        this.set({ keyFileName: '', keyFilePath: '', keyFileChanged: changed });
        Events.emit('unset-keyfile', this.id);
        this.setModified();
    },

    isKeyChangePending(force) {
        if (!this.db.meta.keyChanged) {
            return false;
        }
        const expiryDays = force ? this.db.meta.keyChangeForce : this.db.meta.keyChangeRec;
        if (!expiryDays || expiryDays < 0 || isNaN(expiryDays)) {
            return false;
        }
        const daysDiff = (Date.now() - this.db.meta.keyChanged) / 1000 / 3600 / 24;
        return daysDiff > expiryDays;
    },

    setChallengeResponse(chalResp) {
        if (this.chalResp && !AppSettingsModel.yubiKeyRememberChalResp) {
            ChalRespCalculator.clearCache(this.chalResp);
        }
        this.db.credentials.setChallengeResponse(ChalRespCalculator.build(chalResp));
        this.db.meta.keyChanged = new Date();
        this.chalResp = chalResp;
        this.setModified();
    },

    setKeyChange(force, days) {
        if (isNaN(days) || !days || days < 0) {
            days = -1;
        }
        const prop = force ? 'keyChangeForce' : 'keyChangeRec';
        this.db.meta[prop] = days;
        this[prop] = days;
        this.setModified();
    },

    setName(name) {
        this.db.meta.name = name;
        this.db.meta.nameChanged = new Date();
        this.name = name;
        this.groups[0].setName(name);
        this.setModified();
        this.reload();
    },

    setDefaultUser(defaultUser) {
        this.db.meta.defaultUser = defaultUser;
        this.db.meta.defaultUserChanged = new Date();
        this.defaultUser = defaultUser;
        this.setModified();
    },

    setRecycleBinEnabled(enabled) {
        enabled = !!enabled;
        this.db.meta.recycleBinEnabled = enabled;
        if (enabled) {
            this.db.createRecycleBin();
        }
        this.recycleBinEnabled = enabled;
        this.setModified();
    },

    setHistoryMaxItems(count) {
        this.db.meta.historyMaxItems = count;
        this.historyMaxItems = count;
        this.setModified();
    },

    setHistoryMaxSize(size) {
        this.db.meta.historyMaxSize = size;
        this.historyMaxSize = size;
        this.setModified();
    },

    setKeyEncryptionRounds(rounds) {
        this.db.header.keyEncryptionRounds = rounds;
        this.keyEncryptionRounds = rounds;
        this.setModified();
    },

    setKdfParameter(field, value) {
        const ValueType = kdbxweb.VarDictionary.ValueType;
        switch (field) {
            case 'memory':
                this.db.header.kdfParameters.set('M', ValueType.UInt64, kdbxweb.Int64.from(value));
                break;
            case 'iterations':
                this.db.header.kdfParameters.set('I', ValueType.UInt64, kdbxweb.Int64.from(value));
                break;
            case 'parallelism':
                this.db.header.kdfParameters.set('P', ValueType.UInt32, value);
                break;
            case 'rounds':
                this.db.header.kdfParameters.set('R', ValueType.UInt32, value);
                break;
            default:
                return;
        }
        this.kdfParameters = this.readKdfParams();
        this.setModified();
    },

    emptyTrash() {
        const trashGroup = this.getTrashGroup();
        if (trashGroup) {
            let modified = false;
            trashGroup
                .getOwnSubGroups()
                .slice()
                .forEach(function (group) {
                    this.db.move(group, null);
                    modified = true;
                }, this);
            trashGroup.group.entries.slice().forEach(function (entry) {
                this.db.move(entry, null);
                modified = true;
            }, this);
            trashGroup.items.length = 0;
            trashGroup.entries.length = 0;
            if (modified) {
                this.setModified();
            }
        }
    },

    getCustomIcons() {
        const customIcons = {};
        for (const [id, icon] of this.db.meta.customIcons) {
            customIcons[id] = IconUrlFormat.toDataUrl(icon.data);
        }
        return customIcons;
    },

    addCustomIcon(iconData) {
        const uuid = kdbxweb.KdbxUuid.random();
        this.db.meta.customIcons.set(uuid.id, {
            data: kdbxweb.ByteUtils.arrayToBuffer(kdbxweb.ByteUtils.base64ToBytes(iconData)),
            lastModified: new Date()
        });
        return uuid.toString();
    },

    renameTag(from, to) {
        this.forEachEntry({ includeDisabled: true }, (entry) => entry.renameTag(from, to));
    },

    setFormatVersion(version) {
        this.db.setVersion(version);
        this.setModified();
        this.readModel();
    },

    setKdf(kdfName) {
        const kdfParameters = this.db.header.kdfParameters;
        if (!kdfParameters) {
            throw new Error('Cannot set KDF on this version');
        }
        switch (kdfName) {
            case 'Aes':
                this.db.setKdf(kdbxweb.Consts.KdfId.Aes);
                break;
            case 'Argon2d':
                this.db.setKdf(kdbxweb.Consts.KdfId.Argon2d);
                break;
            case 'Argon2id':
                this.db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
                break;
            default:
                throw new Error('Bad KDF name');
        }
        this.setModified();
        this.readModel();
    }
};

export { FileModelSettingsMixin };
