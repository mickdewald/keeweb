import { Events } from 'framework/events';
import { Locale } from 'util/locale';
import { relinkDocument } from 'comp/platform/android/android-document-relink';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { beginPendingMutation } from 'models/file-mutation-tracker';

// A banner, not a modal: an open modal would stop lockWorkspace() when the app is left.
function create({
    appModel,
    storage,
    relink = relinkDocument,
    isBusy = () => AndroidPlatform.nativeFlowPending || !!appModel.unlockMessageRes,
    doc = document
}) {
    let el = null;
    let path = null;
    let picking = false;

    function hide() {
        if (el) {
            el.remove();
            el = null;
        }
        path = null;
    }

    function chooseAgain() {
        if (picking || isBusy()) {
            return;
        }
        picking = true;
        const oldPath = path;
        const completeMutations = (appModel.files || [])
            .filter((file) => file.storage === storage.name && file.path === oldPath)
            .map((file) => beginPendingMutation(file));
        const picked = (err, file) => {
            picking = false;
            try {
                if (err || !file || oldPath !== path) {
                    return;
                }
                const result = relink({
                    appModel,
                    storage,
                    oldPath,
                    newPath: file.path,
                    opts: file.opts
                });
                if (!result || !result.rejected) {
                    hide();
                }
            } finally {
                completeMutations.forEach((complete) => complete());
            }
        };
        try {
            storage.pick(picked);
        } catch (err) {
            picked(err);
        }
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
        text.textContent = e.readonly ? Locale.androiddocReadOnly : Locale.androiddocUnreachable;
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

    const showReadOnly = (e) => show({ ...e, readonly: true });
    Events.on('android-document-unreachable', show);
    Events.on('android-document-readonly', showReadOnly);
    return {
        stop() {
            Events.off('android-document-unreachable', show);
            Events.off('android-document-readonly', showReadOnly);
            hide();
        }
    };
}

const AndroidDocumentNotice = { create };

export { AndroidDocumentNotice };
