import { Events } from 'framework/events';
import { Locale } from 'util/locale';
import { Alerts } from 'comp/ui/alerts';

function create({ appModel, doc = document, win = window }) {
    let overlay;
    let status;
    let retry;
    const inertElements = new Map();
    const inputEvents = [
        'keydown',
        'keyup',
        'pointerdown',
        'click',
        'input',
        'copy',
        'cut',
        'paste'
    ];

    function blockInput(event) {
        if (appModel.backgroundLockActive && !overlay?.contains(event.target)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    function started({ model }) {
        if (model !== appModel) {
            return;
        }
        doc.activeElement?.blur();
        doc.body.classList.add('android-background-locked');
        for (const app of doc.querySelectorAll('.app')) {
            if (!inertElements.has(app)) {
                inertElements.set(app, app.inert);
            }
            app.inert = true;
        }
        if (!overlay) {
            overlay = doc.createElement('div');
            overlay.className = 'android-lock-screen';
            overlay.setAttribute('role', 'status');
            status = doc.createElement('p');
            retry = doc.createElement('button');
            retry.textContent = Locale.androidLockRetry;
            retry.addEventListener('click', () => {
                Alerts.closeAll();
                retry.hidden = true;
                status.textContent = Locale.androidLockSaving;
                Events.emit('app-minimized', {
                    forceSave: true,
                    lockGeneration: appModel.backgroundLockGeneration
                });
            });
            overlay.append(status, retry);
            doc.body.appendChild(overlay);
        }
        status.textContent = Locale.androidLockSaving;
        retry.hidden = true;
    }

    function failed({ model }) {
        if (model === appModel && overlay) {
            status.textContent = Locale.androidLockSaveFailed;
            retry.hidden = false;
        }
    }

    function finished({ model }) {
        if (model !== appModel || appModel.backgroundLockActive) {
            return;
        }
        doc.body.classList.remove('android-background-locked');
        overlay?.remove();
        overlay = null;
        for (const [app, wasInert] of inertElements) {
            app.inert = wasInert;
        }
        inertElements.clear();
    }

    inputEvents.forEach((name) => win.addEventListener(name, blockInput, true));
    Events.on('background-lock-started', started);
    Events.on('background-lock-failed', failed);
    Events.on('background-lock-finished', finished);
    return {
        stop() {
            inputEvents.forEach((name) => win.removeEventListener(name, blockInput, true));
            Events.off('background-lock-started', started);
            Events.off('background-lock-failed', failed);
            Events.off('background-lock-finished', finished);
            appModel.backgroundLockActive = false;
            finished({ model: appModel });
        }
    };
}

const AndroidLockScreen = {
    instance: null,
    start(appModel) {
        if (!this.instance) {
            this.instance = create({ appModel });
        }
    },
    create
};

export { AndroidLockScreen };
