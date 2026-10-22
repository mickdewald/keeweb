import { expect } from 'chai';
import { EntrySearch } from 'util/entry-search';

describe('EntrySearch', () => {
    it('should match an empty filter', () => {
        const search = new EntrySearch({ searchText: '' });
        expect(search.matches()).to.be.true;
    });

    it('should not match an empty entry', () => {
        const search = new EntrySearch({ searchText: '' });
        expect(search.matches({ textLower: 'test' })).to.be.false;
    });

    it('should match a simple string', () => {
        const search = new EntrySearch({ searchText: 'some test' });
        expect(search.matches({ textLower: 'test' })).to.be.true;
    });

    it('should not match a non-existing string', () => {
        const search = new EntrySearch({ searchText: 'some test' });
        expect(search.matches({ textLower: 'something' })).to.be.false;
    });

    it('hides recycled entries from normal filters', () => {
        const search = new EntrySearch({
            searchText: 'test',
            isInRecycleBin: () => true
        });
        expect(search.matches({ textLower: 'test' })).to.be.false;
        expect(search.matches({ trash: true, textLower: 'test' })).to.be.true;
        expect(search.matches({ includeDisabled: true, textLower: 'test' })).to.be.true;
    });

    it('filters to entries that have attachments', () => {
        const withAtt = new EntrySearch({
            searchText: '',
            attachments: [{ title: 'scan.pdf' }]
        });
        const withoutAtt = new EntrySearch({ searchText: '', attachments: [] });
        expect(withAtt.matches({ attachments: true })).to.be.true;
        expect(withoutAtt.matches({ attachments: true })).to.be.false;
        expect(withoutAtt.matches({})).to.be.true;
    });

    it('should match text parts', () => {
        const search = new EntrySearch({ searchText: 'some test' });
        expect(
            search.matches({
                textLower: 'some test',
                textLowerParts: ['some', 'test']
            })
        ).to.be.true;
        expect(
            search.matches({
                textLower: 'test some',
                textLowerParts: ['test', 'some']
            })
        ).to.be.true;
    });

    it('matches ordinary search terms against custom field labels', () => {
        const search = new EntrySearch({
            searchText: 'backup database',
            fields: { Restic: 'valuekey' }
        });

        expect(search.matches({ textLower: 'restic' })).to.be.true;
        expect(search.matches({ textLower: 'esti' })).to.be.true;
    });

    it('does not inspect protected custom field values when matching labels', () => {
        const search = new EntrySearch({
            searchText: '',
            fields: {
                Restic: {
                    isProtected: true,
                    getText() {
                        throw new Error('protected field value was read');
                    },
                    includesLower() {
                        throw new Error('protected field value was read');
                    }
                }
            }
        });

        expect(search.matches({ textLower: 'restic' })).to.be.true;
        expect(search.matches({ textLower: 'secret-only' })).to.be.false;
    });

    it('does not add labels or values to the shared search index', () => {
        const search = new EntrySearch({
            searchText: '',
            fields: { ApiToken: 'secret-only', UserName: 'fixture-user' }
        });

        expect(search.matches({ textLower: 'secret-only' })).to.be.false;
        expect(search.matches({ textLower: 'username' })).to.be.false;
        expect(search.matches({ textLower: 'user' })).to.be.false;
    });

    it('matches every ordinary search term across text and custom labels', () => {
        const search = new EntrySearch({
            searchText: 'nightly backup',
            fields: { Restic: 'valuekey' }
        });

        expect(
            search.matches({
                textLower: 'nightly restic',
                textLowerParts: ['nightly', 'restic']
            })
        ).to.be.true;
        expect(
            search.matches({
                textLower: 'nightly missing',
                textLowerParts: ['nightly', 'missing']
            })
        ).to.be.false;
    });

    it('reads current custom labels without changing shared search text', () => {
        const model = { searchText: 'https://backup.example', fields: { Restic: 'valuekey' } };
        const search = new EntrySearch(model);

        expect(search.matches({ textLower: 'restic' })).to.be.true;
        delete model.fields.Restic;
        expect(search.matches({ textLower: 'restic' })).to.be.false;
        model.fields.Borg = 'valuekey';
        expect(search.matches({ textLower: 'borg' })).to.be.true;
        expect(model.searchText).to.equal('https://backup.example');
    });

    it('uses custom field keys without reading their values', () => {
        const fields = {};
        Object.defineProperty(fields, 'Restic', {
            enumerable: true,
            get() {
                throw new Error('custom field value was read');
            }
        });
        const search = new EntrySearch({ searchText: '', fields });

        expect(search.matches({ textLower: 'restic' })).to.be.true;
    });

    it('does not apply custom labels to advanced value searches', () => {
        const protectedValue = {
            isProtected: true,
            includesLower() {
                return false;
            }
        };
        const search = new EntrySearch({
            searchText: '',
            fields: { Restic: 'valuekey', Secure: protectedValue },
            getAllFields() {
                return this.fields;
            }
        });

        expect(search.matches({ textLower: 'restic', advanced: { other: true } })).to.be.false;
        expect(search.matches({ textLower: 'restic', advanced: { protect: true } })).to.be.false;
    });
});
