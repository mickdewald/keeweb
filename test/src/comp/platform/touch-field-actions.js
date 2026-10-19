import { expect } from 'chai';
import { touchValueAction, touchLongPressAction } from 'comp/platform/android/touch-field-actions';

const base = {
    isMobile: true,
    readonly: false,
    hasValue: true,
    targetTag: 'div',
    hasSelection: false
};

describe('touch field actions', () => {
    it('copies on a single tap on mobile', () => {
        expect(touchValueAction(base)).to.equal('copy');
    });

    it('keeps links and inputs working', () => {
        expect(touchValueAction({ ...base, targetTag: 'a' })).to.equal('none');
        expect(touchValueAction({ ...base, targetTag: 'span', insideLink: true })).to.equal('none');
        expect(touchValueAction({ ...base, targetTag: 'input' })).to.equal('none');
    });

    it('copies a read-only value on mobile', () => {
        expect(touchValueAction({ ...base, readonly: true })).to.equal('copy');
    });

    it('does nothing while text is selected or the field is empty', () => {
        expect(touchValueAction({ ...base, hasSelection: true })).to.equal('none');
        expect(touchValueAction({ ...base, hasValue: false })).to.equal('edit');
    });

    it('keeps the desktop behaviour (click edits)', () => {
        expect(touchValueAction({ ...base, isMobile: false })).to.equal('edit');
    });

    it('opens the action bar on a long press of an editable field', () => {
        expect(touchLongPressAction({ isMobile: true, readonly: false })).to.equal('actions');
        expect(touchLongPressAction({ isMobile: true, readonly: true })).to.equal('none');
        expect(touchLongPressAction({ isMobile: false, readonly: false })).to.equal('none');
    });
});
