// Shared mutable state between main.js and the desktop modules.
// main.js assigns context.mainWindow; modules read (and clear) it through this object.

const context = {
    mainWindow: null
};

module.exports = { context };
