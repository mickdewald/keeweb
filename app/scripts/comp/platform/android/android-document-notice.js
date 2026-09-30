import { Events } from 'framework/events';
import { Locale } from 'util/locale';
import { relinkDocument } from 'comp/platform/android/android-document-relink';

// A banner, not a modal: an open modal would stop lockWorkspace() when the app is left.
function create({ appModel, storage, relink = relinkDocument, doc = document }) {
    let el = null;
    let path = null;

    function hide() {
        if (el) {
            el.remove();
            el = null;
        }
        path = null;
    }

    function chooseAgain() {
        const oldPath = path;
        storage.pick((err, file) => {
            if (err || !file || oldPath !== path) {
                return;
            }
            hide();
            relink({ appModel, storage, oldPath, newPath: file.path });
        });
    }

    function show(e) {
        path = e.path;
        if (el) {
            return;
        }
        el = doc.createElement('div');
        el.className = 'android-notice';
        el.setAttribute('role', 'alert');
        const text = doc.createElement('div');
        text.className = 'android-notice__text';
        text.textContent = Locale.androiddocUnreachable;
        const action = doc.createElement('button');
        action.className = 'android-notice__action';
        action.textContent = Locale.androiddocChooseAgain;
        action.addEventListener('click', chooseAgain);
        const close = doc.createElement('button');
        close.className = 'android-notice__close fa fa-times';
        close.setAttribute('aria-label', Locale.alertClose);
        close.addEventListener('click', hide);
        el.append(text, action, close);
        doc.body.appendChild(el);
    }

    Events.on('android-document-unreachable', show);
    return {
        stop() {
            Events.off('android-document-unreachable', show);
            hide();
        }
    };
}

const AndroidDocumentNotice = { create };

export { AndroidDocumentNotice };
