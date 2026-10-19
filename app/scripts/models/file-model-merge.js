import * as kdbxweb from 'kdbxweb';

function setCredentialHash(credentials, propertyName, value) {
    const privatePropertyName = propertyName === 'passwordHash' ? '_passwordHash' : '_keyFileHash';
    if (privatePropertyName in credentials) {
        credentials[privatePropertyName] = value;
    } else {
        credentials[propertyName] = value;
    }
}

function hashBytes(hash) {
    return hash ? hash.getBinary() : null;
}

function hashBase64(hash) {
    const bytes = hashBytes(hash);
    return bytes ? kdbxweb.ByteUtils.bytesToBase64(bytes) : null;
}

function hashesEqual(left, right) {
    return hashBase64(left) === hashBase64(right);
}

function createKeyFileFromHash(credentials) {
    const keyFileHash = hashBytes(credentials.keyFileHash);
    if (!keyFileHash) {
        throw new Error('Remote key file data is required');
    }
    return keyFileHash;
}

function createMergeCredentials(file, remoteKey) {
    if (!remoteKey) {
        return Promise.resolve(file.db.credentials);
    }
    const credentials = new kdbxweb.Credentials(null);
    return credentials.ready
        .then(() => {
            const promises = [];
            if (remoteKey.password) {
                promises.push(credentials.setPassword(remoteKey.password));
            } else {
                setCredentialHash(credentials, 'passwordHash', file.db.credentials.passwordHash);
            }
            if (remoteKey.keyFileName) {
                const keyFileData =
                    remoteKey.keyFileData || createKeyFileFromHash(file.db.credentials);
                promises.push(credentials.setKeyFile(keyFileData));
            }
            return Promise.all(promises);
        })
        .then(() => credentials);
}

function remoteKeyIsNewer(previousDb, remoteDb) {
    return remoteDb.meta.keyChanged > previousDb.meta.keyChanged;
}

function applyRemoteCredentialState(file, previousDb, remoteDb, remoteKey, options = {}) {
    if (!remoteKey || (!options.force && !remoteKeyIsNewer(previousDb, remoteDb))) {
        return;
    }
    const passwordChanged = !hashesEqual(
        previousDb.credentials.passwordHash,
        remoteDb.credentials.passwordHash
    );
    const keyFileChanged = !hashesEqual(
        previousDb.credentials.keyFileHash,
        remoteDb.credentials.keyFileHash
    );
    const updates = {
        keyFileName: remoteKey.keyFileName || '',
        keyFilePath: null,
        passwordChanged,
        keyFileChanged
    };
    if (remoteKey.password) {
        updates.passwordLength = remoteKey.password.textLength;
    }
    if (passwordChanged || keyFileChanged) {
        updates.encryptedPassword = null;
        updates.encryptedPasswordDate = null;
    }
    file.db.credentials = remoteDb.credentials;
    file.set(updates);
}

function shouldMergeCleanRemote(file) {
    return !file.modified && file.storage === 'androiddoc';
}

export { applyRemoteCredentialState, createMergeCredentials, shouldMergeCleanRemote };
