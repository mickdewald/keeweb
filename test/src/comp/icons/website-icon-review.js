import { expect } from 'chai';
import { websiteIconHost } from 'comp/icons/website-icon';
import {
    collectIconCandidates,
    reviewWebsiteIcons,
    applyIconProposals
} from 'comp/icons/website-icon-review';

function fixture() {
    const file = { active: true, db: {}, name: 'Test', iconsAdded: 0 };
    const entry = {
        id: 'one',
        file,
        title: 'Example',
        url: 'https://wikipedia.org/private/path',
        iconId: 1,
        isInRecycleBin: () => false,
        customIcon: null,
        customIconId: null
    };
    const other = { ...entry, id: 'two' };
    const entries = [entry, other];
    file.forEachEntry = (filter, callback) => entries.forEach(callback);
    file.getEntry = (id) => entries.find((item) => item.id === id);
    file.addCustomIcon = () => {
        file.iconsAdded++;
        return 'new-icon';
    };
    for (const item of entries)
        item.setCustomIcon = (id) => {
            item.customIconId = id;
        };
    return { file, entry, other, entries, files: [file] };
}

const image = 'data:image/png;base64,NEW';

describe('website icon proposals', () => {
    it('only extracts public hostnames, never credentials, paths or private addresses', () => {
        expect(websiteIconHost('https://www.wikipedia.org/a?secret=x')).to.equal(
            'www.wikipedia.org'
        );
        expect(websiteIconHost('wikipedia.org')).to.equal('wikipedia.org');
        for (const url of [
            '',
            'http://localhost',
            'http://router.local',
            'http://router.local.',
            'http://router.home.arpa',
            'http://home.arpa.',
            'http://192.168.1.1',
            'http://[::1]',
            'file:///secret',
            'https://user:pass@example.com',
            '{URL}',
            'http://123'
        ]) {
            expect(websiteIconHost(url), url).to.equal(null);
        }
    });

    it('skips entries without websites and closed databases', () => {
        const f = fixture();
        f.other.url = '';
        expect(collectIconCandidates(f.files).candidates.length).to.equal(1);
        expect(collectIconCandidates(f.files).skipped).to.equal(1);
        f.file.active = false;
        expect(collectIconCandidates(f.files).candidates.length).to.equal(0);
    });

    it('includes search-disabled groups but excludes recycled entries', () => {
        const f = fixture();
        f.other.isInRecycleBin = () => true;
        f.file.forEachEntry = (filter, callback) => {
            expect(filter.includeDisabled).to.equal(true);
            f.entries.forEach(callback);
        };
        expect(
            collectIconCandidates(f.files).candidates.map(({ entry }) => entry.id)
        ).to.deep.equal(['one']);
    });

    it('downloads a host once and does not mutate entries during review', async () => {
        const f = fixture();
        let requests = 0;
        const result = await reviewWebsiteIcons(collectIconCandidates(f.files).candidates, {
            download: async () => {
                requests++;
                return image;
            }
        });
        expect(requests).to.equal(1);
        expect(result.proposals.length).to.equal(2);
        expect(result.proposals.every((item) => !item.selected)).to.equal(true);
        expect(f.file.iconsAdded).to.equal(0);
        expect(f.entry.customIconId).to.equal(null);
    });

    it('compares normalized images and counts failures without changing old icons', async () => {
        const f = fixture();
        f.entry.customIcon = 'old-encoding';
        f.other.url = 'https://unavailable.org';
        const result = await reviewWebsiteIcons(collectIconCandidates(f.files).candidates, {
            download: async (host) => {
                if (host === 'unavailable.org') throw new Error('missing');
                return image;
            },
            normalize: async () => image
        });
        expect(result.unchanged).to.equal(1);
        expect(result.failed).to.equal(1);
        expect(result.proposals.length).to.equal(0);
    });

    it('stops on cancellation without adding a late result', async () => {
        const f = fixture();
        const controller = new AbortController();
        const result = await reviewWebsiteIcons(collectIconCandidates(f.files).candidates, {
            signal: controller.signal,
            download: async () => {
                controller.abort();
                return image;
            }
        });
        expect(result.checked).to.equal(0);
        expect(result.proposals.length).to.equal(0);
    });

    it('applies only selected proposals and shares identical icons within a file', async () => {
        const f = fixture();
        const { proposals } = await reviewWebsiteIcons(collectIconCandidates(f.files).candidates, {
            download: async () => image
        });
        proposals.forEach((item) => {
            item.selected = true;
        });
        expect(applyIconProposals(proposals, f.files).applied).to.equal(2);
        expect(f.file.iconsAdded).to.equal(1);
        expect(f.entry.customIconId).to.equal('new-icon');
        expect(applyIconProposals(proposals, f.files).applied).to.equal(0);
    });

    it('keeps unchecked entries and discards stale, removed or closed proposals', async () => {
        for (const change of [
            (f) => {
                f.entry.url = 'https://other.org';
            },
            (f) => {
                f.entry.customIconId = 'manual';
            },
            (f) => {
                f.file.active = false;
            },
            (f) => {
                f.entries.shift();
            }
        ]) {
            const f = fixture();
            const { proposals } = await reviewWebsiteIcons(
                collectIconCandidates(f.files).candidates,
                { download: async () => image }
            );
            proposals[0].selected = true;
            change(f);
            expect(applyIconProposals(proposals, f.files).applied).to.equal(0);
            expect(f.file.iconsAdded).to.equal(0);
            expect(f.other.customIconId).to.equal(null);
        }
    });
});
