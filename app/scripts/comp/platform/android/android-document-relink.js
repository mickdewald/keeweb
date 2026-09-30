// Points the recent-file entry (and the open file) of an unreachable document at a newly
// picked document, chosen explicitly by the user. No new FileInfo is created, so the
// normal sync loads the new document, merges the edits cached meanwhile and saves.
function relinkDocument({ appModel, storage, oldPath, newPath }) {
    let fileInfos = 0;
    for (const fileInfo of appModel.fileInfos) {
        if (fileInfo.storage === storage.name && fileInfo.path === oldPath) {
            fileInfo.path = newPath;
            fileInfos++;
        }
    }
    appModel.fileInfos.save();
    const files = appModel.files.filter(
        (file) => file.storage === storage.name && file.path === oldPath
    );
    for (const file of files) {
        file.path = newPath;
    }
    if (newPath !== oldPath) {
        storage.forget(oldPath);
    }
    for (const file of files) {
        appModel.syncFile(file);
    }
    return { fileInfos, files: files.length };
}

export { relinkDocument };
