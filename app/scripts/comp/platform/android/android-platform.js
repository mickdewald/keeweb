function createAndroidPlatform(win) {
    const capacitor = win && win.Capacitor;
    const isAndroid = !!(
        capacitor &&
        typeof capacitor.getPlatform === 'function' &&
        capacitor.getPlatform() === 'android'
    );
    const plugins = {};
    return {
        isAndroid,
        plugin(name) {
            if (!isAndroid) {
                throw new Error(`Android plugin ${name} requested outside Android`);
            }
            if (!plugins[name]) {
                plugins[name] = capacitor.registerPlugin(name);
            }
            return plugins[name];
        }
    };
}

const AndroidPlatform = createAndroidPlatform(window);

export { AndroidPlatform, createAndroidPlatform };
