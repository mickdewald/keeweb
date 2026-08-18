/* eslint-env node */

module.exports = function ({ pkg, sha, appdmgOptions, linuxDependencies }) {
    return {
        compress: {
            options: {
                level: 6
            },
            'win32-x64': {
                options: { archive: `dist/desktop/KeeWeb-${pkg.version}.win.x64.zip` },
                files: [{ cwd: 'tmp/desktop/KeeWeb-win32-x64', src: '**', expand: true }]
            },
            'win32-ia32': {
                options: { archive: `dist/desktop/KeeWeb-${pkg.version}.win.ia32.zip` },
                files: [{ cwd: 'tmp/desktop/KeeWeb-win32-ia32', src: '**', expand: true }]
            },
            'win32-arm64': {
                options: { archive: `dist/desktop/KeeWeb-${pkg.version}.win.arm64.zip` },
                files: [{ cwd: 'tmp/desktop/KeeWeb-win32-arm64', src: '**', expand: true }]
            },
            'linux-x64': {
                options: { archive: `dist/desktop/KeeWeb-${pkg.version}.linux.x64.zip` },
                files: [
                    { cwd: 'tmp/desktop/keeweb-linux-x64', src: '**', expand: true },
                    { cwd: 'graphics', src: '128x128.png', nonull: true, expand: true }
                ]
            }
        },
        appdmg: {
            x64: {
                options: appdmgOptions('x64'),
                dest: `dist/desktop/KeeWeb-${pkg.version}.mac.x64.dmg`
            },
            arm64: {
                options: appdmgOptions('arm64'),
                dest: `dist/desktop/KeeWeb-${pkg.version}.mac.arm64.dmg`
            }
        },
        nsis: {
            options: {
                vars: {
                    version: pkg.version,
                    rev: sha,
                    homepage: pkg.homepage
                }
            },
            'win32-x64': {
                options: {
                    installScript: 'package/nsis/main.nsi',
                    arch: 'x64',
                    output: 'tmp/desktop/KeeWeb.win.x64.exe'
                }
            },
            'win32-un-x64': {
                options: {
                    installScript: 'package/nsis/main-un.nsi',
                    arch: 'x64',
                    output: 'tmp/desktop/KeeWeb-win32-x64/uninst.exe'
                }
            },
            'win32-ia32': {
                options: {
                    installScript: 'package/nsis/main.nsi',
                    arch: 'ia32',
                    output: 'tmp/desktop/KeeWeb.win.ia32.exe'
                }
            },
            'win32-un-ia32': {
                options: {
                    installScript: 'package/nsis/main-un.nsi',
                    arch: 'ia32',
                    output: 'tmp/desktop/KeeWeb-win32-ia32/uninst.exe'
                }
            },
            'win32-arm64': {
                options: {
                    installScript: 'package/nsis/main.nsi',
                    arch: 'arm64',
                    output: 'tmp/desktop/KeeWeb.win.arm64.exe'
                }
            },
            'win32-un-arm64': {
                options: {
                    installScript: 'package/nsis/main-un.nsi',
                    arch: 'arm64',
                    output: 'tmp/desktop/KeeWeb-win32-arm64/uninst.exe'
                }
            }
        },
        chmod: {
            'linux-desktop-x64': {
                options: {
                    mode: '4755'
                },
                src: ['tmp/desktop/keeweb-linux-x64/chrome-sandbox']
            }
        },
        deb: {
            options: {
                tmpPath: 'tmp/desktop/',
                package: {
                    name: 'keeweb-desktop',
                    version: pkg.version,
                    description: pkg.description,
                    author: pkg.author,
                    homepage: pkg.homepage,
                    rev: sha
                }
            },
            'linux-x64': {
                options: {
                    info: {
                        arch: 'amd64',
                        pkgName: `KeeWeb-${pkg.version}.linux.x64.deb`,
                        targetDir: 'dist/desktop',
                        appName: 'KeeWeb',
                        depends: linuxDependencies.join(', '),
                        scripts: {
                            postinst: 'package/deb/scripts/postinst'
                        }
                    }
                },
                files: [
                    { cwd: 'package/deb/usr', src: '**', dest: '/usr', expand: true, nonull: true },
                    {
                        cwd: 'tmp/desktop/keeweb-linux-x64/',
                        src: '**',
                        dest: '/usr/share/keeweb-desktop',
                        expand: true,
                        nonull: true
                    },
                    {
                        src: 'graphics/128x128.png',
                        dest: '/usr/share/icons/hicolor/128x128/apps/keeweb.png',
                        nonull: true
                    }
                ]
            }
        }
    };
};
