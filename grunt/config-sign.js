module.exports = function ({
    pkg,
    sha,
    appBundleId,
    provisioningProfile,
    getCodeSignConfig,
    updaterSmoke
}) {
    // Only an explicitly supplied profile is embedded; updater smoke fixtures have none.
    const provisioningOptions = provisioningProfile
        ? { 'provisioning-profile': provisioningProfile }
        : {};
    return {
        'osx-sign': {
            options: {
                get identity() {
                    return getCodeSignConfig().identities.app;
                },
                hardenedRuntime: true,
                entitlements: updaterSmoke
                    ? 'package/osx/updater-smoke-entitlements.plist'
                    : 'package/osx/entitlements.plist',
                'entitlements-inherit': updaterSmoke
                    ? 'package/osx/updater-smoke-entitlements.plist'
                    : 'package/osx/entitlements-inherit.plist',
                'gatekeeper-assess': false
            },
            'desktop-x64': {
                options: provisioningOptions,
                src: 'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app'
            },
            'desktop-arm64': {
                options: provisioningOptions,
                src: 'tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app'
            },
            'installer': {
                src: 'tmp/desktop/KeeWeb Installer.app'
            }
        },
        notarize: {
            options: {
                appBundleId,
                get appleId() {
                    return getCodeSignConfig().appleId;
                },
                appleIdPassword: '@keychain:AC_PASSWORD',
                get ascProvider() {
                    return getCodeSignConfig().teamId;
                }
            },
            'desktop-x64': {
                src: 'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app'
            },
            'desktop-arm64': {
                src: 'tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app'
            }
        },
        'sign-dist': {
            dist: {
                options: {
                    sign: 'dist/desktop/Verify.sign.sha256'
                },
                files: {
                    'dist/desktop/Verify.sha256': ['dist/desktop/KeeWeb-*']
                }
            }
        },
        'run-test': {
            options: {
                headless: true
            },
            default: 'test/runner.html'
        },
        virustotal: {
            options: {
                prefix: `keeweb.v${pkg.version}-${sha}.`,
                timeout: 10 * 60 * 1000,
                get apiKey() {
                    return require('../keys/virus-total.json').apiKey;
                }
            },
            html: 'dist/index.html'
        }
    };
};
