import * as kdbxweb from 'kdbxweb';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { FileSaver } from 'util/ui/file-saver';
import { beginPendingMutation } from 'models/file-mutation-tracker';
import { Locale } from 'util/locale';
import { Alerts } from 'comp/ui/alerts';

function isActive(view, file, selectionId) {
    return (
        !view.removed &&
        file.active !== false &&
        view.model === file &&
        view.keyFileSelectionId === selectionId
    );
}

function zeroizeKeyFile(keyFile) {
    if (keyFile) {
        kdbxweb.ByteUtils.zeroBuffer(keyFile.buffer || keyFile);
    }
}

function showPickerError(err) {
    if (err && err.code !== 'CANCELED') {
        Alerts.error({
            header: Locale.setFileSaveError,
            body: Locale.setFileSaveErrorBody,
            pre: err.message || String(err)
        });
    }
}

const SettingsFileKeyFileMixin = {
    renderKeyFileSelect() {
        const keyFileName = this.model.keyFileName;
        const oldKeyFileName = this.model.oldKeyFileName;
        const keyFileChanged = this.model.keyFileChanged;
        const sel = this.$el.find('#settings__file-key-file');
        sel.empty();
        if (keyFileName && keyFileChanged) {
            const text =
                keyFileName !== 'Generated'
                    ? Locale.setFileUseKeyFile + ' ' + keyFileName
                    : Locale.setFileUseGenKeyFile;
            $('<option/>').val('ex').text(text).appendTo(sel);
        }
        if (oldKeyFileName) {
            const useText = keyFileChanged
                ? Locale.setFileUseOldKeyFile
                : Locale.setFileUseKeyFile + ' ' + oldKeyFileName;
            $('<option/>').val('old').text(useText).appendTo(sel);
        }
        $('<option/>').val('gen').text(Locale.setFileGenKeyFile).appendTo(sel);
        $('<option/>').val('none').text(Locale.setFileDontUseKeyFile).appendTo(sel);
        if (keyFileName && keyFileChanged) {
            sel.val('ex');
        } else if (!keyFileName) {
            sel.val('none');
        } else if (oldKeyFileName && keyFileName === oldKeyFileName && !keyFileChanged) {
            sel.val('old');
        }
    },

    keyFileChange(e) {
        this.keyFileSelectionId++;
        switch (e.target.value) {
            case 'old':
                this.selectOldKeyFile();
                break;
            case 'gen':
                this.generateKeyFile();
                break;
            case 'none':
                this.clearKeyFile();
                break;
        }
    },

    selectOldKeyFile() {
        this.model.resetKeyFile().then(() => this.renderKeyFileSelect());
    },

    generateKeyFile() {
        if (AndroidPlatform.isAndroid) {
            const file = this.model;
            const selectionId = ++this.keyFileSelectionId;
            const completeMutation = beginPendingMutation(file);
            Promise.resolve()
                .then(() => kdbxweb.Credentials.createRandomKeyFile())
                .then((keyFile) =>
                    FileSaver.saveAs(
                        new Blob([keyFile], { type: 'application/octet-stream' }),
                        file.name + '.key',
                        {
                            protectedUris:
                                file.storage === 'androiddoc' && file.path?.startsWith('content://')
                                    ? [file.path]
                                    : []
                        }
                    ).then((saveResult) => ({ keyFile, saveResult }))
                )
                .then(({ keyFile, saveResult }) => {
                    if (!saveResult.saved || !isActive(this, file, selectionId)) {
                        zeroizeKeyFile(keyFile);
                        return;
                    }
                    return file.setKeyFile(keyFile, 'Generated');
                })
                .then(() => isActive(this, file, selectionId) && this.renderKeyFileSelect())
                .catch(showPickerError)
                .finally(completeMutation);
            return;
        }
        this.model.generateAndSetKeyFile().then((keyFile) => {
            const blob = new Blob([keyFile], { type: 'application/octet-stream' });
            FileSaver.saveAs(blob, this.model.name + '.key').catch(() => {});
            this.renderKeyFileSelect();
        });
    },

    clearKeyFile() {
        this.model.removeKeyFile().then(() => this.renderKeyFileSelect());
    },

    triggerSelectFile() {
        if (AndroidPlatform.isAndroid) {
            const file = this.model;
            const selectionId = ++this.keyFileSelectionId;
            const completeMutation = beginPendingMutation(file);
            Promise.resolve()
                .then(() =>
                    AndroidPlatform.withNativeFlow(() =>
                        AndroidPlatform.plugin('DocumentFile').pickRead({ mimeType: '*/*' })
                    )
                )
                .then(({ data, name }) => {
                    if (!isActive(this, file, selectionId)) {
                        return;
                    }
                    const bytes = kdbxweb.ByteUtils.base64ToBytes(data);
                    return file.setKeyFile(
                        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
                        name
                    );
                })
                .then(() => isActive(this, file, selectionId) && this.renderKeyFileSelect())
                .catch(showPickerError)
                .finally(completeMutation);
            return;
        }
        this.$el.find('#settings__file-file-select').click();
    },

    fileSelected(e) {
        const selectedFile = e.target.files[0];
        const file = this.model;
        const selectionId = ++this.keyFileSelectionId;
        const completeMutation = beginPendingMutation(file);
        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (!isActive(this, file, selectionId)) {
                    return completeMutation();
                }
                file.setKeyFile(e.target.result, selectedFile.name).then(
                    () => {
                        if (isActive(this, file, selectionId)) {
                            this.renderKeyFileSelect();
                        }
                        completeMutation();
                    },
                    () => completeMutation()
                );
            };
            reader.onerror = (e) => {
                showPickerError(e.target.error);
                completeMutation();
            };
            reader.onabort = completeMutation;
            reader.readAsArrayBuffer(selectedFile);
        } catch (err) {
            showPickerError(err);
            completeMutation();
        }
    }
};

export { SettingsFileKeyFileMixin };
