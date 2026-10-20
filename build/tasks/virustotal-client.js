async function createVirusTotalUpload(fileData, fileName) {
    const { default: fetch, File, FormData } = await import('node-fetch');
    const form = new FormData();
    form.set('file', new File([fileData], fileName));

    return { fetch, form };
}

module.exports = { createVirusTotalUpload };
