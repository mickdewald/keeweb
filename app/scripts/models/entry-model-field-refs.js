import * as kdbxweb from 'kdbxweb';

const FieldRefRegex = /^\{REF:([TNPAU])@I:(\w{32})}$/;
const FieldRefFields = ['title', 'password', 'user', 'url', 'notes'];
const FieldRefIds = { T: 'Title', U: 'UserName', P: 'Password', A: 'URL', N: 'Notes' };

const EntryModelFieldRefsMixin = {
    resolveFieldReferences() {
        this.hasFieldRefs = false;
        FieldRefFields.forEach((field) => {
            const fieldValue = this[field];
            const refValue = this._resolveFieldReference(fieldValue);
            if (refValue !== undefined) {
                this[field] = refValue;
                this.hasFieldRefs = true;
            }
        });
    },

    getFieldValue(field) {
        field = field.toLowerCase();
        let resolvedField;
        [...this.entry.fields.keys()].some((entryField) => {
            if (entryField.toLowerCase() === field) {
                resolvedField = entryField;
                return true;
            }
            return false;
        });
        if (resolvedField) {
            let fieldValue = this.entry.fields.get(resolvedField);
            const refValue = this._resolveFieldReference(fieldValue);
            if (refValue !== undefined) {
                fieldValue = refValue;
            }
            return fieldValue;
        }
    },

    _resolveFieldReference(fieldValue) {
        if (!fieldValue) {
            return;
        }
        if (fieldValue.isProtected && fieldValue.isFieldReference()) {
            fieldValue = fieldValue.getText();
        }
        if (typeof fieldValue !== 'string') {
            return;
        }
        const match = fieldValue.match(FieldRefRegex);
        if (!match) {
            return;
        }
        return this._getReferenceValue(match[1], match[2]);
    },

    _getReferenceValue(fieldRefId, idStr) {
        const id = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
            id[i] = parseInt(idStr.substr(i * 2, 2), 16);
        }
        const uuid = new kdbxweb.KdbxUuid(id);
        const entry = this.file.getEntry(this.file.subId(uuid.id));
        if (!entry) {
            return;
        }
        return entry.entry.fields.get(FieldRefIds[fieldRefId]);
    }
};

export { EntryModelFieldRefsMixin };
