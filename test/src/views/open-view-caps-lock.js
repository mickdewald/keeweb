import { expect } from 'chai';
import $ from 'jquery';
import { createOpenViewFileInputMixin } from 'views/open-view-file-input';

const Keys = { DOM_VK_RETURN: 13, DOM_VK_CAPS_LOCK: 20 };

describe('Open view Caps Lock warning', () => {
    let view;
    beforeEach(() => {
        view = Object.assign(createOpenViewFileInputMixin({ Keys }), {
            $el: $('<div><div class="open__pass-warning invisible"></div></div>'),
            openDb() {}
        });
    });

    function key(type, code, capsLock, shiftKey = false) {
        return $.Event(
            new KeyboardEvent(type, {
                keyCode: code,
                modifierCapsLock: capsLock,
                shiftKey
            })
        );
    }

    function visible() {
        return !view.$el.find('.open__pass-warning').hasClass('invisible');
    }

    it('shows the warning immediately when Caps Lock is pressed', () => {
        view.inputKeydown(key('keydown', 20, true));
        expect(visible()).to.equal(true);
        view.inputKeyup(key('keyup', 20, true));
        expect(visible()).to.equal(true);
    });

    it('detects an already active Caps Lock on digits and with Shift', () => {
        view.inputKeydown(key('keydown', 49, true));
        expect(visible()).to.equal(true);
        view.inputKeypress(key('keypress', 97, true, true));
        expect(visible()).to.equal(true);
    });

    it('hides the warning once Caps Lock is off', () => {
        view.toggleCapsLockWarning(true);
        view.inputKeyup(key('keyup', 20, false));
        expect(visible()).to.equal(false);
    });

    it('does not confuse Shift with Caps Lock', () => {
        view.inputKeypress(key('keypress', 65, false, true));
        expect(visible()).to.equal(false);
    });

    it('detects Caps Lock when clicking into the password field', () => {
        view.updateCapsLockWarning(
            $.Event(
                new MouseEvent('mousedown', {
                    modifierCapsLock: true
                })
            )
        );
        expect(visible()).to.equal(true);
    });

    it('preserves the last known state for events without modifier information', () => {
        view.toggleCapsLockWarning(true);
        view.updateCapsLockWarning({});
        expect(visible()).to.equal(true);
    });

    it('still submits on Enter after updating the warning', () => {
        let opened = false;
        view.openDb = () => {
            opened = true;
            expect(visible()).to.equal(true);
        };
        view.inputKeydown(key('keydown', 13, true));
        expect(opened).to.equal(true);
    });
});
