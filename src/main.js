// SPDX-License-Identifier: MIT
// Copyright 2022 Rob Marissen.
const { app, BrowserWindow, Menu, shell, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

// FIXME: Use IPC instead of remote for communication: https://www.electronjs.org/docs/latest/tutorial/ipc
require('@electron/remote/main').initialize();

function selectMGFfile(title) {
    const files = dialog.showOpenDialogSync(mainWindow, {
        title: title,
        properties: ['openFile'],
        filters: [
            { name: 'MGF files', extensions: ['mgf'] },
            { name: 'All Files', extensions: ['*'] }
        ],
    });
    return files;
}

// FIXME: Remove. Not needed anymore, now default:
app.allowRendererProcessReuse = true;
// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
    app.quit();
}

// Keep a global reference of the window objects, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let specWindows = [];
let specInstanceCount = 0;
let treeWindows = [];
let treeInstanceCount = 0;

const iconPath = path.join(app.getAppPath(), 'src', 'assets', 'images');
// Icons were obtained from http://xtoolkit.github.io/Micon/icons/
// Convert to png e.g.:
// convert -fuzz 5% -transparent white -resize 16x16 mdl2/Clear.svg /d0/product/compareMS2/src/assets/images/Clear.png

let template = [{
    label: 'File',
    submenu: [{
        label: 'Load options',
        accelerator: 'CmdOrCtrl+L',
        click: (item, focusedWindow) => {
            const files = dialog.showOpenDialogSync(mainWindow, {
                title: 'Load options',
                filters: [
                    { name: 'Options file (JSON)', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            if (files) {
                focusedWindow.send('load-options', files);
            }
        },
        icon: path.join(iconPath, 'OpenFile.png'),
    }, {
        label: 'Save options',
        accelerator: 'CmdOrCtrl+S',
        click: (item, focusedWindow) => {
            const files = dialog.showSaveDialogSync(mainWindow, {
                title: 'Save options',
                defaultPath: 'compareMS2opts.json',
                filters: [
                    { name: 'Options file (JSON)', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            if (files) {
                focusedWindow.send('save-options', files);
            }
        },
        icon: path.join(iconPath, 'Save.png'),
    }, {
        label: 'Restore default option',
        accelerator: 'CmdOrCtrl+R',
        click: (item, focusedWindow) => {
            focusedWindow.send('reset-options');
        },
        icon: path.join(iconPath, 'Refresh.png'),
    },
    {
        type: 'separator'
    }, {
        label: 'Exit',
        accelerator: 'CmdOrCtrl+Q',
        role: 'quit',
        icon: path.join(iconPath, 'Clear.png'),
    }]
}, {
    label: 'View',
    submenu: [{
        label: 'Toggle Full Screen',
        accelerator: (() => {
            if (process.platform === 'darwin') {
                return 'Ctrl+Command+F'
            } else {
                return 'F11'
            }
        })(),
        click: (item, focusedWindow) => {
            if (focusedWindow) {
                focusedWindow.setFullScreen(!focusedWindow.isFullScreen())
            }
        },
        icon: path.join(iconPath, 'View.png'),
    }]
}, {
    label: 'Help',
    role: 'help',
    submenu: [{
        label: 'Getting started',
        click: () => {
            shell.openExternal('https://github.com/524D/compareMS2')
        },
        icon: path.join(iconPath, 'Help.png'),
    },
    {
        label: 'About',
        click: (item, focusedWindow) => {
            if (focusedWindow) {
                focusedWindow.send('show-about');
            }
        }
    }],
}]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
        width: 780,
        height: 820,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false,  // without this, we can't open new windows
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(iconPath, 'tree.png'),
    });

    // and load the index.html of the app.
    mainWindow.loadURL(`file://${__dirname}/index.html`);
    require("@electron/remote/main").enable(mainWindow.webContents);

    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        // Open the DevTools.
        mainWindow.webContents.openDevTools();
        mainWindow.maximize();
    }

    // Emitted when the window is closed.
    mainWindow.on('closed', () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });

    // mainWindow.setWindowOpenHandler(function(details) {
    //     require('electron').shell.openExternal(details.url);
    // });

    mainWindow.webContents.on('new-window', function (e, url) {
        e.preventDefault();
        require('electron').shell.openExternal(url);
    });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
const { ipcMain, dialog } = require('electron')

ipcMain.on('open-dir-dialog', (event) => {
    const files = dialog.showOpenDialogSync(mainWindow, {
        title: 'Select sample directory',
        properties: ['openDirectory']
    });
    if (files) {
        mainWindow.send('selected-directory', files)
    }
})

ipcMain.on('open-file1-dialog', (event) => {
    const files = selectMGFfile('First sample file');
    if (files) {
        mainWindow.send('selected-file1', files)
    }
})

ipcMain.on('open-file2-dialog', (event) => {
    const files = selectMGFfile('Second sample file');
    if (files) {
        mainWindow.send('selected-file2', files)
    }
})

ipcMain.on('open-speciesfile-dialog', (event) => {
    const files = dialog.showOpenDialogSync(mainWindow, {
        title: 'Open sample-to-species file',
        filters: [
            { name: 'Text file', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    if (files) {
        mainWindow.send('selected-speciesfile', files)
    }
})

// Display spectral comparison window and send params
ipcMain.on('compareSpecs', (event, params) => {
    let specWindow = new BrowserWindow({
        width: 1000,
        height: 780,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false,  // without this, we can't open new windows
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(iconPath, 'tree.png'),
    });
    specInstanceCount++;
    specWindows[specInstanceCount] = specWindow;
    specWindow.on('close', () => { specWindow = null })
    specWindow.removeMenu();
    specWindow.loadFile(path.join(__dirname, '/heatmap.html'),
        {
            query: {
                "userparams": JSON.stringify(params),
                "instanceId": specInstanceCount
            }
        });
    require("@electron/remote/main").enable(specWindow.webContents);
    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        // Open the DevTools.
        specWindow.webContents.openDevTools();
    }

    specWindow.show();
})


// Display tree window and send params
ipcMain.on('maketree', (event, params) => {
    const treePath = path.join('file://', __dirname, '/tree.html')
    let treeWindow = new BrowserWindow({
        width: 1000,
        height: 780,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false,  // without this, we can't open new windows
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(iconPath, 'tree.png'),
    });
    treeInstanceCount++;
    treeWindows[treeInstanceCount] = treeWindow;
    //treeWindow.maximize();
    treeWindow.on('close', () => { treeWindow = null })
    treeWindow.removeMenu();
    treeWindow.loadFile(path.join(__dirname, '/tree.html'),
        {
            query: {
                "userparams": JSON.stringify(params),
                "instanceId": treeInstanceCount
            }
        });
    require("@electron/remote/main").enable(treeWindow.webContents);
    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        // Open the DevTools.
        treeWindow.webContents.openDevTools();
    }

    treeWindow.show();
})

// Toggle full screen tree window. Doesn't work :(
ipcMain.on('toggle-fullscreen', (event, instanceId) => {
    treeWindows[instanceId].setFullScreen(!treeWindows[instanceId].isFullScreen());
})

ipcMain.on('write-newick', (event, newickFn, newick) => {
    fs.writeFile(newickFn, newick, function (err) {
        if (err) {
            return console.log(err);
        }
    });
})

ipcMain.on('move-file', (event, fn1, fn2) => {
    fs.rename(fn1, fn2, function (err) {
        if (err) {
            return console.log(err);
        }
    });
})