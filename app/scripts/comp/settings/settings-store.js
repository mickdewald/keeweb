import { Launcher } from 'comp/launcher';
import { StringFormat } from 'util/formatting/string-format';
import { Logger } from 'util/logger';

const logger = new Logger('settings');

const SettingsStore = {
    load(key) {
        let loadPromise;
        if (Launcher) {
            loadPromise = Launcher.loadConfig(key);
        } else {
            loadPromise = Promise.resolve().then(() => {
                return localStorage[StringFormat.camelCase(key)];
            });
        }
        return loadPromise
            .then((data) => (data ? JSON.parse(data) : null))
            .catch((err) => {
                logger.error(`Error loading ${key}`, err);
            });
    },

    save(key, data) {
        let savePromise;
        if (Launcher) {
            savePromise = Launcher.saveConfig(key, JSON.stringify(data));
        } else {
            savePromise = Promise.resolve().then(() => {
                if (typeof localStorage !== 'undefined') {
                    localStorage[StringFormat.camelCase(key)] = JSON.stringify(data);
                }
            });
        }
        savePromise.catch((err) => {
            logger.error(`Error saving ${key}`, err);
        });
        return savePromise;
    }
};

export { SettingsStore };
