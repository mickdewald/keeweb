import { expect } from 'chai';
import { Events } from 'framework/events';
import { Alerts } from 'comp/ui/alerts';
import { AndroidLockScreen } from 'comp/platform/android/android-lock-screen';
import { beginBackgroundLock, finishBackgroundLock } from 'models/background-lock-state';

describe('Android lock screen', () => {
    let app;
    let model;
    let screen;

    beforeEach(() => {
        app = document.createElement('div');
        app.className = 'app';
        app.innerHTML = '<input value="fixture-only"><button>Copy</button>';
        document.body.appendChild(app);
        model = {};
        screen = AndroidLockScreen.create({ appModel: model });
    });

    afterEach(() => {
        finishBackgroundLock(model, model.backgroundLockGeneration);
        screen.stop();
        Alerts.closeAll();
        app.remove();
    });

    it('immediately makes the old workspace inert and blocks shortcuts while a save is pending', () => {
        const input = app.querySelector('input');
        input.focus();
        beginBackgroundLock(model);
        expect(app.inert).to.equal(true);
        expect(document.activeElement).to.not.equal(input);
        expect(document.body.classList.contains('android-background-locked')).to.equal(true);
        const key = new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true });
        input.dispatchEvent(key);
        expect(key.defaultPrevented).to.equal(true);
        expect(document.querySelector('.android-lock-screen')).to.not.equal(null);
    });

    it('keeps the boundary on failure and lets retry use the same generation', () => {
        const generation = beginBackgroundLock(model);
        Events.emit('background-lock-failed', { model, generation });
        const retry = document.querySelector('.android-lock-screen button');
        Alerts.error({ header: 'Fixture local save failed' });
        expect(retry.hidden).to.equal(false);
        let retryOptions;
        const onRetry = (options) => (retryOptions = options);
        Events.on('app-minimized', onRetry);
        try {
            retry.click();
            expect(Alerts.alertDisplayed).to.equal(false);
            expect(retryOptions).to.eql({ forceSave: true, lockGeneration: generation });
            expect(model.backgroundLockActive).to.equal(true);
            expect(app.inert).to.equal(true);
        } finally {
            Events.off('app-minimized', onRetry);
        }
    });

    it('only releases the input boundary for the current completed generation', () => {
        const previous = beginBackgroundLock(model);
        const current = beginBackgroundLock(model);
        finishBackgroundLock(model, previous);
        expect(app.inert).to.equal(true);
        finishBackgroundLock(model, current);
        expect(app.inert).to.not.equal(true);
        expect(document.querySelector('.android-lock-screen')).to.equal(null);
    });
});
