const fs = require('node:fs');
const path = require('node:path');

const generatedPath = process.argv[2] || path.join('dist', 'index.html');
const source = fs.readFileSync(generatedPath, 'utf8');
const iconScss = fs.readFileSync(path.join('app', 'styles', 'base', '_icon-font.scss'), 'utf8');

if (source.includes(String.raw`\gb(2`)) {
    throw new Error(
        `Generated CSS contains malformed Font Awesome glyph escape: ${String.raw`\gb(2`}`
    );
}

const iconNames = [...iconScss.matchAll(/\n\$fa-var-([\w-]+):\s*next-fa-glyph\(\);/g)].map(
    (match) => match[1]
);

if (iconNames.length < 150) {
    throw new Error(`Expected the KeeWeb icon list, found only ${iconNames.length} icons`);
}

const expectedGlyphs = new Map(
    iconNames.map((name, index) => [name, '\\' + (0xf001 + index).toString(16)])
);
const observedGlyphs = new Map();

for (const name of iconNames) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const match = source.match(
        new RegExp(String.raw`\.fa-${escapedName}:before\s*\{[^}]*content:\s*"([^"]+)"`)
    );

    if (match) {
        observedGlyphs.set(name, match[1]);
    }
}

const mismatchedGlyphs = [];

for (const name of iconNames) {
    const expected = expectedGlyphs.get(name);
    const observed = observedGlyphs.get(name);

    if (observed !== expected) {
        mismatchedGlyphs.push(`.fa-${name}:before expected "${expected}", found "${observed}"`);
    }
}

if (mismatchedGlyphs.length) {
    throw new Error(`Generated icon glyph mismatch:\n${mismatchedGlyphs.join('\n')}`);
}

const uniqueGlyphs = new Set(observedGlyphs.values());

if (observedGlyphs.size !== iconNames.length) {
    throw new Error(
        `Expected ${iconNames.length} generated icon rules, found ${observedGlyphs.size}`
    );
}

if (uniqueGlyphs.size !== observedGlyphs.size) {
    throw new Error(
        `Expected generated icon glyphs to be distinct, found ${uniqueGlyphs.size} unique glyphs for ${observedGlyphs.size} icons`
    );
}

process.stdout.write(
    `Verified ${observedGlyphs.size} generated Font Awesome icon glyphs in ${generatedPath}\n`
);
