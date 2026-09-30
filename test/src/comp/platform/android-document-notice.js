import { expect } from 'chai';
import { Events } from 'framework/events';
import { AndroidDocumentNotice } from 'comp/platform/android/android-document-notice';

describe('AndroidDocumentNotice', () => {
    let picks;
    let relinks;
    let notice;

    beforeEach(() => {
        picks = [];
        relinks = [];
        const storage = { name: 'androiddoc', pick: (cb) => picks.push(cb) };
        notice = AndroidDocumentNotice.create({
            appModel: {},
            storage,
            relink: (args) => relinks.push(args)
        });
    });

    afterEach(() => notice.stop());

    const el = () => document.querySelector('.android-notice');

    it('shows a non-modal notice when a document becomes unreachable', () => {
        Events.emit('android-document-unreachable', { path: 'content://old' });
        expect(el()).to.not.equal(null);
        expect(el().classList.contains('modal')).to.equal(false);
        expect(el().querySelector('.android-notice__text').textContent).to.equal(
            'The database file is no longer reachable.'
        );
        expect(el().querySelector('.android-notice__action').textContent).to.equal(
            'Choose file again'
        );
    });

    it('relinks the unreachable path to the picked file and hides', () => {
        Events.emit('android-document-unreachable', { path: 'content://old' });
        el().querySelector('.android-notice__action').click();
        expect(picks.length).to.equal(1);
        picks[0](null, { path: 'content://new', name: 'Main.kdbx' });
        expect(relinks.length).to.equal(1);
        expect(relinks[0].oldPath).to.equal('content://old');
        expect(relinks[0].newPath).to.equal('content://new');
        expect(el()).to.equal(null);
    });

    it('stays visible when the picker is canceled', () => {
        Events.emit('android-document-unreachable', { path: 'content://old' });
        el().querySelector('.android-notice__action').click();
        picks[0]({ code: 'CANCELED' });
        expect(relinks.length).to.equal(0);
        expect(el()).to.not.equal(null);
    });

    it('can be dismissed', () => {
        Events.emit('android-document-unreachable', { path: 'content://old' });
        el().querySelector('.android-notice__close').click();
        expect(el()).to.equal(null);
    });
});
