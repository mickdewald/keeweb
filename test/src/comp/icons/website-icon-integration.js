import { expect } from 'chai';
import $ from 'jquery';
import { FileModel } from 'models/file-model';
import { EntryModel } from 'models/entry-model';
import { FileCollection } from 'collections/file-collection';
import { WebsiteIconReviewView } from 'views/website-icon-review-view';
import { normalizeIconImage, withWhiteIconBackground } from 'comp/icons/website-icon';
import {
    collectIconCandidates,
    reviewWebsiteIcons,
    applyIconProposals
} from 'comp/icons/website-icon-review';

function database() {
    const file = new FileModel();
    file.create('Icon test', () => {});
    const entry = EntryModel.newEntry(file.groups[0], file);
    entry.setField('Title', 'Test website');
    entry.setField('URL', 'https://wikipedia.org');
    return { file, entry, files: new FileCollection([file]) };
}

function testImage() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ab1234';
    ctx.fillRect(0, 0, 32, 32);
    return canvas.toDataURL();
}

describe('website icon integration', () => {
    it('composites a dark transparent logo on white without changing the source', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(8, 8, 16, 16);
        const source = canvas.toDataURL();
        const result = await withWhiteIconBackground(source);
        const image = new Image();
        image.src = result;
        await image.decode();
        ctx.clearRect(0, 0, 32, 32);
        ctx.drawImage(image, 0, 0);
        expect([...ctx.getImageData(0, 0, 1, 1).data]).to.deep.equal([255, 255, 255, 255]);
        expect([...ctx.getImageData(16, 16, 1, 1).data]).to.deep.equal([0, 0, 0, 255]);
        expect(result).not.to.equal(source);
    });

    it('applies the chosen white variant and does not propose the same dark original again', async () => {
        const { entry, files } = database();
        const image = testImage();
        const { proposals } = await reviewWebsiteIcons(collectIconCandidates(files).candidates, {
            download: async () => image
        });
        proposals[0].whiteImage = await withWhiteIconBackground(image);
        proposals[0].whiteBackground = true;
        proposals[0].selected = true;
        expect(applyIconProposals(proposals, files).applied).to.equal(1);
        expect(entry.customIcon).to.equal(proposals[0].whiteImage);
        const next = await reviewWebsiteIcons(collectIconCandidates(files).candidates, {
            download: async () => image
        });
        expect(next.unchanged).to.equal(1);
        expect(next.proposals.length).to.equal(0);
    });

    it('writes real KDBX custom icons only on apply and then detects them as unchanged', async () => {
        const { file, entry, files } = database();
        const image = await normalizeIconImage(testImage());
        const oldIcon = entry.customIconId;
        const first = await reviewWebsiteIcons(collectIconCandidates(files).candidates, {
            download: async () => image
        });
        expect(first.proposals.length).to.equal(1);
        expect(entry.customIconId).to.equal(oldIcon);
        first.proposals[0].selected = true;
        expect(applyIconProposals(first.proposals, files).applied).to.equal(1);
        expect(file.db.meta.customIcons.has(entry.customIconId)).to.equal(true);
        expect(entry.customIcon).to.equal(image);
        expect(file.modified).to.equal(true);
        const next = await reviewWebsiteIcons(collectIconCandidates(files).candidates, {
            download: async () => image
        });
        expect(next.unchanged).to.equal(1);
        expect(next.proposals.length).to.equal(0);
    });

    it('does not handle the start click as cancel when morphdom updates the button', () => {
        const fixture = database();
        const panel = document.createElement('div');
        panel.className = 'app__panel';
        document.body.appendChild(panel);
        const view = new WebsiteIconReviewView({ files: fixture.files });
        const originalTemplate = view.template;
        view.template = (data, options) =>
            originalTemplate(data, { ...options, helpers: { res: (key) => key } });
        const hadJquery = Object.prototype.hasOwnProperty.call(window, '$');
        const previousJquery = window.$;
        window.$ = $;
        try {
            view.render();
            // Settle asynchronously without sending fixture data to the network.
            view.scope.candidates = [];
            view.el.querySelector('.icon-review__start').click();
            expect(view.controller.signal.aborted).to.equal(false);
            expect(view.state).to.equal('scanning');
        } finally {
            if (view.el) view.remove();
            panel.remove();
            if (hadJquery) window.$ = previousJquery;
            else delete window.$;
        }
    });
});
