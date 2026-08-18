import * as kdbxweb from 'kdbxweb';
import { KdbxToHtml } from 'comp/format/kdbx-to-html';
import { Logger } from 'util/logger';

const logger = new Logger('file');

const FileModelSerializationMixin = {
    getData(cb) {
        this.db.cleanup({
            historyRules: true,
            customIcons: true,
            binaries: true
        });
        this.db.cleanup({ binaries: true });
        this.db
            .save()
            .then((data) => {
                cb(data);
            })
            .catch((err) => {
                logger.error('Error saving file', this.name, err);
                cb(undefined, err);
            });
    },

    getXml(cb) {
        this.db.saveXml(true).then((xml) => {
            cb(xml);
        });
    },

    getHtml(cb) {
        cb(
            KdbxToHtml.convert(this.db, {
                name: this.name
            })
        );
    },

    getKeyFileHash() {
        const hash = this.db.credentials.keyFileHash;
        return hash ? kdbxweb.ByteUtils.bytesToBase64(hash.getBinary()) : null;
    },

    forEachEntryTemplate(callback) {
        if (!this.db.meta.entryTemplatesGroup) {
            return;
        }
        const group = this.getGroup(this.subId(this.db.meta.entryTemplatesGroup.id));
        if (!group) {
            return;
        }
        group.forEachOwnEntry({}, callback);
    }
};

export { FileModelSerializationMixin };
