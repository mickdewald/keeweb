import baron from 'baron';
import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { AppSettingsModel } from 'models/app-settings-model';
import { DateFormat } from 'comp/i18n/date-format';
import { auditPasswords } from 'util/data/password-audit';
import { Features } from 'util/features';
import { Locale } from 'util/locale';
import template from 'templates/password-health.hbs';

const ScrollBarHideMs = 700;

class PasswordHealthView extends View {
    parent = '.app__panel';

    template = template;

    events = {
        'click .back-button': 'close',
        'click .pw-health__entry': 'entryClicked'
    };

    report = null;
    columnScrolls = [];
    scrollHideTimers = new Map();

    constructor(model, options) {
        super(model, options);
        this.onListScroll = this.onListScroll.bind(this);
        this.listenTo(Events, 'page-geometry', this.updateColumnScrolls);
        this.once('remove', () => this.removeColumnScrolls());
    }

    render() {
        this.removeColumnScrolls();
        this.report = auditPasswords(this.model.files, AppSettingsModel);
        const reusedEntries = this.report.reused.reduce((sum, group) => sum + group.count, 0);
        const ok =
            !this.report.weak.length && !this.report.reused.length && !this.report.old.length;
        super.render({
            ok,
            summary: Locale.pwHealthSummary
                .replace('{}', this.report.weak.length)
                .replace('{}', reusedEntries)
                .replace('{}', this.report.old.length),
            weak: this.report.weak,
            reused: this.report.reused.map((group) => ({
                label: Locale.pwHealthReusedCount.replace('{}', group.count),
                entries: group.entries
            })),
            reusedEntries,
            old: this.report.old.map((item) => ({
                ...item,
                updated: item.updated ? DateFormat.dStr(item.updated) : ''
            })),
            oldHint: Locale.pwHealthOldHint.replace('{}', this.report.oldYears)
        });
        this.createColumnScrolls();
    }

    createColumnScrolls() {
        if (Features.isMobile || !this.el) {
            return;
        }
        this.$el.find('.pw-health__list').each((_, list) => {
            const scroller = list.querySelector('.scroller');
            const bar = list.querySelector('.scroller__bar');
            if (!scroller || !bar) {
                return;
            }
            this.columnScrolls.push(
                baron({
                    root: list,
                    scroller,
                    bar
                })
            );
            scroller.addEventListener('scroll', this.onListScroll);
        });
        this.updateColumnScrolls();
    }

    updateColumnScrolls() {
        this.columnScrolls.forEach((scroll) => {
            try {
                scroll.update();
            } catch {}
        });
        requestAnimationFrame(() => {
            if (this.removed) {
                return;
            }
            this.columnScrolls.forEach((scroll) => {
                try {
                    scroll.update();
                } catch {}
            });
            if (!this.el) {
                return;
            }
            this.$el.find('.pw-health__list').each((_, list) => {
                const bar = list.querySelector('.scroller__bar');
                const wrapper = list.querySelector('.scroller__bar-wrapper');
                if (!bar || !wrapper) {
                    return;
                }
                wrapper.classList.toggle(
                    'invisible',
                    Math.round(bar.offsetHeight) >= Math.round(wrapper.offsetHeight)
                );
            });
        });
    }

    removeColumnScrolls() {
        this.scrollHideTimers.forEach((timer) => clearTimeout(timer));
        this.scrollHideTimers.clear();
        if (this.el) {
            this.$el.find('.pw-health__list .scroller').each((_, scroller) => {
                scroller.removeEventListener('scroll', this.onListScroll);
            });
            this.$el.find('.pw-health__list').removeClass('pw-health__list--scrolling');
        }
        this.columnScrolls.forEach((scroll) => {
            try {
                scroll.dispose();
            } catch {}
        });
        this.columnScrolls = [];
    }

    onListScroll(e) {
        const list = e.currentTarget.closest('.pw-health__list');
        if (!list) {
            return;
        }
        list.classList.add('pw-health__list--scrolling');
        const prev = this.scrollHideTimers.get(list);
        if (prev) {
            clearTimeout(prev);
        }
        this.scrollHideTimers.set(
            list,
            setTimeout(() => {
                list.classList.remove('pw-health__list--scrolling');
                this.scrollHideTimers.delete(list);
            }, ScrollBarHideMs)
        );
    }

    close() {
        this.emit('close');
    }

    entryClicked(e) {
        const item = e.target.closest('.pw-health__entry');
        if (!item) {
            return;
        }
        const id = item.getAttribute('data-id');
        const found = this.findEntry(id);
        if (found) {
            this.emit('select', found);
        }
    }

    findEntry(id) {
        const report = this.report;
        if (!report) {
            return null;
        }
        const fromWeak = report.weak.find((item) => item.id === id);
        if (fromWeak) {
            return fromWeak.entry;
        }
        const fromOld = report.old.find((item) => item.id === id);
        if (fromOld) {
            return fromOld.entry;
        }
        for (const group of report.reused) {
            const match = group.entries.find((item) => item.id === id);
            if (match) {
                return match.entry;
            }
        }
        return null;
    }
}

export { PasswordHealthView };
