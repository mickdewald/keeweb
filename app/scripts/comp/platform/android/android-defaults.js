import { AppSettingsModel } from 'models/app-settings-model';
import { RuntimeDataModel } from 'models/runtime-data-model';

const AndroidDefaults = {
    values: { deviceOwnerAuth: 'file', clipboardSeconds: 30 },

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
