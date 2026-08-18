const EntryModelTrashHistoryMixin = {
    deleteHistory(historyEntry) {
        const ix = this.entry.history.indexOf(historyEntry);
        if (ix >= 0) {
            this.entry.removeHistory(ix);
            this.file.setModified();
        }
        this._fillByEntry();
    },

    revertToHistoryState(historyEntry) {
        const ix = this.entry.history.indexOf(historyEntry);
        if (ix < 0) {
            return;
        }
        this.entry.pushHistory();
        this.unsaved = true;
        this.file.setModified();
        this.entry.fields = new Map();
        this.entry.binaries = new Map();
        this.entry.copyFrom(historyEntry);
        this._entryModified();
        this._fillByEntry();
    },

    discardUnsaved() {
        if (this.unsaved && this.entry.history.length) {
            this.unsaved = false;
            const historyEntry = this.entry.history[this.entry.history.length - 1];
            this.entry.removeHistory(this.entry.history.length - 1);
            this.entry.fields = new Map();
            this.entry.binaries = new Map();
            this.entry.copyFrom(historyEntry);
            this._fillByEntry();
        }
    },

    moveToTrash() {
        this.file.setModified();
        if (this.isJustCreated) {
            this.isJustCreated = false;
        }
        this.file.db.remove(this.entry);
        this.file.reload();
    },

    restoreFromTrash() {
        this.file.setModified();
        const db = this.file.db;
        let group = this.entry.previousParentGroup
            ? db.getGroup(this.entry.previousParentGroup)
            : null;
        if (!group || (db.meta.recycleBinUuid && group.uuid.equals(db.meta.recycleBinUuid))) {
            group = db.getDefaultGroup();
        }
        db.move(this.entry, group);
        this.file.reload();
    },

    deleteFromTrash() {
        this.file.setModified();
        this.file.db.move(this.entry, null);
        this.file.reload();
    },

    removeWithoutHistory() {
        if (this.canBeDeleted) {
            const ix = this.group.group.entries.indexOf(this.entry);
            if (ix >= 0) {
                this.group.group.entries.splice(ix, 1);
            }
            this.file.reload();
        }
    },

    detach() {
        this.file.setModified();
        this.file.db.move(this.entry, null);
        this.file.reload();
        return this.entry;
    },

    moveToFile(file) {
        if (this.canBeDeleted) {
            this.removeWithoutHistory();
            this.group = file.groups[0];
            this.file = file;
            this._fillByEntry();
            this.entry.times.update();
            this.group.group.entries.push(this.entry);
            this.group.addEntry(this);
            this.isJustCreated = true;
            this.unsaved = true;
            this.file.setModified();
        }
    }
};

export { EntryModelTrashHistoryMixin };
