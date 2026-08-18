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
