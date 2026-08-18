import { passwordStrength, PasswordStrengthLevel } from 'util/data/password-strength';

const DefaultOldYears = 2;

function isAuditable(entry) {
    if (!entry) {
        return false;
    }
    if (typeof entry.canCheckPasswordIssues === 'function' && !entry.canCheckPasswordIssues()) {
        return false;
    }
    const password = entry.password;
    return !!(password && password.isProtected && password.byteLength);
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
    const auditEntropy = settings.auditPasswordEntropy !== false;
    const excludePins = settings.excludePinsFromAudit !== false;
    const oldYears = settings.auditPasswordAge > 0 ? settings.auditPasswordAge : DefaultOldYears;

    const audited = [];
    for (const entry of collectEntries(files)) {
        if (!isAuditable(entry)) {
            continue;
        }
        const strength = passwordStrength(entry.password);
        if (isPinExcluded(strength, excludePins)) {
            continue;
        }
        audited.push({ entry, strength });
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

function findReusedEntries(entry, files, excludePins) {
    const others = [];
    if (!isAuditable(entry)) {
        return others;
    }
    for (const other of collectEntries(files)) {
        if (!other || other.id === entry.id || !isAuditable(other)) {
            continue;
        }
        if (isPinExcluded(passwordStrength(other.password), excludePins)) {
            continue;
        }
        if (entry.password.equals(other.password)) {
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
    if (!isAuditable(entry)) {
        return [];
    }
    const auditEntropy = settings.auditPasswordEntropy !== false;
    const excludePins = settings.excludePinsFromAudit !== false;
    const oldYears = settings.auditPasswordAge > 0 ? settings.auditPasswordAge : DefaultOldYears;
    const strength = passwordStrength(entry.password);
    if (excludePins && isPinExcluded(strength, true)) {
        return [];
    }
    const issues = [];
    if (auditEntropy && strength.level < PasswordStrengthLevel.Low) {
        issues.push({ type: 'poor' });
    } else if (auditEntropy && strength.level < PasswordStrengthLevel.Good) {
        issues.push({ type: 'weak' });
    }
    const reused = findReusedEntries(entry, files, excludePins);
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
    isOldPassword,
    DefaultOldYears
};
