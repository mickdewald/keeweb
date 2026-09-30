import { expect } from 'chai';
import { createAndroidPlatform } from 'comp/platform/android/android-platform';
import { AndroidDefaults } from 'comp/platform/android/android-defaults';
import { SingleInstanceChecker } from 'comp/app/single-instance-checker';

describe('AndroidPlatform', () => {
    it('is not Android in a plain browser window', () => {
        expect(createAndroidPlatform({}).isAndroid).to.equal(false);
    });

    it('is not Android on a non-Android Capacitor platform', () => {
        const win = { Capacitor: { getPlatform: () => 'web' } };
        expect(createAndroidPlatform(win).isAndroid).to.equal(false);
    });

    it('detects Capacitor Android and registers each plugin once', () => {
        const registered = [];
        const win = {
            Capacitor: {
                getPlatform: () => 'android',
                registerPlugin: (name) => {
                    registered.push(name);
                    return { name };
                }
            }
        };
        const platform = createAndroidPlatform(win);
        expect(platform.isAndroid).to.equal(true);
        expect(platform.plugin('App')).to.eql({ name: 'App' });
        platform.plugin('App');
        expect(registered).to.eql(['App']);
    });

    it('refuses plugin access outside Android', () => {
        expect(() => createAndroidPlatform({}).plugin('App')).to.throw('outside Android');
    });
});

describe('AndroidDefaults', () => {
    it('applies the Android defaults exactly once', () => {
        const values = { deviceOwnerAuth: null, clipboardSeconds: 0 };
        const settings = { set: (v) => Object.assign(values, v) };
        const runtimeData = {};
        expect(AndroidDefaults.apply(settings, runtimeData)).to.equal(true);
        expect(values).to.eql({ deviceOwnerAuth: 'file', clipboardSeconds: 30 });

        values.deviceOwnerAuth = null; // the user switched biometrics off later
        expect(AndroidDefaults.apply(settings, runtimeData)).to.equal(false);
        expect(values.deviceOwnerAuth).to.equal(null);
    });
});

describe('SingleInstanceChecker on Android', () => {
    it('does not arm the multi-tab guard', () => {
        const original = SingleInstanceChecker.setKey;
        let armed = false;
        SingleInstanceChecker.setKey = () => {
            armed = true;
        };
        try {
            SingleInstanceChecker.init({ isAndroid: true });
        } finally {
            SingleInstanceChecker.setKey = original;
        }
        expect(armed).to.equal(false);
    });
});
