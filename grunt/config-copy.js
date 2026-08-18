/* eslint-env node */

module.exports = function ({ pkg }) {
    return {
        copy: {
            html: {
                src: 'app/index.html',
                dest: 'tmp/index.html',
                nonull: true
            },
            'content-dist': {
                cwd: 'app/content/',
                src: '**',
                dest: 'dist/',
                expand: true,
                nonull: true
            },
            icons: {
                cwd: 'app/icons/',
                src: ['*.png', '*.svg'],
                dest: 'tmp/icons/',
                expand: true,
                nonull: true
            },
            'dist-icons': {
                cwd: 'app/icons/',
                src: ['*.png', '*.svg'],
                dest: 'dist/icons/',
                expand: true,
                nonull: true
            },
            manifest: {
                cwd: 'app/manifest/',
                src: ['*.json', '*.xml'],
                dest: 'tmp/',
                expand: true,
                nonull: true
            },
            'dist-manifest': {
                cwd: 'app/manifest/',
                src: ['*.json', '*.xml'],
                dest: 'dist/',
                expand: true,
                nonull: true
            },
            'desktop-html': {
                src: 'dist/index.html',
                dest: 'tmp/desktop/app/index.html',
                nonull: true
            },
            'desktop-app-content': {
                cwd: 'desktop/',
                src: ['**', '!package-lock.json'],
                dest: 'tmp/desktop/app/',
                expand: true,
                nonull: true
            },
            'desktop-remote-module': {
                cwd: 'node_modules/@electron/remote/',
                src: '**',
                dest: 'tmp/desktop/app/node_modules/@electron/remote/',
                expand: true,
                nonull: true
            },
            'desktop-darwin-installer-helper-x64': {
                cwd: 'tmp/desktop/KeeWeb Installer.app',
                src: '**',
                dest:
                    'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app/Contents/Installer/KeeWeb Installer.app',
                expand: true,
                nonull: true,
                options: { mode: true }
            },
            'desktop-darwin-installer-helper-arm64': {
                cwd: 'tmp/desktop/KeeWeb Installer.app',
                src: '**',
                dest:
                    'tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app/Contents/Installer/KeeWeb Installer.app',
                expand: true,
                nonull: true,
                options: { mode: true }
            },
            'desktop-win32-dist-x64': {
                src: 'tmp/desktop/KeeWeb.win.x64.exe',
                dest: `dist/desktop/KeeWeb-${pkg.version}.win.x64.exe`,
                nonull: true
            },
            'desktop-win32-dist-ia32': {
                src: 'tmp/desktop/KeeWeb.win.ia32.exe',
                dest: `dist/desktop/KeeWeb-${pkg.version}.win.ia32.exe`,
                nonull: true
            },
            'desktop-win32-dist-arm64': {
                src: 'tmp/desktop/KeeWeb.win.arm64.exe',
                dest: `dist/desktop/KeeWeb-${pkg.version}.win.arm64.exe`,
                nonull: true
            },
            'native-modules-darwin-x64': {
                src: 'node_modules/@keeweb/keeweb-native-modules/*-darwin-x64.node',
                dest: 'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app/Contents/Resources/',
                nonull: true
            },
            'native-modules-darwin-arm64': {
                src: 'node_modules/@keeweb/keeweb-native-modules/*-darwin-arm64.node',
                dest: 'tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app/Contents/Resources/',
                nonull: true
            },
            'native-modules-win32-x64': {
                src: 'node_modules/@keeweb/keeweb-native-modules/*-win32-x64.node',
                dest: 'tmp/desktop/KeeWeb-win32-x64/resources/',
                nonull: true
            },
            'native-modules-win32-ia32': {
                src: 'node_modules/@keeweb/keeweb-native-modules/*-win32-ia32.node',
                dest: 'tmp/desktop/KeeWeb-win32-ia32/resources/',
                nonull: true
            },
            'native-modules-win32-arm64': {
                src: 'node_modules/@keeweb/keeweb-native-modules/*-win32-arm64.node',
                dest: 'tmp/desktop/KeeWeb-win32-arm64/resources/',
                nonull: true
            },
            'native-modules-linux-x64': {
                src: 'node_modules/@keeweb/keeweb-native-modules/*-linux-x64.node',
                dest: 'tmp/desktop/keeweb-linux-x64/resources/',
                nonull: true
            },
            'electron-builder-dist-linux-rpm': {
                src: `tmp/desktop/electron-builder/KeeWeb-${pkg.version}.x86_64.rpm`,
                dest: `dist/desktop/KeeWeb-${pkg.version}.linux.x86_64.rpm`,
                nonull: true
            },
            'electron-builder-dist-linux-snap': {
                src: `tmp/desktop/electron-builder/KeeWeb_${pkg.version}_amd64.snap`,
                dest: `dist/desktop/KeeWeb-${pkg.version}.linux.snap`,
                nonull: true
            },
            'electron-builder-dist-linux-appimage': {
                src: `tmp/desktop/electron-builder/keeweb-${pkg.version}.AppImage`,
                dest: `dist/desktop/KeeWeb-${pkg.version}.linux.AppImage`,
                nonull: true
            },
            'darwin-installer-icon': {
                src: 'graphics/icon.icns',
                dest: 'tmp/desktop/KeeWeb Installer.app/Contents/Resources/applet.icns',
                nonull: true
            },
            'native-messaging-host-darwin-x64': {
                src:
                    'node_modules/@keeweb/keeweb-native-messaging-host/darwin-x64/keeweb-native-messaging-host',
                dest:
                    'tmp/desktop/KeeWeb-darwin-x64/KeeWeb.app/Contents/MacOS/util/keeweb-native-messaging-host',
                nonull: true,
                options: { mode: '0755' }
            },
            'native-messaging-host-darwin-arm64': {
                src:
                    'node_modules/@keeweb/keeweb-native-messaging-host/darwin-arm64/keeweb-native-messaging-host',
                dest:
                    'tmp/desktop/KeeWeb-darwin-arm64/KeeWeb.app/Contents/MacOS/util/keeweb-native-messaging-host',
                nonull: true,
                options: { mode: '0755' }
            },
            'native-messaging-host-linux-x64': {
                src:
                    'node_modules/@keeweb/keeweb-native-messaging-host/linux-x64/keeweb-native-messaging-host',
                dest: 'tmp/desktop/keeweb-linux-x64/keeweb-native-messaging-host',
                nonull: true,
                options: { mode: '0755' }
            },
            'native-messaging-host-win32-x64': {
                src:
                    'node_modules/@keeweb/keeweb-native-messaging-host/win32-x64/keeweb-native-messaging-host.exe',
                dest: 'tmp/desktop/KeeWeb-win32-x64/keeweb-native-messaging-host.exe',
                nonull: true
            },
            'native-messaging-host-win32-ia32': {
                src:
                    'node_modules/@keeweb/keeweb-native-messaging-host/win32-ia32/keeweb-native-messaging-host.exe',
                dest: 'tmp/desktop/KeeWeb-win32-ia32/keeweb-native-messaging-host.exe',
                nonull: true
            },
            'native-messaging-host-win32-arm64': {
                src:
                    'node_modules/@keeweb/keeweb-native-messaging-host/win32-arm64/keeweb-native-messaging-host.exe',
                dest: 'tmp/desktop/KeeWeb-win32-arm64/keeweb-native-messaging-host.exe',
                nonull: true
            }
        }
    };
};
