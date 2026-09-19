const IconService = 'https://services.keeweb.info/favicon/';

function websiteIconHost(value) {
    if (typeof value !== 'string' || !value.trim() || /[{}]/.test(value)) return null;
    try {
        const url = new URL(value.includes('://') ? value : `https://${value}`);
        const host = url.hostname.toLowerCase().replace(/\.+$/, '');
        if (
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            !host.includes('.') ||
            /[:\[\]]/.test(host) ||
            /^[\d.]+$/.test(host) ||
            /\.(localhost|local|lan|internal|test|invalid|example)$/.test(host) ||
            /(^|\.)home\.arpa$/.test(host) ||
            !/^[a-z0-9.-]+$/.test(host)
        ) {
            return null;
        }
        return host;
    } catch {
        return null;
    }
}

function normalizeIconImage(source, signal, whiteBackground = false) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const finish = (error, data) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            image.onload = image.onerror = null;
            image.removeAttribute('src');
            if (error) reject(error);
            else resolve(data);
        };
        const abort = () => finish(new Error('Cancelled'));
        const timer = setTimeout(() => finish(new Error('Icon request timed out')), 10000);
        if (signal?.aborted) return abort();
        signal?.addEventListener('abort', abort, { once: true });
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => finish(new Error('Icon unavailable'));
        image.onload = () => {
            try {
                if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty icon');
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 32;
                const size = whiteBackground ? 28 : 32;
                const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
                const width = image.naturalWidth * scale;
                const height = image.naturalHeight * scale;
                const ctx = canvas.getContext('2d');
                if (whiteBackground) {
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(0, 0, 32, 32);
                }
                ctx.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height);
                const pixels = ctx.getImageData(0, 0, 32, 32).data;
                if (!pixels.some((value, index) => index % 4 === 3 && value)) {
                    throw new Error('Empty icon');
                }
                finish(null, canvas.toDataURL('image/png'));
            } catch (error) {
                finish(error);
            }
        };
        image.src = source;
    });
}

function withWhiteIconBackground(source) {
    return normalizeIconImage(source, undefined, true);
}

function downloadWebsiteIcon(host, signal) {
    return normalizeIconImage(IconService + encodeURIComponent(host), signal);
}

export { websiteIconHost, normalizeIconImage, downloadWebsiteIcon, withWhiteIconBackground };
