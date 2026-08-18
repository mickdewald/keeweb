import { expect } from 'chai';
import { AppSettingsModel } from 'models/app-settings-model';
import { DetailsIssuesView } from 'views/details/details-issues-view';

describe('DetailsIssuesView', () => {
    it('does not access the password for an online check when auditing is disabled', () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const previousCheckPasswordsOnHIBP = AppSettingsModel.checkPasswordsOnHIBP;
        const model = {};
        Object.defineProperty(model, 'password', {
            get() {
                throw new Error('password must not be accessed');
            }
        });

        AppSettingsModel.auditPasswords = false;
        AppSettingsModel.checkPasswordsOnHIBP = true;
        try {
            expect(() =>
                DetailsIssuesView.prototype.checkOnHIBP.call({
                    hibpCheckGeneration: 0,
                    model
                })
            ).to.not.throw();
        } finally {
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            AppSettingsModel.checkPasswordsOnHIBP = previousCheckPasswordsOnHIBP;
        }
    });
});
