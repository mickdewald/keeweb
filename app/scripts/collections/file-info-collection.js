import { Collection } from 'framework/collection';
import { SettingsStore } from 'comp/settings/settings-store';
import { FileInfoModel } from 'models/file-info-model';
import { Storage } from 'storage';

function loadRecoveryInfos() {
    if (!Storage.cache.listRecoveryInfos) {
        return Promise.resolve([]);
    }
    Storage.cache.init();
    return new Promise((resolve, reject) => {
        Storage.cache.listRecoveryInfos(null, (err, recoveries) => {
            if (err) {
                reject(err);
            } else {
                resolve(recoveries);
            }
        });
    });
}

class FileInfoCollection extends Collection {
    static model = FileInfoModel;

    load() {
        return Promise.all([SettingsStore.load('file-info'), loadRecoveryInfos()]).then(
            ([data, recoveries]) => {
                const infos = new Map();
                for (const item of data || []) {
                    infos.set(item.id, item);
                }
                for (const { fileInfo, recoveryVersion } of recoveries) {
                    if (fileInfo && fileInfo.id) {
                        infos.set(fileInfo.id, { ...fileInfo, recoveryVersion });
                    }
                }
                for (const item of infos.values()) {
                    this.push(new FileInfoModel(item));
                }
            }
        );
    }

    save() {
        return SettingsStore.save('file-info', this);
    }

    getMatch(storage, name, path) {
        return this.find((fi) => {
            return (
                (fi.storage || '') === (storage || '') &&
                (fi.name || '') === (name || '') &&
                (fi.path || '') === (path || '')
            );
        });
    }

    getByName(name) {
        return this.find((file) => file.name.toLowerCase() === name.toLowerCase());
    }
}

const instance = new FileInfoCollection();

export { instance as FileInfoCollection };
