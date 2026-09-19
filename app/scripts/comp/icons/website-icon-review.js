import {
    websiteIconHost,
    normalizeIconImage,
    downloadWebsiteIcon,
    withWhiteIconBackground
} from './website-icon';

function collectIconCandidates(files) {
    const candidates = [];
    let skipped = 0;
    files.forEach((file) => {
        if (!file.active || file.backend || !file.db) return;
        file.forEachEntry({ includeDisabled: true }, (entry) => {
            if (entry.isInRecycleBin()) return;
            const host = websiteIconHost(entry.url);
            if (!host || entry.backend) {
                skipped++;
                return;
            }
            candidates.push({
                entry,
                host,
                url: entry.url,
                oldIcon: entry.customIcon,
                oldId: entry.customIconId,
                iconId: entry.iconId
            });
        });
    });
    return { candidates, skipped };
}

async function reviewWebsiteIcons(
    candidates,
    {
        signal,
        onProgress = () => {},
        download = downloadWebsiteIcon,
        normalize = normalizeIconImage
    } = {}
) {
    const result = { proposals: [], unchanged: 0, failed: 0, checked: 0 };
    const downloads = new Map();
    for (const candidate of candidates) {
        if (signal?.aborted) break;
        try {
            if (!downloads.has(candidate.host)) {
                downloads.set(candidate.host, download(candidate.host, signal));
            }
            const image = await downloads.get(candidate.host);
            const previous = candidate.oldIcon ? await normalize(candidate.oldIcon, signal) : null;
            if (signal?.aborted) break;
            const unchanged =
                image === previous ||
                (previous && (await withWhiteIconBackground(image)) === previous);
            if (signal?.aborted) break;
            if (unchanged) result.unchanged++;
            else result.proposals.push({ ...candidate, image, selected: false });
        } catch {
            if (signal?.aborted) break;
            result.failed++;
        }
        result.checked++;
        onProgress(result.checked, candidates.length);
    }
    return result;
}

function applyIconProposals(proposals, files) {
    const result = { applied: 0, skipped: 0 };
    const currentEntries = new Set(
        collectIconCandidates(files).candidates.map(({ entry }) => entry)
    );
    const iconsByFile = new Map();
    for (const proposal of proposals.filter((item) => item.selected)) {
        const { entry } = proposal;
        const file = entry.file;
        if (
            !files.some((item) => item === file && item.active) ||
            !file.db ||
            !currentEntries.has(entry) ||
            file.getEntry(entry.id) !== entry ||
            entry.url !== proposal.url ||
            entry.customIcon !== proposal.oldIcon ||
            entry.customIconId !== proposal.oldId ||
            entry.iconId !== proposal.iconId
        ) {
            result.skipped++;
            continue;
        }
        let icons = iconsByFile.get(file);
        if (!icons) iconsByFile.set(file, (icons = new Map()));
        const image = proposal.whiteBackground ? proposal.whiteImage : proposal.image;
        if (!image) {
            result.skipped++;
            continue;
        }
        let id = icons.get(image);
        if (!id) {
            id = file.addCustomIcon(image.split(',')[1]);
            icons.set(image, id);
        }
        entry.setCustomIcon(id);
        proposal.selected = false;
        result.applied++;
    }
    return result;
}

export { collectIconCandidates, reviewWebsiteIcons, applyIconProposals };
