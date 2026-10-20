const test = require('node:test');
const assert = require('node:assert/strict');

const { createVirusTotalUpload } = require('../../build/tasks/virustotal-client');

test('VirusTotal upload uses node-fetch v3 ESM fetch and multipart form data', async () => {
    const { fetch, form } = await createVirusTotalUpload(Buffer.from('fixture'), 'fixture.kdbx');
    const { Request } = await import('node-fetch');
    const request = new Request('https://example.test/files', { method: 'POST', body: form });

    assert.equal(typeof fetch, 'function');
    assert.equal(form.get('file').name, 'fixture.kdbx');
    assert.equal(await form.get('file').text(), 'fixture');
    assert.match(request.headers.get('content-type'), /^multipart\/form-data; boundary=/);
});
