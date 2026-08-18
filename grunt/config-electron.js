/* eslint-env node */

module.exports = function ({
    pkg,
    sha,
    year,
    electronVersion,
    appBundleId,
    windowsAppVersionString,
    linuxDependencies
}) {
    return {
        electron: {
            options: {
                name: 'KeeWeb',
                dir: 'tmp/desktop/app',
                out: 'tmp/desktop',
                electronVersion,
                overwrite: true,
                asar: true,
                appCopyright: `Copyright © ${year} Antelle`,
                appVersion: pkg.version,
                buildVersion: sha
            },
            linux: {
                options: {
                    name: 'keeweb',
                    platform: 'linux',
                    arch: 'x64',
                    icon: 'graphics/icon.ico'
                }
            },
            'darwin-x64': {
                options: {
                    platform: 'darwin',
                    arch: 'x64',
                    icon: 'graphics/icon.icns',
                    appBundleId,
                    appCategoryType: 'public.app-category.productivity',
                    extendInfo: 'package/osx/extend.plist'
                }
            },
            'darwin-arm64': {
                options: {
                    platform: 'darwin',
                    arch: 'arm64',
                    icon: 'graphics/icon.icns',
                    appBundleId,
                    appCategoryType: 'public.app-category.productivity',
                    extendInfo: 'package/osx/extend.plist'
                }
            },
            'win32-x64': {
                options: {
                    platform: 'win32',
                    arch: 'x64',
                    icon: 'graphics/icon.ico',
                    buildVersion: pkg.version,
                    'version-string': windowsAppVersionString
                }
            },
            'win32-ia32': {
                options: {
                    platform: 'win32',
                    arch: 'ia32',
                    icon: 'graphics/icon.ico',
                    buildVersion: pkg.version,
                    'version-string': windowsAppVersionString
                }
            },
            'win32-arm64': {
                options: {
                    platform: 'win32',
                    arch: 'arm64',
                    icon: 'graphics/icon.ico',
                    buildVersion: pkg.version,
                    'version-string': windowsAppVersionString
                }
            }
        },
        'electron-builder': {
            linux: {
                options: {
                    publish: 'never',
                    targets: 'linux',
                    prepackaged: 'tmp/desktop/keeweb-linux-x64',
                    config: {
                        appId: appBundleId,
                        productName: 'keeweb',
                        copyright: `Copyright © ${year} Antelle`,
                        directories: {
                            output: 'tmp/desktop/electron-builder',
                            app: 'desktop',
                            buildResources: 'graphics'
                        },
                        fileAssociations: {
                            ext: 'kdbx',
                            name: 'KeePass 2 database',
                            mimeType: 'application/x-keepass2'
                        },
                        linux: {
                            target: ['AppImage', 'snap', 'rpm'],
                            category: 'Utility'
                        },
                        rpm: {
                            // depends: linuxDependencies
                        },
                        snap: {
                            stagePackages: linuxDependencies
                        }
                    }
                }
            }
        },
        'electron-patch': {
            'win32-x64': 'tmp/desktop/KeeWeb-win32-x64/KeeWeb.exe',
            'win32-ia32': 'tmp/desktop/KeeWeb-win32-ia32/KeeWeb.exe',
            'win32-arm64': 'tmp/desktop/KeeWeb-win32-arm64/KeeWeb.exe',
            'darwin-x64': 'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app',
            'darwin-arm64': 'tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app',
            'linux': 'tmp/desktop/KeeWeb-linux-x64/keeweb'
        },
        osacompile: {
            options: {
                language: 'JavaScript'
            },
            installer: {
                files: {
                    'tmp/desktop/KeeWeb Installer.app': 'package/osx/installer.js'
                }
            }
        }
    };
};
