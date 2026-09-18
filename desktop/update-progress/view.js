/* global updateProgress */
const title = document.getElementById('title');
const version = document.getElementById('version');
const bar = document.getElementById('progress');
const status = document.getElementById('status');
const percent = document.getElementById('percent');
const cancel = document.getElementById('cancel');
const mb = (bytes) => (bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 });
updateProgress.subscribe((state) => {
    if (!state) return;
    const downloading = state.phase === 'downloading';
    title.textContent = downloading ? 'KeeWeb wird geladen …' : 'Update wird geprüft …';
    version.textContent = `Version ${state.version}`;
    cancel.disabled = !downloading;
    if (downloading && state.total > 0) {
        bar.max = state.total;
        bar.value = state.received;
        percent.textContent = `${Math.floor((100 * state.received) / state.total)} %`;
    } else {
        bar.removeAttribute('value');
        percent.textContent = '';
    }
    status.textContent = downloading
        ? state.total > 0
            ? `${mb(state.received)} von ${mb(state.total)} MB`
            : `${mb(state.received)} MB geladen`
        : 'Download abgeschlossen. Installation wird vorbereitet.';
});
cancel.addEventListener('click', () => {
    cancel.disabled = true;
    updateProgress.cancel();
});
document.getElementById('hide').addEventListener('click', () => updateProgress.hide());
