const electron = require('electron');

const { context } = require('./context');
const { locale } = require('./locale');

function setMenu() {
    if (process.platform === 'darwin') {
        const name = require('electron').app.name;
        const template = [
            {
                label: name,
                submenu: [
                    { role: 'about', label: locale.sysMenuAboutKeeWeb?.replace('{}', 'KeeWeb') },
                    { type: 'separator' },
                    { role: 'services', submenu: [], label: locale.sysMenuServices },
                    { type: 'separator' },
                    {
                        accelerator: 'Command+H',
                        role: 'hide',
                        label: locale.sysMenuHide?.replace('{}', 'KeeWeb')
                    },
                    {
                        accelerator: 'Command+Shift+H',
                        role: 'hideothers',
                        label: locale.sysMenuHideOthers
                    },
                    { role: 'unhide', label: locale.sysMenuUnhide },
                    { type: 'separator' },
                    {
                        role: 'quit',
                        accelerator: 'Command+Q',
                        label: locale.sysMenuQuit?.replace('{}', 'KeeWeb')
                    }
                ]
            },
            {
                label: locale.sysMenuEdit || 'Edit',
                submenu: [
                    { accelerator: 'CmdOrCtrl+Z', role: 'undo', label: locale.sysMenuUndo },
                    { accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo', label: locale.sysMenuRedo },
                    { type: 'separator' },
                    { accelerator: 'CmdOrCtrl+X', role: 'cut', label: locale.sysMenuCut },
                    { accelerator: 'CmdOrCtrl+C', role: 'copy', label: locale.sysMenuCopy },
                    { accelerator: 'CmdOrCtrl+V', role: 'paste', label: locale.sysMenuPaste },
                    {
                        accelerator: 'CmdOrCtrl+A',
                        role: 'selectall',
                        label: locale.sysMenuSelectAll
                    }
                ]
            },
            {
                label: locale.sysMenuWindow || 'Window',
                submenu: [
                    { accelerator: 'CmdOrCtrl+M', role: 'minimize', label: locale.sysMenuMinimize },
                    { accelerator: 'Command+W', role: 'close', label: locale.sysMenuClose }
                ]
            }
        ];
        const menu = electron.Menu.buildFromTemplate(template);
        electron.Menu.setApplicationMenu(menu);
    } else {
        context.mainWindow.setMenuBarVisibility(false);
        context.mainWindow.setMenu(null);
        electron.Menu.setApplicationMenu(null);
    }
}

function onContextMenu(e, props) {
    if (props.inputFieldType !== 'plainText' || !props.isEditable) {
        return;
    }
    const Menu = electron.Menu;
    const inputMenu = Menu.buildFromTemplate([
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectall' }
    ]);
    inputMenu.popup(context.mainWindow);
}

module.exports = { setMenu, onContextMenu };
