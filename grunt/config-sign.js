/* eslint-env node */

module.exports = function ({ pkg, sha, appBundleId, provisioningProfile, getCodeSignConfig }) {
    return {
        'osx-sign': {
            options: {
                get identity() {
                    return getCodeSignConfig().identities.app;
                },
                hardenedRuntime: true,
                entitlements: 'package/osx/entitlements.plist',
                'entitlements-inherit': 'package/osx/entitlements-inherit.plist',
                'gatekeeper-assess': false
            },
            'desktop-x64': {
                options: {
                    'provisioning-profile': provisioningProfile
                },
                src: 'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app'
            },
            'desktop-arm64': {
                options: {
                    'provisioning-profile': provisioningProfile
                },
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
        'sign-exe': {
            options: {
                url: pkg.homepage,
                get windows() {
                    return getCodeSignConfig().windows;
                },
                get certHash() {
                    return getCodeSignConfig().microsoftCertHash;
                }
            },
            'win32-build-x64': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb-win32-x64/KeeWeb.exe': 'KeeWeb',
                        'tmp/desktop/KeeWeb-win32-x64/keeweb-native-messaging-host.exe':
                            'KeeWeb Native Messaging Host',
                        'tmp/desktop/KeeWeb-win32-x64/ffmpeg.dll': '',
                        'tmp/desktop/KeeWeb-win32-x64/libEGL.dll':
                            'ANGLE libEGL Dynamic Link Library',
                        'tmp/desktop/KeeWeb-win32-x64/libGLESv2.dll':
                            'ANGLE libGLESv2 Dynamic Link Library'
                    }
                }
            },
            'win32-build-ia32': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb-win32-ia32/KeeWeb.exe': 'KeeWeb',
                        'tmp/desktop/KeeWeb-win32-ia32/keeweb-native-messaging-host.exe':
                            'KeeWeb Native Messaging Host',
                        'tmp/desktop/KeeWeb-win32-ia32/ffmpeg.dll': '',
                        'tmp/desktop/KeeWeb-win32-ia32/libEGL.dll':
                            'ANGLE libEGL Dynamic Link Library',
                        'tmp/desktop/KeeWeb-win32-ia32/libGLESv2.dll':
                            'ANGLE libGLESv2 Dynamic Link Library'
                    }
                }
            },
            'win32-build-arm64': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb-win32-arm64/KeeWeb.exe': 'KeeWeb',
                        'tmp/desktop/KeeWeb-win32-arm64/keeweb-native-messaging-host.exe':
                            'KeeWeb Native Messaging Host',
                        'tmp/desktop/KeeWeb-win32-arm64/ffmpeg.dll': '',
                        'tmp/desktop/KeeWeb-win32-arm64/libEGL.dll':
                            'ANGLE libEGL Dynamic Link Library',
                        'tmp/desktop/KeeWeb-win32-arm64/libGLESv2.dll':
                            'ANGLE libGLESv2 Dynamic Link Library'
                    }
                }
            },
            'win32-uninst-x64': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb-win32-x64/uninst.exe': 'KeeWeb Uninstaller'
                    }
                }
            },
            'win32-uninst-ia32': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb-win32-ia32/uninst.exe': 'KeeWeb Uninstaller'
                    }
                }
            },
            'win32-uninst-arm64': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb-win32-arm64/uninst.exe': 'KeeWeb Uninstaller'
                    }
                }
            },
            'win32-installer-x64': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb.win.x64.exe': 'KeeWeb Setup'
                    }
                }
            },
            'win32-installer-ia32': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb.win.ia32.exe': 'KeeWeb Setup'
                    }
                }
            },
            'win32-installer-arm64': {
                options: {
                    files: {
                        'tmp/desktop/KeeWeb.win.arm64.exe': 'KeeWeb Setup'
                    }
                }
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
