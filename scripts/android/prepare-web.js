// Copies the Grunt web build into tmp/android-www for Capacitor.
// The service worker and web update manifests are left out: APK installs update the app.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'dist');
const dest = path.join(root, 'tmp', 'android-www');
const Excluded = new Set(['service-worker.js', 'update.json', 'oauth-result']);

if (!fs.existsSync(path.join(src, 'index.html'))) {
    console.error('dist/index.html missing: run the web build first');
    process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
    if (!Excluded.has(name)) {
        fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
    }
}
console.log('Prepared', path.relative(root, dest));
