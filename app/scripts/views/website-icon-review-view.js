import { View } from 'framework/views/view';
import { Events } from 'framework/events';
import { IconMap } from 'const/icon-map';
import { withWhiteIconBackground } from 'comp/icons/website-icon';
import {
    collectIconCandidates,
    reviewWebsiteIcons,
    applyIconProposals
} from 'comp/icons/website-icon-review';
import template from 'templates/website-icon-review.hbs';

class WebsiteIconReviewView extends View {
    parent = '.app__panel';
    template = template;
    events = {
        'click .back-button': 'close',
        'click .icon-review__start': 'start',
        'click .icon-review__cancel': 'cancel',
        'click .icon-review__all': 'selectAll',
        'click .icon-review__none': 'selectNone',
        'change .icon-review__choice': 'selectProposal',
        'change .icon-review__white': 'changeBackground',
        'click .icon-review__apply': 'apply'
    };

    constructor(model) {
        super(model);
        this.scope = collectIconCandidates(model.files);
        this.state = 'ready';
        this.result = { proposals: [], checked: 0, unchanged: 0, failed: 0 };
        this.listenTo(model.files, 'change', this.cancel);
    }

    render() {
        super.render({
            ready: this.state === 'ready',
            scanning: this.state === 'scanning',
            reviewed: this.state === 'reviewed',
            cancelled: this.state === 'cancelled',
            done: this.state === 'done',
            total: this.scope.candidates.length,
            skipped: this.scope.skipped,
            canStart: this.scope.candidates.length > 0,
            ...this.result,
            ...this.applied,
            proposals: this.result.proposals.map((proposal, index) => ({
                index,
                title: proposal.entry.title,
                fileName: proposal.entry.file.name,
                host: proposal.host,
                oldIcon: proposal.oldIcon,
                icon: IconMap[proposal.iconId] || 'key',
                image: proposal.whiteBackground ? proposal.whiteImage : proposal.image,
                whiteBackground: proposal.whiteBackground,
                selected: proposal.selected
            }))
        });
        this.updateSelection();
    }

    async start() {
        if (this.state !== 'ready') return;
        this.controller = new AbortController();
        this.state = 'scanning';
        this.render();
        this.result = await reviewWebsiteIcons(this.scope.candidates, {
            signal: this.controller.signal,
            onProgress: (checked) => {
                if (!this.removed) this.$el.find('.icon-review__checked').text(checked);
            }
        });
        if (this.removed) return;
        this.state = this.controller.signal.aborted ? 'cancelled' : 'reviewed';
        this.render();
    }

    cancel() {
        this.controller?.abort();
    }

    selectProposal(event) {
        const index = Number(event.target.dataset.index);
        this.result.proposals[index].selected = event.target.checked;
        this.updateSelection();
    }

    selectAll() {
        this.setSelection(true);
    }

    async changeBackground(event) {
        const input = event.target;
        const proposal = this.result.proposals[Number(input.dataset.index)];
        input.disabled = true;
        this.pendingBackgrounds = (this.pendingBackgrounds || 0) + 1;
        this.updateSelection();
        try {
            if (input.checked && !proposal.whiteImage) {
                proposal.whiteImage = await withWhiteIconBackground(proposal.image);
            }
            if (this.removed) return;
            proposal.whiteBackground = input.checked;
            input
                .closest('.icon-review__row')
                .querySelector('.icon-review__new-image').src = proposal.whiteBackground
                ? proposal.whiteImage
                : proposal.image;
        } catch {
            input.checked = !!proposal.whiteBackground;
            this.$el.find('.icon-review__background-error').removeClass('hide');
        } finally {
            input.disabled = false;
            this.pendingBackgrounds--;
            if (!this.removed) this.updateSelection();
        }
    }

    selectNone() {
        this.setSelection(false);
    }

    setSelection(selected) {
        this.result.proposals.forEach((proposal) => (proposal.selected = selected));
        this.$el.find('.icon-review__choice').prop('checked', selected);
        this.updateSelection();
    }

    updateSelection() {
        const count = this.result.proposals.filter((proposal) => proposal.selected).length;
        this.$el.find('.icon-review__selected').text(count);
        this.$el.find('.icon-review__apply').prop('disabled', !count || !!this.pendingBackgrounds);
    }

    apply() {
        if (this.pendingBackgrounds || (this.state !== 'reviewed' && this.state !== 'cancelled')) {
            return;
        }
        this.applied = applyIconProposals(this.result.proposals, this.model.files);
        this.state = 'done';
        this.render();
        Events.emit('refresh');
    }

    close() {
        this.emit('close');
    }

    remove() {
        this.cancel();
        super.remove();
    }
}

export { WebsiteIconReviewView };
