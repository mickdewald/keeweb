/* eslint-env node */

const { execSync } = require('child_process');
const debug = require('debug');

const webpackConfig = require('./build/webpack.config');
const webpackConfigTest = require('./test/test.webpack.config');
const pkg = require('./package.json');

const configCopy = require('./grunt/config-copy');
const configWeb = require('./grunt/config-web');
const configElectron = require('./grunt/config-electron');
const configDist = require('./grunt/config-dist');
const configSign = require('./grunt/config-sign');

debug.enable('electron-notarize');

module.exports = function (grunt) {
    require('time-grunt')(grunt);
    require('load-grunt-tasks')(grunt);

    grunt.loadTasks('build/tasks');

    require('./grunt.tasks')(grunt);
    require('./grunt.entrypoints')(grunt);

    const date = new Date();
    grunt.config.set('date', date);

    const dt = date.toISOString().replace(/T.*/, '');
    const year = date.getFullYear();
    const electronVersion = pkg.dependencies.electron.replace(/^\D/, '');
    const skipSign = grunt.option('skip-sign');
    const getCodeSignConfig = () =>
        skipSign ? { identities: {} } : require('./keys/codesign.json');
    const appBundleId =
        grunt.option('app-bundle-id') || process.env.KEEWEB_APP_BUNDLE_ID || 'net.antelle.keeweb';
    const appleTeamId =
        grunt.option('apple-team-id') || process.env.KEEWEB_APPLE_TEAM_ID || '3LE7JZ657W';
    const provisioningProfile =
        grunt.option('provisioning-profile') ||
        process.env.KEEWEB_PROVISIONING_PROFILE ||
        './keys/keeweb.provisionprofile';

    let sha = grunt.option('commit-sha');
    if (!sha) {
        try {
            sha = execSync('git rev-parse --short HEAD').toString('utf8').trim();
        } catch (e) {
            grunt.warn(
                "Cannot get commit sha from git. It's recommended to build KeeWeb from a git repo " +
                    'because commit sha is displayed in the UI, however if you would like to build from a folder, ' +
                    'you can override what will be displayed in the UI with --commit-sha=xxx.'
            );
        }
    }
    grunt.log.writeln(`Building KeeWeb v${pkg.version} (${sha})`);

    const webpackOptions = {
        date,
        beta: !!grunt.option('beta'),
        sha,
        appleTeamId
    };

    const windowsAppVersionString = {
        CompanyName: 'KeeWeb',
        FileDescription: pkg.description,
        OriginalFilename: 'KeeWeb.exe',
        ProductName: 'KeeWeb',
        InternalName: 'KeeWeb'
    };

    const appdmgOptions = (arch) => ({
        title: 'KeeWeb',
        icon: 'graphics/icon.icns',
        background: 'graphics/dmg-background.png',
        'background-color': '#E0E6F9',
        'icon-size': 80,
        window: { size: { width: 658, height: 498 } },
        contents: [
            { x: 438, y: 344, type: 'link', path: '/Applications' },
            {
                x: 192,
                y: 344,
                type: 'file',
                path: `tmp/desktop/KeeWeb-darwin-${arch}/KeeWeb.app`
            }
        ]
    });

    const linuxDependencies = [
        'libappindicator1',
        'libgconf-2-4',
        'gnome-keyring',
        'libxtst6',
        'libx11-6',
        'libatspi2.0-0'
    ];

    grunt.initConfig({
        noop: { noop: {} },
        clean: {
            dist: ['dist', 'tmp'],
            desktop: ['tmp/desktop', 'dist/desktop']
        },
        ...configCopy({ pkg }),
        ...configWeb({
            pkg,
            dt,
            rootDir: __dirname,
            webpackConfig,
            webpackConfigTest,
            webpackOptions
        }),
        ...configElectron({
            pkg,
            sha,
            year,
            electronVersion,
            appBundleId,
            windowsAppVersionString,
            linuxDependencies
        }),
        ...configDist({ pkg, sha, appdmgOptions, linuxDependencies }),
        ...configSign({ pkg, sha, appBundleId, provisioningProfile, getCodeSignConfig })
    });
};
