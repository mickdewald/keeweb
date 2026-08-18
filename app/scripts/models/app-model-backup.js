import { Storage } from 'storage';
import { DateFormat } from 'comp/i18n/date-format';
import { Launcher } from 'comp/launcher';
import { UrlFormat } from 'util/formatting/url-format';
import { Logger } from 'util/logger';
import { noop } from 'util/fn';

const AppModelBackupMixin = {
    setFileBackup(fileId, backup) {
        const fileInfo = this.fileInfos.get(fileId);
        if (fileInfo) {
            fileInfo.backup = backup;
        }
        this.fileInfos.save();
    },

    _ensureDefaultBackup(file) {
        let defaultPath = this.settings.backupDefaultPath;
        if (!Launcher || !defaultPath || file.backup || file.storage !== 'file') {
            return;
        }
        defaultPath = Launcher.expandHomePath(defaultPath);
        const backup = {
            enabled: true,
            storage: 'file',
            path: defaultPath + '/' + file.name + '.kdbx.{date}.bak',
            schedule: '1d',
            pending: true
        };
        file.backup = backup;
        this.setFileBackup(file.id, backup);
    },

    pruneBackups(backup, logger) {
        const maxCount = this.settings.backupMaxCount;
        if (!Launcher || !maxCount || backup.storage !== 'file') {
            return;
        }
        const sep = backup.path.lastIndexOf('/');
        const folder = backup.path.substring(0, sep);
        const namePattern = backup.path.substring(sep + 1);
        const dateIx = namePattern.indexOf('{date}');
        if (dateIx < 0) {
            return;
        }
        const prefix = namePattern.substring(0, dateIx);
        const suffix = namePattern.substring(dateIx + '{date}'.length);
        Launcher.listDir(folder, (err, entries) => {
            if (err || !entries) {
                return;
            }
            const backups = entries
                .filter(
                    (name) =>
                        name.length > prefix.length + suffix.length &&
                        name.startsWith(prefix) &&
                        name.endsWith(suffix)
                )
                .sort();
            for (const name of backups.slice(0, -maxCount)) {
                logger.info('Pruning old backup', name);
                Launcher.deleteFile(folder + '/' + name);
            }
        });
    },

    backupFile(file, data, callback) {
        const opts = file.opts;
        let backup = file.backup;
        const logger = new Logger('backup', file.name);
        if (!backup || !backup.storage || !backup.path) {
            return callback('Invalid backup settings');
        }
        let path = backup.path.replace('{date}', DateFormat.dtStrFs(new Date()));
        logger.info('Backup file to', backup.storage, path);
        const saveToFolder = () => {
            if (Storage[backup.storage].getPathForName) {
                path = Storage[backup.storage].getPathForName(path);
            }
            Storage[backup.storage].save(path, opts, data, (err) => {
                if (err) {
                    logger.error('Backup error', err);
                } else {
                    logger.info('Backup complete');
                    backup = file.backup;
                    backup.lastTime = Date.now();
                    delete backup.pending;
                    file.backup = backup;
                    this.setFileBackup(file.id, backup);
                    this.pruneBackups(backup, logger);
                }
                callback(err);
            });
        };
        let folderPath = UrlFormat.fileToDir(path);
        if (Storage[backup.storage].getPathForName) {
            folderPath = Storage[backup.storage].getPathForName(folderPath).replace('.kdbx', '');
        }
        Storage[backup.storage].stat(folderPath, opts, (err) => {
            if (err) {
                if (err.notFound) {
                    logger.info('Backup folder does not exist');
                    if (!Storage[backup.storage].mkdir) {
                        return callback('Mkdir not supported by ' + backup.storage);
                    }
                    Storage[backup.storage].mkdir(folderPath, (err) => {
                        if (err) {
                            logger.error('Error creating backup folder', err);
                            callback('Error creating backup folder');
                        } else {
                            logger.info('Backup folder created');
                            saveToFolder();
                        }
                    });
                } else {
                    logger.error('Stat folder error', err);
                    callback('Cannot stat backup folder');
                }
            } else {
                logger.info('Backup folder exists, saving');
                saveToFolder();
            }
        });
    },

    scheduleBackupFile(file, data) {
        const backup = file.backup;
        if (!backup || !backup.enabled) {
            return;
        }
        const logger = new Logger('backup', file.name);
        let needBackup = false;
        if (!backup.lastTime) {
            needBackup = true;
            logger.debug('No last backup time, backup now');
        } else {
            const dt = new Date(backup.lastTime);
            switch (backup.schedule) {
                case '0':
                    break;
                case '1d':
                    dt.setDate(dt.getDate() + 1);
                    break;
                case '1w':
                    dt.setDate(dt.getDate() + 7);
                    break;
                case '1m':
                    dt.setMonth(dt.getMonth() + 1);
                    break;
                default:
                    return;
            }
            if (dt.getTime() <= Date.now()) {
                needBackup = true;
            }
            logger.debug(
                'Last backup time: ' +
                    new Date(backup.lastTime) +
                    ', schedule: ' +
                    backup.schedule +
                    ', next time: ' +
                    dt +
                    ', ' +
                    (needBackup ? 'backup now' : 'skip backup')
            );
        }
        if (!backup.pending) {
            backup.pending = true;
            this.setFileBackup(file.id, backup);
        }
        if (needBackup) {
            this.backupFile(file, data, noop);
        }
    }
};

export { AppModelBackupMixin };
