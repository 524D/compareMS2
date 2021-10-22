import { app, BrowserWindow, Menu, shell } from 'electron';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}
const path = require('path')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;
let treeWindow;

let params; // User parameters set in main window
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
    icon: path.join(iconPath,'OpenFile.png'),
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
    icon: path.join(iconPath,'Save.png'),
  }, {
    label: 'Restore default option',
    accelerator: 'CmdOrCtrl+R',
    click: (item, focusedWindow) => {
      focusedWindow.send('reset-options');
    },
    icon: path.join(iconPath,'Refresh.png'),
  }, 
  {
    type: 'separator'
  }, {
    label: 'Exit',
    accelerator: 'CmdOrCtrl+Q',
    role: 'quit',
    icon: path.join(iconPath,'Clear.png'),
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
    icon: path.join(iconPath,'View.png'),
  }]
}, {
  label: 'Help',
  role: 'help',
  submenu: [{
    label: 'Getting started',
    click: () => {
      shell.openExternal('https://github.com/524D/compareMS2')
    },
    icon: path.join(iconPath,'Help.png'),
  }],
}]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 700,
    height: 680,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false,  // without this, we can't open new windows
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(iconPath,'tree.png'),
  });

  // and load the index.html of the app.
  mainWindow.loadURL(`file://${__dirname}/index.html`);

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
const {ipcMain, dialog} = require('electron')

ipcMain.on('open-dir-dialog', (event) => {
  const files = dialog.showOpenDialogSync(mainWindow, {
    title: 'Select sample directory',
    properties: ['openDirectory']
  });
  if (files) {
      mainWindow.send('selected-directory', files)
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

// Display tree windows and send params
ipcMain.on('maketree', (event, args) => {
  const treePath = path.join('file://', __dirname, '/tree.html')
  params = args;
  treeWindow = new BrowserWindow({
    width: 1000,
    height: 780,
    parent: mainWindow,
    modal: true,
    webPreferences: {
        nodeIntegration: true,
        enableRemoteModule: true,
        contextIsolation: false,  // without this, we can't open new windows
        preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(iconPath,'tree.png'),
  });
  treeWindow.maximize();
  treeWindow.on('close', () => { treeWindow = null })
  treeWindow.removeMenu();
  treeWindow.loadURL(treePath);
  if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
    // Open the DevTools.
    treeWindow.webContents.openDevTools();
  } 

  treeWindow.show();
})

// Send parameters to tree window
ipcMain.on('get-userparms', () => {
   treeWindow.send('userparams', params);
})

// Toggle full screen tree window. Doesn't work :(
ipcMain.on('toggle-fullscreen', (event) => {
    treeWindow.setFullScreen(!treeWindow.isFullScreen());
})
