import { Storage } from 'storage';
import { IdGenerator } from 'util/generators/id-generator';

const fileRecoveryLifetimes = new WeakMap();
const closedFileError = 'File is closed';

function isFileActive(file) {
    return file.active !== false;
}

function getFileRecoveryLifetime(file) {
    if (!fileRecoveryLifetimes.has(file)) {
        fileRecoveryLifetimes.set(file, IdGenerator.uuid());
    }
    return fileRecoveryLifetimes.get(file);
}

function getRecoveryVersion(file, editVersion) {
    return `${getFileRecoveryLifetime(file)}:${editVersion}`;
}

function fileInfoSnapshot(fileInfo, values) {
    const snapshot = {};
    for (const key of Object.keys(fileInfo)) {
        if (typeof fileInfo[key] !== 'function') {
            snapshot[key] = fileInfo[key];
        }
    }
    return { ...snapshot, ...values };
}

function applyCredentialMetadata(metadata, file, fileInfo, settings) {
    if (file.passwordChanged || file.keyFileChanged) {
        metadata.encryptedPassword = null;
        metadata.encryptedPasswordDate = null;
    } else {
        metadata.encryptedPassword = file.encryptedPassword || fileInfo.encryptedPassword;
        metadata.encryptedPasswordDate =
            file.encryptedPasswordDate || fileInfo.encryptedPasswordDate;
    }

    switch (settings.rememberKeyFiles) {
        case 'data':
            metadata.keyFileName = file.keyFileName || null;
            metadata.keyFileHash = file.getKeyFileHash();
            metadata.keyFilePath = null;
            break;
        case 'path':
            metadata.keyFileName = file.keyFileName || null;
            metadata.keyFilePath = file.keyFilePath || null;
            metadata.keyFileHash = null;
            break;
        default:
            metadata.keyFileName = null;
            metadata.keyFileHash = null;
            metadata.keyFilePath = null;
            break;
    }
    return metadata;
}

function fileInfoSnapshotForFile(fileInfo, file, settings, values) {
    return applyCredentialMetadata(fileInfoSnapshot(fileInfo, values), file, fileInfo, settings);
}

function saveLockRecovery(fileInfo, file, data, metadata, recoveryVersion, callback) {
    if (!isFileActive(file)) {
        return callback(closedFileError);
    }
    const guardedCallback = (err, result) => {
        callback(isFileActive(file) ? err : closedFileError, result);
    };
    if (Storage.cache.saveRecovery) {
        Storage.cache.saveRecovery(
            fileInfo.id,
            null,
            data,
            metadata,
            recoveryVersion,
            guardedCallback
        );
    } else {
        Storage.cache.save(fileInfo.id, null, data, guardedCallback);
    }
}

function saveNormalCacheSnapshot(fileInfo, file, data, metadata, recoveryVersion, callback) {
    const metadataToSave = { ...metadata };
    const baseRecoveryVersion = metadataToSave.baseRecoveryVersion;
    delete metadataToSave.editVersionValue;
    delete metadataToSave.baseRecoveryVersion;
    if (!isFileActive(file)) {
        return callback(closedFileError);
    }
    Storage.cache.save(fileInfo.id, null, data, (err) => {
        if (err || !isFileActive(file) || !Storage.cache.saveRecovery) {
            return callback(err || (isFileActive(file) ? null : closedFileError));
        }
        if (fileInfo.recoveryVersion && fileInfo.recoveryVersion !== baseRecoveryVersion) {
            return callback();
        }
        Storage.cache.saveRecovery(
            fileInfo.id,
            null,
            data,
            metadataToSave,
            recoveryVersion,
            (err) => {
                callback(err || (isFileActive(file) ? null : closedFileError), recoveryVersion);
            }
        );
    });
}

function clearMatchingRecovery(fileInfo, recoveryVersion, callback) {
    if (!Storage.cache.clearRecovery) {
        return callback();
    }
    Storage.cache.clearRecovery(fileInfo.id, null, recoveryVersion, callback);
}

function createNormalCacheSnapshot(appModel, fileInfo, file, storage, path, editVersion) {
    const recoveryVersion = getRecoveryVersion(file, editVersion);
    const metadata = fileInfoSnapshotForFile(fileInfo, file, appModel.settings || {}, {
        name: file.name,
        storage,
        path,
        opts: appModel.getStoreOpts(file),
        modified: file.modified,
        editState: file.getLocalEditState(),
        recoveryVersion,
        syncDate: file.syncDate,
        chalResp: file.chalResp,
        editVersionValue: editVersion,
        baseRecoveryVersion: fileInfo.recoveryVersion || null
    });
    return { metadata, recoveryVersion };
}

export {
    clearMatchingRecovery,
    createNormalCacheSnapshot,
    fileInfoSnapshotForFile,
    getRecoveryVersion,
    saveLockRecovery,
    saveNormalCacheSnapshot
};
