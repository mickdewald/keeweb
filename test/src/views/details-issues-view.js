import { expect } from 'chai';
import { AppSettingsModel } from 'models/app-settings-model';
import { Events } from 'framework/events';
import { DetailsIssuesView } from 'views/details/details-issues-view';
import { ProtectedValue } from 'kdbxweb';

async function passwordHash(password) {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

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

    it('does not start an online check for ignored entries or excluded PINs', () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const previousCheckPasswordsOnHIBP = AppSettingsModel.checkPasswordsOnHIBP;
        const previousExcludePinsFromAudit = AppSettingsModel.excludePinsFromAudit;
        const password = ProtectedValue.fromString('1234');
        let onlineChecks = 0;
        password.saltedValue = () => {
            onlineChecks++;
            throw new Error('online password check must not start');
        };
        const ignored = {
            canCheckPasswordIssues() {
                return false;
            },
            password
        };
        const excludedPin = { password };

        AppSettingsModel.auditPasswords = true;
        AppSettingsModel.checkPasswordsOnHIBP = true;
        AppSettingsModel.excludePinsFromAudit = true;
        try {
            expect(() =>
                DetailsIssuesView.prototype.checkOnHIBP.call({
                    hibpCheckGeneration: 0,
                    model: ignored
                })
            ).to.not.throw();
            expect(() =>
                DetailsIssuesView.prototype.checkOnHIBP.call({
                    hibpCheckGeneration: 0,
                    model: excludedPin
                })
            ).to.not.throw();
            expect(onlineChecks).to.equal(0);
        } finally {
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            AppSettingsModel.checkPasswordsOnHIBP = previousCheckPasswordsOnHIBP;
            AppSettingsModel.excludePinsFromAudit = previousExcludePinsFromAudit;
        }
    });

    it('checks eligible entries online and records a current pwned result', async () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const previousCheckPasswordsOnHIBP = AppSettingsModel.checkPasswordsOnHIBP;
        const previousExcludePinsFromAudit = AppSettingsModel.excludePinsFromAudit;
        const previousFetch = globalThis.fetch;
        const passwordText = 'eligible-online-check-93!';
        const hash = await passwordHash(passwordText);
        let fetchCalls = 0;
        let resolveRendered;
        const rendered = new Promise((resolve) => {
            resolveRendered = resolve;
        });
        const view = {
            hibpCheckGeneration: 0,
            model: { password: ProtectedValue.fromString(passwordText) },
            passwordIssues: [],
            setRemoteIssue: DetailsIssuesView.prototype.setRemoteIssue,
            applyOnlineCheckResult: DetailsIssuesView.prototype.applyOnlineCheckResult,
            render() {
                resolveRendered();
            }
        };

        globalThis.fetch = async (url) => {
            fetchCalls++;
            expect(url).to.equal(`https://api.pwnedpasswords.com/range/${hash.substr(0, 5)}`);
            return { text: async () => hash.substr(5) };
        };
        AppSettingsModel.auditPasswords = true;
        AppSettingsModel.checkPasswordsOnHIBP = true;
        AppSettingsModel.excludePinsFromAudit = false;
        try {
            DetailsIssuesView.prototype.checkOnHIBP.call(view);
            await rendered;
            expect(fetchCalls).to.equal(1);
            expect(view.passwordIssues).to.eql([{ type: 'pwned' }]);
        } finally {
            globalThis.fetch = previousFetch;
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            AppSettingsModel.checkPasswordsOnHIBP = previousCheckPasswordsOnHIBP;
            AppSettingsModel.excludePinsFromAudit = previousExcludePinsFromAudit;
        }
    });

    it('keeps a late online result absent after ignoring the entry', async () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const previousCheckPasswordsOnHIBP = AppSettingsModel.checkPasswordsOnHIBP;
        const previousExcludePinsFromAudit = AppSettingsModel.excludePinsFromAudit;
        const previousFetch = globalThis.fetch;
        const passwordText = 'late-online-check-94!';
        const hash = await passwordHash(passwordText);
        let ignored = false;
        let resolveResponse;
        let resolveFetchStarted;
        const fetchStarted = new Promise((resolve) => {
            resolveFetchStarted = resolve;
        });
        const view = Object.assign(Object.create(DetailsIssuesView.prototype), {
            hibpCheckGeneration: 0,
            model: {
                password: ProtectedValue.fromString(passwordText),
                canCheckPasswordIssues() {
                    return !ignored;
                },
                setIgnorePasswordIssues() {
                    ignored = true;
                }
            },
            passwordIssues: [],
            render() {}
        });

        globalThis.fetch = () =>
            new Promise((resolve) => {
                resolveFetchStarted();
                resolveResponse = () => resolve({ text: async () => hash.substr(5) });
            });
        AppSettingsModel.auditPasswords = true;
        AppSettingsModel.checkPasswordsOnHIBP = true;
        AppSettingsModel.excludePinsFromAudit = false;
        try {
            view.checkOnHIBP();
            await fetchStarted;
            view.disableAuditForEntry();
            resolveResponse();
            await new Promise((resolve) => setTimeout(resolve));
            expect(view.passwordIssues).to.eql([]);
        } finally {
            globalThis.fetch = previousFetch;
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            AppSettingsModel.checkPasswordsOnHIBP = previousCheckPasswordsOnHIBP;
            AppSettingsModel.excludePinsFromAudit = previousExcludePinsFromAudit;
        }
    });

    it('rejects stale online results after an entry becomes ignored', () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const model = {
            canCheckPasswordIssues() {
                return false;
            },
            password: {
                isProtected: true,
                byteLength: 4
            }
        };
        const view = {
            hibpCheckGeneration: 1,
            model,
            passwordIssues: [],
            setRemoteIssue() {
                throw new Error('stale result must not change issues');
            },
            render() {
                throw new Error('stale result must not render');
            }
        };

        AppSettingsModel.auditPasswords = true;
        try {
            DetailsIssuesView.prototype.applyOnlineCheckResult.call(view, 1, true, true);
        } finally {
            AppSettingsModel.auditPasswords = previousAuditPasswords;
        }
    });

    it('rejects stale online results after an entry becomes an excluded PIN', () => {
        const previousAuditPasswords = AppSettingsModel.auditPasswords;
        const previousExcludePinsFromAudit = AppSettingsModel.excludePinsFromAudit;
        const view = {
            hibpCheckGeneration: 2,
            model: {
                password: ProtectedValue.fromString('1234')
            },
            passwordIssues: [],
            setRemoteIssue() {
                throw new Error('stale result must not change issues');
            },
            render() {
                throw new Error('stale result must not render');
            }
        };

        AppSettingsModel.auditPasswords = true;
        AppSettingsModel.excludePinsFromAudit = true;
        try {
            DetailsIssuesView.prototype.applyOnlineCheckResult.call(view, 2, true, true);
        } finally {
            AppSettingsModel.auditPasswords = previousAuditPasswords;
            AppSettingsModel.excludePinsFromAudit = previousExcludePinsFromAudit;
        }
    });

    it('invalidates the list audit marker when auditing is ignored for an entry', () => {
        const model = {
            setIgnorePasswordIssues() {},
            id: 'entry-id'
        };
        let updated;
        const onUpdated = (event) => {
            updated = event;
        };
        Events.once('entry-updated', onUpdated);

        DetailsIssuesView.prototype.disableAuditForEntry.call({
            model,
            checkPasswordIssues() {},
            render() {}
        });

        expect(updated).to.eql({ entry: model });
    });
});
