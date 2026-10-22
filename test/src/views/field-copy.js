import { expect } from 'chai';
import * as kdbxweb from 'kdbxweb';
import 'hbs-helpers/res';
import { CopyPaste } from 'comp/browser/copy-paste';
import { Copyable } from 'framework/views/copyable';
import { FieldViewHistory } from 'views/fields/field-view-history';
import { FieldViewSelect } from 'views/fields/field-view-select';
import { FieldViewDate } from 'views/fields/field-view-date';
import { FieldViewText } from 'views/fields/field-view-text';

describe('field copy', () => {
    const originalCopy = CopyPaste.copy;
    const originalSimpleCopy = CopyPaste.simpleCopy;
    let parent;

    beforeEach(() => {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        CopyPaste.simpleCopy = true;
    });

    afterEach(() => {
        CopyPaste.copy = originalCopy;
        CopyPaste.simpleCopy = originalSimpleCopy;
        parent.remove();
        document.querySelectorAll('.tip').forEach((tip) => tip.remove());
    });

    function copiedTip(view) {
        const details = Object.assign({ fieldCopyTip: null, isHidden: () => false }, Copyable);
        view.on('copy', (event) => Copyable.fieldCopied.call(details, event));
        view.on('copy-failed', (event) => Copyable.fieldCopyFailed.call(details, event));
        return details;
    }

    it('shows copied feedback after a protected label copy reaches the clipboard', async () => {
        const value = kdbxweb.ProtectedValue.fromString('fixture-password');
        const view = new FieldViewText({ name: '$Password', title: 'Password', value }, { parent });
        const writes = [];
        let resolveCopy;
        CopyPaste.copy = (text) => {
            writes.push(text);
            return new Promise((resolve) => (resolveCopy = resolve));
        };
        view.render();
        copiedTip(view);

        view.labelEl[0].click();
        expect(document.querySelector('.tip')).to.equal(null);
        resolveCopy({ success: true, seconds: 0 });
        await Promise.resolve();

        expect(writes).to.deep.equal(['fixture-password']);
        expect(document.querySelector('.tip')?.textContent).to.equal('Copied');
        view.remove();
    });

    it('anchors button feedback only after its clipboard write reaches the clipboard', async () => {
        const view = new FieldViewText(
            { name: '$UserName', title: 'User', value: 'fixture-user' },
            { parent }
        );
        let resolveCopy;
        CopyPaste.copy = () => new Promise((resolve) => (resolveCopy = resolve));
        view.render();
        const details = copiedTip(view);
        const copyButton = view.el.querySelector('.details__field-copy');

        copyButton.click();
        expect(document.querySelector('.tip')).to.equal(null);
        resolveCopy({ success: true, seconds: 0 });
        await Promise.resolve();

        expect(details.fieldCopyTip.el[0]).to.equal(copyButton);
        view.remove();
    });

    it('does not report a copied field when the clipboard write fails', async () => {
        const view = new FieldViewText(
            { name: '$Password', title: 'Password', value: 'fixture-password' },
            { parent }
        );
        CopyPaste.copy = async () => false;
        view.render();
        copiedTip(view);

        await view.copyValue();

        expect(document.querySelector('.tip')?.textContent).to.equal('Could not copy field');
        view.remove();
    });

    it('does not show a late copy result after its field was removed', async () => {
        const view = new FieldViewText(
            { name: '$UserName', title: 'User', value: 'fixture-user' },
            { parent }
        );
        let resolveCopy;
        CopyPaste.copy = () => new Promise((resolve) => (resolveCopy = resolve));
        view.render();
        copiedTip(view);

        view.labelEl[0].click();
        view.remove();
        resolveCopy({ success: true, seconds: 0 });
        await Promise.resolve();

        expect(document.querySelector('.tip')).to.equal(null);
    });

    it('copies date fields as their displayed text', async () => {
        const value = new Date('2026-10-22T00:00:00Z');
        const view = new FieldViewDate(
            { name: '$ExpiryTime', title: 'Expires', value },
            { parent }
        );
        const writes = [];
        CopyPaste.copy = async (text) => {
            writes.push(text);
            return { success: true, seconds: 0 };
        };
        view.render();
        copiedTip(view);

        await view.copyValue();

        expect(writes).to.deep.equal([view.getEditValue(value)]);
        view.remove();
    });

    it('does not offer hover copies for select and history controls', () => {
        const select = new FieldViewSelect(
            {
                name: '$File',
                title: 'File',
                value: [{ id: 'file-1', value: 'Fixture file', selected: true }]
            },
            { parent }
        );
        const history = new FieldViewHistory(
            { name: 'History', title: 'History', value: { length: 1, unsaved: false } },
            { parent }
        );

        select.render();
        history.render();

        expect(select.el.querySelector('.details__field-copy')).to.equal(null);
        expect(history.el.querySelector('.details__field-copy')).to.equal(null);
        select.remove();
        history.remove();
    });
});
