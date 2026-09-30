import { expect } from 'chai';
import { AndroidClipboard } from 'comp/platform/android/android-clipboard';

describe('AndroidClipboard', () => {
    it('passes the text and the clear timeout to the native plugin', () => {
        const calls = [];
        const plugin = {
            copy: (arg) => {
                calls.push(arg);
                return Promise.resolve();
            }
        };
        const res = AndroidClipboard.copy('secret-value', 30, plugin);
        expect(res).to.eql({ success: true, seconds: 30 });
        expect(calls).to.eql([{ text: 'secret-value', clearAfterSeconds: 30 }]);
    });

    it('sends 0 when clearing is disabled', () => {
        const calls = [];
        AndroidClipboard.copy('x', 0, {
            copy: (arg) => {
                calls.push(arg);
                return Promise.resolve();
            }
        });
        expect(calls[0].clearAfterSeconds).to.equal(0);
    });
});
