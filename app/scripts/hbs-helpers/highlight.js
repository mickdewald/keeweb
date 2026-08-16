import Handlebars from 'hbs';

function findMatchRanges(text, terms) {
    if (!terms || !terms.length || !text) {
        return [];
    }
    const lower = text.toLowerCase();
    const ranges = [];
    for (const term of terms) {
        if (!term) {
            continue;
        }
        let ix = 0;
        let found;
        while ((found = lower.indexOf(term, ix)) >= 0) {
            ranges.push([found, found + term.length]);
            ix = found + 1;
        }
    }
    if (!ranges.length) {
        return [];
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) {
            last[1] = Math.max(last[1], range[1]);
        } else {
            merged.push([range[0], range[1]]);
        }
    }
    return merged;
}

function highlightText(text, terms) {
    text = text === null || text === undefined ? '' : String(text);
    const esc = Handlebars.escapeExpression;
    const merged = findMatchRanges(text, terms);
    if (!merged.length) {
        return esc(text);
    }
    let out = '';
    let pos = 0;
    for (const [start, end] of merged) {
        out +=
            esc(text.substring(pos, start)) +
            '<mark class="search-hl">' +
            esc(text.substring(start, end)) +
            '</mark>';
        pos = end;
    }
    out += esc(text.substring(pos));
    return out;
}

function highlightDom(el, terms) {
    if (!el || !terms || !terms.length) {
        return;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }
    for (const textNode of textNodes) {
        if (textNode.parentNode && textNode.parentNode.closest('mark.search-hl')) {
            continue;
        }
        const text = textNode.nodeValue;
        const merged = findMatchRanges(text, terms);
        if (!merged.length) {
            continue;
        }
        const frag = document.createDocumentFragment();
        let pos = 0;
        for (const [start, end] of merged) {
            if (start > pos) {
                frag.appendChild(document.createTextNode(text.substring(pos, start)));
            }
            const mark = document.createElement('mark');
            mark.className = 'search-hl';
            mark.textContent = text.substring(start, end);
            frag.appendChild(mark);
            pos = end;
        }
        if (pos < text.length) {
            frag.appendChild(document.createTextNode(text.substring(pos)));
        }
        textNode.parentNode.replaceChild(frag, textNode);
    }
}

Handlebars.registerHelper('highlight', (text, terms) => {
    return new Handlebars.SafeString(highlightText(text, terms));
});

export { highlightText, highlightDom };
