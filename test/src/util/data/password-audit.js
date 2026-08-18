import { expect } from 'chai';
import { ProtectedValue } from 'kdbxweb';
import 'util/kdbxweb/protected-value-ex';
import {
    auditPasswords,
    collectPasswordIssueIds,
    describePasswordIssues
} from 'util/data/password-audit';

function entry(id, title, password, extra = {}) {
    return {
        id,
        title,
        user: extra.user || '',
        password: ProtectedValue.fromString(password),
        updated: extra.updated,
        file: extra.fileName ? { name: extra.fileName } : null,
        canCheckPasswordIssues() {
            return !extra.ignore;
        }
    };
}

function file(entries) {
    return {
        forEachEntry(filter, callback) {
            entries.forEach(callback);
        }
    };
}

describe('password audit', () => {
    it('flags very weak and weak passwords', () => {
        const report = auditPasswords([
            file([
                entry('a', 'Short', 'ab'),
                entry('b', 'Medium', 'password'),
                entry('c', 'Strong', 'correct-horse-battery-staple-92!')
            ])
        ]);
        expect(report.weak.map((item) => item.id)).to.eql(['a', 'b']);
        expect(report.weak[0].severity).to.eql('poor');
        expect(report.weak[1].severity).to.eql('weak');
    });

    it('groups reused passwords without exposing the secret', () => {
        const report = auditPasswords([
            file([
                entry('a', 'Mail', 'same-secret-99!', { user: 'a@x' }),
                entry('b', 'Shop', 'same-secret-99!', { user: 'b@x' }),
                entry('c', 'Bank', 'other-secret-99!')
            ])
        ]);
        expect(report.reused).to.have.length(1);
        expect(report.reused[0].count).to.eql(2);
        expect(report.reused[0].entries.map((item) => item.id).sort()).to.eql(['a', 'b']);
        expect(JSON.stringify(report.reused)).to.not.include('same-secret');
    });

    it('flags old passwords using the configured age', () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 3);
        const report = auditPasswords(
            [
                file([
                    entry('a', 'Legacy', 'correct-horse-battery-staple-92!', { updated: oldDate }),
                    entry('b', 'Fresh', 'correct-horse-battery-staple-93!', { updated: new Date() })
                ])
            ],
            { auditPasswordAge: 2 }
        );
        expect(report.old.map((item) => item.id)).to.eql(['a']);
        expect(report.oldYears).to.eql(2);
    });

    it('does not flag old passwords when age warnings are disabled', () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 10);
        const report = auditPasswords(
            [
                file([
                    entry('old', 'Legacy', 'correct-horse-battery-staple-92!', {
                        updated: oldDate
                    })
                ])
            ],
            { auditPasswordAge: 0 }
        );

        expect(report.old).to.eql([]);
        expect(report.oldYears).to.eql(0);
    });

    it('returns no issues when password auditing is disabled', () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 10);
        const weak = entry('weak', 'Weak', 'ab', { updated: oldDate });
        const reused = entry('reused', 'Reused', 'ab', { updated: oldDate });
        const files = [file([weak, reused])];
        const settings = { auditPasswords: false, auditPasswordAge: 1 };

        expect(auditPasswords(files, settings)).to.include({ checked: 0 });
        expect(auditPasswords(files, settings).weak).to.eql([]);
        expect(auditPasswords(files, settings).reused).to.eql([]);
        expect(auditPasswords(files, settings).old).to.eql([]);
        expect(describePasswordIssues(weak, files, settings)).to.eql([]);
        expect(collectPasswordIssueIds(files, settings).size).to.eql(0);
    });

    it('skips ignored entries and PIN-like codes', () => {
        const report = auditPasswords(
            [
                file([
                    entry('pin', 'Card PIN', '1234'),
                    entry('skip', 'Ignored', 'ab', { ignore: true }),
                    entry('keep', 'Short', 'ab')
                ])
            ],
            { excludePinsFromAudit: true }
        );
        expect(report.weak.map((item) => item.id)).to.eql(['keep']);
        expect(report.checked).to.eql(1);
    });

    it('collects unique ids for weak, reused, and old passwords', () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 3);
        const ids = collectPasswordIssueIds(
            [
                file([
                    entry('weak', 'Short', 'ab'),
                    entry('reused-a', 'Mail', 'same-secret-99!'),
                    entry('reused-b', 'Shop', 'same-secret-99!'),
                    entry('old', 'Legacy', 'correct-horse-battery-staple-92!', {
                        updated: oldDate
                    }),
                    entry('ok', 'Fine', 'correct-horse-battery-staple-93!', {
                        updated: new Date()
                    })
                ])
            ],
            { auditPasswordAge: 2 }
        );
        expect([...ids].sort()).to.eql(['old', 'reused-a', 'reused-b', 'weak']);
    });

    it('keeps PIN-like entries out of reuse in report and description alike', () => {
        const pinA = entry('pin-a', 'Card PIN', '123456');
        const pinB = entry('pin-b', 'Other PIN', '123456');
        const files = [file([pinA, pinB])];
        const settings = { excludePinsFromAudit: true };

        const report = auditPasswords(files, settings);
        expect(report.reused).to.have.length(0);

        expect(describePasswordIssues(pinA, files, settings)).to.have.length(0);
        expect(describePasswordIssues(pinB, files, settings)).to.have.length(0);
    });

    it('describes all issues for a single entry', () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 3);
        const reusedA = entry('reused-a', 'Mail', 'same-secret-99!', { updated: oldDate });
        const reusedB = entry('reused-b', 'Shop', 'same-secret-99!');
        const issues = describePasswordIssues(reusedA, [file([reusedA, reusedB])], {
            auditPasswordAge: 2
        });
        expect(issues.map((issue) => issue.type)).to.eql(['reused', 'old']);
        expect(issues[0].count).to.eql(2);
        expect(issues[0].entries.map((item) => item.id)).to.eql(['reused-b']);
        expect(issues[0].entries[0].title).to.eql('Shop');
        expect(issues[1].years).to.eql(2);
    });
});
