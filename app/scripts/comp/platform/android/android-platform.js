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
                // The native bridge alone has no registerPlugin (that comes from @capacitor/core);
                // it exposes the installed plugins as Capacitor.Plugins.
                plugins[name] =
                    typeof capacitor.registerPlugin === 'function'
                        ? capacitor.registerPlugin(name)
                        : capacitor.Plugins && capacitor.Plugins[name];
                if (!plugins[name]) {
                    throw new Error(`Android plugin ${name} is not available`);
                }
            }
            return plugins[name];
        }
    };
}

const AndroidPlatform = createAndroidPlatform(window);

export { AndroidPlatform, createAndroidPlatform };
