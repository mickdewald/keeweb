module.exports = function (grunt) {
    grunt.registerMultiTask('run-test', 'Runs KeeWeb browser-tests', function () {
        const done = this.async();
        const opt = this.options();
        const file = this.files[0].src[0];
        const fs = require('fs');
        const path = require('path');
        const puppeteer = require('puppeteer');
        function getChromeExecutablePath() {
            if (process.env.CHROME_BIN) {
                return process.env.CHROME_BIN;
            }
            if (process.env.CI && process.platform === 'darwin') {
                const macChromePath =
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
                if (fs.existsSync(macChromePath)) {
                    return macChromePath;
                }
            }
            return null;
        }
        (async function () {
            grunt.log.writeln('Running tests...');
            const fullPath = 'file://' + path.resolve(file);
            const executablePath = getChromeExecutablePath();
            if (executablePath) {
                grunt.log.writeln(`Using browser: ${executablePath}`);
            }
            const browser = await puppeteer.launch({
                headless: opt.headless,
                executablePath,
                dumpio: Boolean(process.env.CI),
                pipe: Boolean(process.env.CI),
                args: [
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            });
            grunt.log.writeln('puppeteer launched...');
            const page = await browser.newPage();
            page.on('console', (message) => {
                const type = message.type();
                if (type === 'error' || type === 'warning') {
                    grunt.log.writeln(`[browser:${type}] ${message.text()}`);
                }
            });
            page.on('pageerror', (error) => {
                grunt.fail.fatal(error.stack || error.message || error);
            });
            page.on('error', (error) => {
                grunt.fail.fatal(error.stack || error.message || error);
            });
            await page.goto(fullPath);
            async function check() {
                const result = await page.evaluate(() => {
                    const { output, done } = window;
                    window.output = [];
                    return { output, done };
                });
                for (const out of result.output) {
                    if (!out.args.length) {
                        continue;
                    }
                    // eslint-disable-next-line no-console
                    console[out.method](...out.args);
                }
                if (result.done) {
                    await browser.close();
                    const { failures } = result.done;
                    if (failures) {
                        grunt.warn(`Failed ${failures} test${failures > 1 ? 's' : ''}.`);
                    } else {
                        grunt.log.writeln('All tests passed');
                        done();
                    }
                } else {
                    setTimeout(check, 100);
                }
            }

            check();
        })().catch((error) => {
            grunt.fail.fatal(error.stack || error.message || error);
        });
    });
};
