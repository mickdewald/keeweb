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

    it('falls back to Capacitor.Plugins when the bridge has no registerPlugin', () => {
        const app = { addListener() {} };
        const win = { Capacitor: { getPlatform: () => 'android', Plugins: { App: app } } };
        const platform = createAndroidPlatform(win);
        expect(platform.plugin('App')).to.equal(app);
        expect(() => platform.plugin('Missing')).to.throw('not available');
    });

    it('marks a native flow as pending until it settles', async () => {
        const platform = createAndroidPlatform({});
        let finish;
        const flow = platform.withNativeFlow(() => new Promise((resolve) => (finish = resolve)));
        expect(platform.nativeFlowPending).to.equal(true);
        finish('picked');
        expect(await flow).to.equal('picked');
        expect(platform.nativeFlowPending).to.equal(false);

        const failed = platform.withNativeFlow(() => Promise.reject(new Error('canceled')));
        expect(platform.nativeFlowPending).to.equal(true);
        await failed.catch(() => {});
        expect(platform.nativeFlowPending).to.equal(false);

        expect(() =>
            platform.withNativeFlow(() => {
                throw new Error('no plugin');
            })
        ).to.throw('no plugin');
        expect(platform.nativeFlowPending).to.equal(false);
    });

    it('refuses plugin access outside Android', () => {
        expect(() => createAndroidPlatform({}).plugin('App')).to.throw('outside Android');
    });
});

describe('AndroidDefaults', () => {
    it('applies the Android defaults exactly once', () => {
        const values = {
            deviceOwnerAuth: null,
            deviceOwnerAuthTimeoutMinutes: 0,
            clipboardSeconds: 0
        };
        const settings = { set: (v) => Object.assign(values, v) };
        const runtimeData = {};
        expect(AndroidDefaults.apply(settings, runtimeData)).to.equal(true);
        // Timeout 0 would expire the biometric password immediately; 1 week is a settings option.
        expect(values).to.eql({
            deviceOwnerAuth: 'file',
            deviceOwnerAuthTimeoutMinutes: 10080,
            clipboardSeconds: 30
        });

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

describe('SingleInstanceChecker outside Android', () => {
    it('arms the multi-tab guard in a regular browser', () => {
        const original = SingleInstanceChecker.setKey;
        let armed = false;
        SingleInstanceChecker.setKey = () => {
            armed = true;
        };
        try {
            SingleInstanceChecker.init({ isAndroid: false });
        } finally {
            SingleInstanceChecker.setKey = original;
            window.removeEventListener('storage', SingleInstanceChecker.storageChanged);
        }
        expect(armed).to.equal(true);
    });
});
