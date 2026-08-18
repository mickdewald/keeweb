import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import template from 'templates/details/details-issues.hbs';
import { Alerts } from 'comp/ui/alerts';
import { Timeouts } from 'const/timeouts';
import { Locale } from 'util/locale';
import { describePasswordIssues } from 'util/data/password-audit';
import { AppSettingsModel } from 'models/app-settings-model';
import { AppModel } from 'models/app-model';
import { Links } from 'const/links';
import { checkIfPasswordIsExposedOnline } from 'comp/app/online-password-checker';

function issuesKey(issues) {
    return (issues || [])
        .map((issue) => `${issue.type}:${issue.count || ''}:${issue.years || ''}`)
        .join('|');
}

class DetailsIssuesView extends View {
    parent = '.details__issues-container';

    template = template;

    events = {
        'click .details__issues-close-btn': 'closeIssuesClick'
    };

    passwordIssues = [];

    constructor(model) {
        super(model);
        this.listenTo(AppSettingsModel, 'change', this.settingsChanged);
        this.checkPasswordIssues();
    }

    render(options) {
        super.render({
            hibpLink: Links.HaveIBeenPwned,
            hasPasswordIssues: this.passwordIssues.length > 0,
            passwordIssues: this.passwordIssues,
            fadeIn: options?.fadeIn
        });
    }

    settingsChanged() {
        this.checkPasswordIssues();
        this.render();
    }

    passwordChanged() {
        const oldKey = issuesKey(this.passwordIssues);
        this.checkPasswordIssues();
        const nextKey = issuesKey(this.passwordIssues);
        if (oldKey !== nextKey) {
            const fadeIn = !oldKey;
            if (this.passwordIssues.length) {
                this.render({ fadeIn });
            } else {
                this.el.classList.add('fade-out');
                setTimeout(() => this.render(), Timeouts.FastAnimation);
            }
        }
    }

    checkPasswordIssues() {
        this.passwordIssues = describePasswordIssues(
            this.model,
            AppModel.instance && AppModel.instance.files,
            AppSettingsModel
        );
        this.checkOnHIBP();
    }

    checkOnHIBP() {
        if (!AppSettingsModel.checkPasswordsOnHIBP) {
            return;
        }
        const password = this.model.password;
        if (!password || !password.isProtected || !password.byteLength) {
            return;
        }
        const isExposed = checkIfPasswordIsExposedOnline(password);
        if (typeof isExposed === 'boolean') {
            this.setRemoteIssue(isExposed ? 'pwned' : null);
        } else {
            const iconEl = this.el?.querySelector('.details__issues-icon');
            iconEl?.classList.add('details__issues-icon--loading');
            isExposed.then((exposed) => {
                if (exposed) {
                    this.setRemoteIssue('pwned');
                } else if (exposed === false) {
                    this.setRemoteIssue(null);
                } else {
                    this.setRemoteIssue(iconEl ? 'error' : null);
                }
                this.render();
            });
        }
    }

    setRemoteIssue(type) {
        this.passwordIssues = this.passwordIssues.filter(
            (issue) => issue.type !== 'pwned' && issue.type !== 'error'
        );
        if (type) {
            this.passwordIssues.push({ type });
        }
    }

    closeIssuesClick() {
        Alerts.alert({
            header: Locale.detIssueCloseAlertHeader,
            body: Locale.detIssueCloseAlertBody,
            icon: 'exclamation-triangle',
            buttons: [
                { result: 'entry', title: Locale.detIssueCloseAlertEntry, silent: true },
                { result: 'settings', title: Locale.detIssueCloseAlertSettings, silent: true },
                Alerts.buttons.cancel
            ],
            esc: '',
            click: '',
            success: (result) => {
                switch (result) {
                    case 'entry':
                        this.disableAuditForEntry();
                        break;
                    case 'settings':
                        this.openAuditSettings();
                        break;
                }
            }
        });
    }

    disableAuditForEntry() {
        this.model.setIgnorePasswordIssues();
        this.checkPasswordIssues();
        this.render();
    }

    openAuditSettings() {
        Events.emit('toggle-settings', 'general', 'audit');
    }
}

export { DetailsIssuesView };
