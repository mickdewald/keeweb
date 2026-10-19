function documentPathChangedDuringSync({ storage, syncPath, currentPath }) {
    return storage === 'androiddoc' && syncPath !== currentPath;
}

function hasDuplicateDocumentPath({ appModel, storage, oldPath, newPath }) {
    return [...appModel.fileInfos, ...appModel.files].some(
        (item) => item.storage === storage.name && item.path === newPath && item.path !== oldPath
    );
}

const scheduledRelinks = new WeakMap();

function scheduleRelink({ appModel, storage, oldPath, newPath, opts }) {
    let relinks = scheduledRelinks.get(appModel);
    if (!relinks) {
        relinks = new Set();
        scheduledRelinks.set(appModel, relinks);
    }
    const key = [storage.name, oldPath, newPath].join('\0');
    if (relinks.has(key)) {
        return;
    }
    relinks.add(key);
    Promise.resolve().then(() => {
        relinks.delete(key);
        relinkDocument({ appModel, storage, oldPath, newPath, opts });
    });
}

// Points the recent-file entry (and the open file) of an unreachable document at a newly
// picked document, chosen explicitly by the user. No new FileInfo is created, so the
// normal sync loads the new document, merges the edits cached meanwhile and saves.
function relinkDocument({ appModel, storage, oldPath, newPath, opts }) {
    if (hasDuplicateDocumentPath({ appModel, storage, oldPath, newPath })) {
        return { rejected: 'duplicate' };
    }
    const syncingFiles = appModel.files.filter(
        (file) => file.storage === storage.name && file.path === oldPath && file.syncing
    );
    if (syncingFiles.length) {
        for (const file of syncingFiles) {
            file.once('change:syncing', (model, syncing) => {
                if (!syncing) {
                    scheduleRelink({ appModel, storage, oldPath, newPath, opts });
                }
            });
        }
        return { pending: syncingFiles.length };
    }
    let fileInfos = 0;
    for (const fileInfo of appModel.fileInfos) {
        if (fileInfo.storage === storage.name && fileInfo.path === oldPath) {
            fileInfo.path = newPath;
            if (opts) {
                fileInfo.opts = { ...fileInfo.opts, ...opts };
            }
            fileInfos++;
        }
    }
    appModel.fileInfos.save();
    const files = appModel.files.filter(
        (file) => file.storage === storage.name && file.path === oldPath
    );
    for (const file of files) {
        const values = newPath === oldPath ? { path: newPath } : { path: newPath, modified: true };
        if (opts) {
            values.opts = { ...file.opts, ...opts };
        }
        file.set(values);
    }
    if (newPath !== oldPath) {
        storage.forget(oldPath);
    }
    for (const file of files) {
        appModel.syncFile(file);
    }
    return { fileInfos, files: files.length };
}

export { relinkDocument, documentPathChangedDuringSync };
