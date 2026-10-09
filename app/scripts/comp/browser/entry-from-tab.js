import * as kdbxweb from 'kdbxweb';
import { Events } from 'framework/events';
import { GeneratorPresets } from 'comp/app/generator-presets';
import { PasswordGenerator } from 'util/generators/password-generator';
import { websiteIconHost, downloadWebsiteIcon } from 'comp/icons/website-icon';
import { siteKey } from 'comp/browser/browser-tabs';

function forEachActiveEntry(files, callback) {
    files.forEach((file) => {
        if (file.active && file.db) file.forEachEntry({}, callback);
    });
}

function collectKnownSites(files) {
    const sites = new Set();
    forEachActiveEntry(files, (entry) => {
        const key = siteKey(entry.url);
        if (key) sites.add(key);
    });
    return sites;
}

function mostUsedUserName(files) {
    const counts = new Map();
    forEachActiveEntry(files, (entry) => {
        if (entry.user) counts.set(entry.user, (counts.get(entry.user) || 0) + 1);
    });
    let best = '';
    for (const [user, count] of counts) {
        if (count > (counts.get(best) || 0)) best = user;
    }
    return best;
}

function generateDefaultPassword() {
    const presets = GeneratorPresets.enabled;
    return PasswordGenerator.generate(presets.find((preset) => preset.default) || presets[0]);
}

function tabEntryFields(tab, files, generate = generateDefaultPassword) {
    return {
        Title: tab.title,
        URL: tab.url,
        UserName: mostUsedUserName(files),
        Password: kdbxweb.ProtectedValue.fromString(generate())
    };
}

async function attachWebsiteIcon(entry, download = downloadWebsiteIcon) {
    const { file, id, url } = entry;
    const host = websiteIconHost(url);
    if (!host) return false;
    let image;
    try {
        image = await download(host);
    } catch {
        return false;
    }
    // the file may have been reloaded or closed and the entry changed while the icon was loading
    const current = file.active && file.db ? file.getEntry(id) : null;
    if (!current || current.customIconId || current.url !== url) return false;
    current.setCustomIcon(file.addCustomIcon(image.split(',')[1]));
    Events.emit('entry-updated', { entry: current });
    Events.emit('entry-icon-loaded', { entry: current });
    return true;
}

export { collectKnownSites, mostUsedUserName, tabEntryFields, attachWebsiteIcon };
