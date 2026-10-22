import { passwordStrength, PasswordStrengthLevel } from 'util/data/password-strength';

const DefaultOldYears = 2;

function getPasswordAuditEntry(entry, settings = {}) {
    if (settings.auditPasswords === false || !entry) {
        return null;
    }
    if (typeof entry.canCheckPasswordIssues === 'function' && !entry.canCheckPasswordIssues()) {
        return null;
    }
    const password = entry.password;
    if (!password || !password.isProtected || !password.byteLength) {
        return null;
    }
    const strength = passwordStrength(password);
    if (isPinExcluded(strength, settings.excludePinsFromAudit !== false)) {
        return null;
    }
    return { password, strength };
}

function isPinExcluded(strength, excludePins) {
    return !!(excludePins && strength.onlyDigits && strength.length <= 6);
}

function isOldPassword(entry, years) {
    if (!years || !entry || !entry.updated) {
        return false;
    }
    const dt = new Date(entry.updated);
    dt.setFullYear(dt.getFullYear() + years);
    return dt.getTime() < Date.now();
}

function collectEntries(files) {
    const entries = [];
    if (!files) {
        return entries;
    }
    files.forEach((file) => {
        if (!file || file.backend === 'otp-device' || typeof file.forEachEntry !== 'function') {
            return;
        }
        file.forEachEntry({}, (entry) => {
            entries.push(entry);
        });
    });
    return entries;
}

function presentEntry(entry, extra) {
    return {
        id: entry.id,
        title: entry.title || '',
        user: entry.user || '',
        fileName: entry.file && entry.file.name,
        updated: entry.updated,
        entry,
        ...extra
    };
}

function auditPasswords(files, settings = {}) {
    if (settings.auditPasswords === false) {
        return {
            disabled: true,
            weak: [],
            reused: [],
            old: [],
            oldYears: 0,
            checked: 0
        };
    }
    const auditEntropy = settings.auditPasswordEntropy !== false;
    const oldYears =
        settings.auditPasswordAge == null
            ? DefaultOldYears
            : Math.max(0, settings.auditPasswordAge);

    const audited = [];
    for (const entry of collectEntries(files)) {
        const auditEntry = getPasswordAuditEntry(entry, settings);
        if (!auditEntry) {
            continue;
        }
        audited.push({ entry, strength: auditEntry.strength });
    }
    const entries = audited.map((item) => item.entry);
    const weak = [];
    const old = [];

    for (const { entry, strength } of audited) {
        if (auditEntropy && strength.level < PasswordStrengthLevel.Good) {
            weak.push(
                presentEntry(entry, {
                    severity: strength.level < PasswordStrengthLevel.Low ? 'poor' : 'weak'
                })
            );
        }
        if (isOldPassword(entry, oldYears)) {
            old.push(presentEntry(entry));
        }
    }

    const unused = entries.slice();
    const reused = [];
    while (unused.length) {
        const first = unused.shift();
        const group = [first];
        for (let i = unused.length - 1; i >= 0; i--) {
            if (first.password.equals(unused[i].password)) {
                group.push(unused[i]);
                unused.splice(i, 1);
            }
        }
        if (group.length > 1) {
            reused.push({
                count: group.length,
                entries: group.map((entry) => presentEntry(entry))
            });
        }
    }

    return {
        disabled: false,
        weak,
        reused,
        old,
        oldYears,
        checked: entries.length
    };
}

function collectPasswordIssueIds(files, settings) {
    const report = auditPasswords(files, settings);
    const ids = new Set();
    for (const item of report.weak) {
        ids.add(item.id);
    }
    for (const item of report.old) {
        ids.add(item.id);
    }
    for (const group of report.reused) {
        for (const item of group.entries) {
            ids.add(item.id);
        }
    }
    return ids;
}

function findReusedEntries(entry, files, settings) {
    const others = [];
    const auditEntry = getPasswordAuditEntry(entry, settings);
    if (!auditEntry) {
        return others;
    }
    for (const other of collectEntries(files)) {
        if (!other || other.id === entry.id) {
            continue;
        }
        const otherAuditEntry = getPasswordAuditEntry(other, settings);
        if (!otherAuditEntry) {
            continue;
        }
        if (auditEntry.password.equals(otherAuditEntry.password)) {
            others.push({
                id: other.id,
                title: other.title || '',
                user: other.user || ''
            });
        }
    }
    return others;
}

function describePasswordIssues(entry, files, settings = {}) {
    const auditEntry = getPasswordAuditEntry(entry, settings);
    if (!auditEntry) {
        return [];
    }
    const auditEntropy = settings.auditPasswordEntropy !== false;
    const oldYears =
        settings.auditPasswordAge == null
            ? DefaultOldYears
            : Math.max(0, settings.auditPasswordAge);
    const { strength } = auditEntry;
    const issues = [];
    if (auditEntropy && strength.level < PasswordStrengthLevel.Low) {
        issues.push({ type: 'poor' });
    } else if (auditEntropy && strength.level < PasswordStrengthLevel.Good) {
        issues.push({ type: 'weak' });
    }
    const reused = findReusedEntries(entry, files, settings);
    if (reused.length) {
        issues.push({
            type: 'reused',
            count: reused.length + 1,
            entries: reused
        });
    }
    if (isOldPassword(entry, oldYears)) {
        issues.push({ type: 'old', years: oldYears, singleYear: oldYears === 1 });
    }
    return issues;
}

export {
    auditPasswords,
    collectPasswordIssueIds,
    describePasswordIssues,
    getPasswordAuditEntry,
    isOldPassword,
    DefaultOldYears
};
