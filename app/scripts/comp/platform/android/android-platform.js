function createAndroidPlatform(win) {
    const capacitor = win && win.Capacitor;
    const isAndroid = !!(
        capacitor &&
        typeof capacitor.getPlatform === 'function' &&
        capacitor.getPlatform() === 'android'
    );
    const plugins = {};
    let pendingFlows = 0;
    return {
        isAndroid,
        // True while a native screen started by the app (e.g. the document picker) covers it.
        get nativeFlowPending() {
            return pendingFlows > 0;
        },
        withNativeFlow(start) {
            pendingFlows++;
            let flow;
            try {
                flow = Promise.resolve(start());
            } catch (e) {
                pendingFlows--;
                throw e;
            }
            return flow.finally(() => pendingFlows--);
        },
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
