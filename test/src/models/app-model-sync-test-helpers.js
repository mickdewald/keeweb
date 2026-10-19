import { FileModelSettingsMixin } from 'models/file-model-settings';

function fileInfo(attrs = {}) {
    return {
        id: 'file',
        storage: null,
        path: '',
        modified: false,
        editState: null,
        set(values) {
            Object.assign(this, values);
        },
        ...attrs
    };
}

function syncedFile(attrs = {}) {
    return {
        ...FileModelSettingsMixin,
        id: 'file',
        name: 'Main',
        active: true,
        open: true,
        storage: null,
        path: '',
        modified: true,
        dirty: true,
        editVersion: 0,
        passwordLength: 12,
        db: {
            removedLocalEditState: 0,
            removeLocalEditState() {
                this.removedLocalEditState++;
            }
        },
        set(values) {
            Object.assign(this, values);
        },
        setModified() {
            this.set({ modified: true, dirty: true, editVersion: this.editVersion + 1 });
        },
        setOpenFile() {},
        forEachEntry() {},
        getData(callback) {
            callback(new Uint8Array([this.editVersion + 1]).buffer);
        },
        getLocalEditState() {
            return { editVersion: this.editVersion };
        },
        ...attrs
    };
}

export { fileInfo, syncedFile };
