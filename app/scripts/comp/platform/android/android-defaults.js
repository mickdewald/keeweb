import { AppSettingsModel } from 'models/app-settings-model';
import { RuntimeDataModel } from 'models/runtime-data-model';

const AndroidDefaults = {
    // Timeout: how often the master password is required anyway (0 would disable biometrics).
    values: { deviceOwnerAuth: 'file', deviceOwnerAuthTimeoutMinutes: 10080, clipboardSeconds: 30 },

    apply(settings = AppSettingsModel, runtimeData = RuntimeDataModel) {
        if (runtimeData.androidDefaultsApplied) {
            return false;
        }
        settings.set({ ...this.values });
        runtimeData.androidDefaultsApplied = true;
        return true;
    }
};

export { AndroidDefaults };
