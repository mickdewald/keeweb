import { expect } from 'chai';
import { AppSettingsModel } from 'models/app-settings-model';
import { PasswordHealthView } from 'views/password-health-view';

describe('PasswordHealthView', () => {
    it('renders auditing disabled instead of an all-clear result without reading entries', () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const view = new PasswordHealthView({
            files: [
                {
                    forEachEntry() {
                        throw new Error('disabled auditing must not inspect entries');
                    }
                }
            ]
        });
        let rendered;
        view.renderElement = (data) => {
            rendered = data;
        };

        AppSettingsModel.auditPasswords = false;
        try {
            view.render();
            expect(view.report).to.include({ disabled: true, checked: 0 });
            expect(rendered).to.include({ disabled: true, ok: false });
        } finally {
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            view.removeColumnScrolls();
        }
    });

    it('renders an enabled empty audit as all clear', () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const view = new PasswordHealthView({ files: [] });
        let rendered;
        view.renderElement = (data) => {
            rendered = data;
        };

        AppSettingsModel.auditPasswords = true;
        try {
            view.render();
            expect(view.report).to.include({ disabled: false, checked: 0 });
            expect(rendered).to.include({ disabled: false, ok: true });
        } finally {
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            view.removeColumnScrolls();
        }
    });
});
