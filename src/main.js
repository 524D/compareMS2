// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.
const { app, BrowserWindow, Menu, shell } = require('electron');
const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initPhylTree, showPhylTreeWindow } = require('./main-phyltree.js');
const { initHeatMap, showHeatMapWindow } = require('./main-heatmap.js');
const { initS2S, showS2SWindow } = require('./main-spectra2species.js');
const homedir = require('os').homedir();

const defaultOptions = {
    compareMode: "phyltree",
    mgfDir: homedir,
    mzFile1: "",
    mzFile2: "",
    maxPrecursorDifference: 2.05,
    minBasepeakIntensity: 10000,
    minTotalIonCurrent: 0,
    maxRTDifference: 60,
    startRT: 0,
    endRT: 100000,
    maxScanNumberDifference: 10000,
    startScan: 1,
    endScan: 1000000,
    cutoff: 0.8,
    specMetric: 0,
    scaling: 1.0,
    noise: 10,
    metric: 2,
    qc: 0,
    topN: -1,
    s2sFile: homedir,
    outBasename: "comp",
    avgSpecie: true,
    outNexus: false,
    outNewick: false,
    outMega: true,
    impMissing: false,
    compareOrder: "smallest-largest",
    keepSettings: true,
}

// The filename where options of the last run are stored
const prevOptionsFn = path.join(homedir, 'compareMS2opts.json');

// General values passed used for all compare functions
const generalParams = getExe();

// FIXME: Use IPC instead of remote for communication: https://www.electronjs.org/docs/latest/tutorial/ipc
require('@electron/remote/main').initialize();

// We don't accept filenames from the renderer process, but just use the data that was
// selected in the dialog.
// This is to prevent security issues with the renderer process.
var fileParams = getDefaultFileParams();

function getDefaultFileParams() {
    return {
        file1: null,
        file2: null,
        sampleDir: {
            dir: homedir,
            files: [],
            mgfFiles: [],
            mgfFilesFull: [],
            mgfFilesShort: []
        },
        sampleToSpeciesFn: null,
        sampleToSpeciesManuallySet: false, // Set to true if the user manually selected a sample-to-species file
    };
}

function getExe() {
    const myPath = app.getAppPath();
    // Return the path to the compareMS2 and compareMS2_to_distance_matrices executables
    let compareMS2exe = null;
    let compToDistExe = null;

    if (process.platform === 'linux' && process.arch === 'x64') {
        compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
    } else if (process.platform === 'win32' && process.arch === 'x64') {
        compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2.exe');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices.exe');
    }
    else if (process.platform == 'darwin') {
        compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2_darwin');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices_darwin');
    } else {
        console.error('Unsupported platform: ' + process.platform);
    }
    return { compareMS2exe: compareMS2exe, compToDistExe: compToDistExe };
}


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

function handleStoreImage(dummy, imgFmt, imageData, instanceId) {
    const files = dialog.showSaveDialogSync(mainWindow, {
        title: 'Save image',
        defaultPath: 'heatmap.' + imgFmt,
        filters: [
            { name: imgFmt + ' file', extensions: [imgFmt] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    if (files) {
        fs.writeFile(files, imageData, function (err) {
            if (err) {
                return console.log(err);
            }
        });
    }
}

// Get the initial parameters for the main window
ipcMain.on('request-options', (event) => {
    // Check if the options file exists
    fs.access(prevOptionsFn, fs.F_OK, (err) => {
        if (err) {
            // Load the default options 
            updateOptionsToRenderer(defaultOptions);
        } else {
            // If the file exists, load the options from the file
            loadOptionsFromFile(prevOptionsFn, (options) => {
                // Update the options in the main window
                updateOptionsToRenderer(options);
            });
        }
    });
})

ipcMain.on('open-dir-dialog', (event) => {
    const dir = dialog.showOpenDialogSync(mainWindow, {
        title: 'Select sample directory',
        properties: ['openDirectory']
    });
    if (dir && dir[0]) {
        getSampleDirFiles(dir[0]);
        mainWindow.send('selected-directory', fileParams.sampleDir);
        const mainWindowsComputedItems = getMainWindowCompItems(fileParams.sampleDir, fileParams.file1);
        mainWindow.send('update-main-window-items', mainWindowsComputedItems);
    }
})

ipcMain.on('open-file1-dialog', (event) => {
    const files = selectMGFfile('First sample file');
    if (files) {
        fileParams.file1 = files[0];
        mainWindow.send('selected-file1', fileParams.file1)
        const mainWindowsComputedItems = getMainWindowCompItems(fileParams.sampleDir, fileParams.file1);
        mainWindow.send('update-main-window-items', mainWindowsComputedItems);
    }
})

ipcMain.on('open-file2-dialog', (event) => {
    const files = selectMGFfile('Second sample file');
    if (files) {
        fileParams.file2 = files[0];
        mainWindow.send('selected-file2', fileParams.file2)
        const mainWindowsComputedItems = getMainWindowCompItems(fileParams.sampleDir, fileParams.file1);
        mainWindow.send('update-main-window-items', mainWindowsComputedItems);
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
        fileParams.sampleToSpeciesFn = files[0];
        fileParams.sampleToSpeciesManuallySet = true;
        mainWindow.send('selected-speciesfile', fileParams.sampleToSpeciesFn)
    }
})

ipcMain.on('start-comparison', (event, mode, params) => {
    // Save parameters for next time
    const fn = path.join(homedir, 'compareMS2opts.json');
    saveOptionsToFile(fn, params)
    // Replace the file items in params with the info from fileParams
    params.file1 = fileParams.file1;
    params.file2 = fileParams.file2;
    params.sampleDir = fileParams.sampleDir;
    params.sampleToSpeciesFn = fileParams.sampleToSpeciesFn;

    const icon = path.join(iconPath, 'tree.png'); // Default icon for the windows
    switch (mode) {
        case "phyltree":
            showPhylTreeWindow(mainWindow, icon, params)
            break;
        case "heatmap":
            showHeatMapWindow(mainWindow, icon, params)
            break;
        case "spec-to-species":
            showS2SWindow(mainWindow, icon, params);
            break;
    }
});

// Toggle full screen tree window. Doesn't work :(
ipcMain.on('toggle-fullscreen', (event, instanceId) => {
    treeWindows[instanceId].setFullScreen(!treeWindows[instanceId].isFullScreen());
})

ipcMain.on('store-image', handleStoreImage);

ipcMain.on('openSourceCodeInBrowser', (event) => {
    shell.openExternal("https://github.com/524D/compareMS2");
})

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
    app.quit();
}

// Keep a global reference of the window objects, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

initPhylTree(generalParams);
initHeatMap(generalParams);
initS2S(generalParams);

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
                //                focusedWindow.send('load-options', files);
                loadOptionsFromFile(files[0], (options) => {
                    // Update the options in the main window
                    updateOptionsToRenderer(options);
                });
            }
        },
        icon: path.join(iconPath, 'OpenFile.png'),
    }, {
        label: 'Save options',
        accelerator: 'CmdOrCtrl+S',
        click: (item, focusedWindow) => {
            const optionSaveFn = dialog.showSaveDialogSync(mainWindow, {
                title: 'Save options',
                defaultPath: 'compareMS2opts.json',
                filters: [
                    { name: 'Options file (JSON)', extensions: ['json'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            if (optionSaveFn) {
                // The renderer process will send the options back to the main process
                // with a 'store-options' message and we will save them to the file
                ipcMain.once('store-options', (event, options) => {
                    saveOptionsToFile(optionSaveFn, options);
                });
                // Request the options from the main window
                mainWindow.send('save-options');
            }
        },
        icon: path.join(iconPath, 'Save.png'),
    }, {
        label: 'Restore default option',
        accelerator: 'CmdOrCtrl+R',
        click: (item, focusedWindow) => {
            fileParams = getDefaultFileParams();
            options = JSON.parse(JSON.stringify(defaultOptions));
            updateOptionsToRenderer(options);
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
        width: 840,
        height: 820,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(iconPath, 'tree.png'),
    });

    // and load the index.html of the app.
    mainWindow.loadFile(path.join(__dirname, '/index.html'),
        {
            query: {
                "version": app.getVersion()
            }
        });

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

    // Open external links in the default browser (but there should not be any)
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

function getSampleDirFiles(dir) {
    const filesAndDirs = fs.readdirSync(dir);
    const files = filesAndDirs.filter(file => {
        const filePath = path.join(dir, file);
        return fs.statSync(filePath).isFile();
    });
    // Filter for MGF files
    const mgfFiles = files.filter(file => file.endsWith('.mgf'));
    const mgfFilesFull = mgfFiles.map(file => path.join(dir, file));
    const mgfFilesShort = mgfFiles.map(file => path.basename(file));
    const s2sFn = path.join(dir, "sample_to_species.txt");
    // Check if sample_to_species.txt exists
    fs.access(s2sFn, fs.F_OK, (err) => {
        if (err) {
            // No sample_to_species.txt file found
        } else {
            if (!fileParams.sampleToSpeciesManuallySet) {
                // If the file exists and we don't have a sampleToSpeciesFn yet, set it
                fileParams.sampleToSpeciesFn = s2sFn;
            }
        }
    });

    // Store the parameters in the fileParams object
    fileParams.sampleDir = {
        dir: dir,
        files: files,
        mgfFiles: mgfFiles,
        mgfFilesFull: mgfFilesFull,
        mgfFilesShort: mgfFilesShort,
    };
}

function loadOptionsFromFile(fn, processOpts) {
    fs.readFile(fn, 'utf-8', (err, data) => {
        if (err) {
            alert("An error occurred reading the file :" + err.message);
            return;
        }
        else {
            const options = JSON.parse(data);
            // Check is all options in defaultOptions are present in options
            for (const key in defaultOptions) {
                if (!options.hasOwnProperty(key)) {
                    // If not, set the default value
                    options[key] = defaultOptions[key];
                }
            }
            // Read the sample directory files and update fileParam
            getSampleDirFiles(options.mgfDir);
            // Update the fileParams object with the options
            fileParams.file1 = options.mzFile1;
            fileParams.file2 = options.mzFile2;
            processOpts(options);
        }
    });
}

function saveOptionsToFile(fn, options) {
    // Replace file names with stored paths
    options.mzFile1 = fileParams.file1;
    options.mzFile2 = fileParams.file2;
    options.mgfDir = fileParams.sampleDir.dir;
    options.s2sFile = fileParams.sampleToSpeciesFn;
    try { fs.writeFileSync(fn, JSON.stringify(options, null, 2), 'utf-8'); }
    catch (e) { alert('Failed to save options file'); }
}

function updateOptionsToRenderer(options) {
    // Send the options to the renderer process
    options.mgfDir = fileParams.sampleDir.dir;
    options.mzFile1 = fileParams.file1;
    options.mzFile2 = fileParams.file2;
    options.s2sFile = fileParams.sampleToSpeciesFn;
    mainWindow.webContents.send('update-options', options);

    // Update the main window items based on the options
    const sampleDir = fileParams.sampleDir;
    const sampleFile1 = fileParams.file1;
    const mainWindowsComputedItems = getMainWindowCompItems(sampleDir, sampleFile1);
    // Send the computed items to the main window
    // This will update the main window items in the renderer process
    mainWindow.send('update-main-window-items', mainWindowsComputedItems);
}

// Get the main window component items for the different compare modes
// Returns an object with the compare mode as key and an array with:
// [message, number of comparisons, submit enabled]
function getMainWindowCompItems(sampleDir, sampleFile1) {
    const mgfFiles = sampleDir.mgfFiles;
    const nMgf = mgfFiles.length;

    // Message for compare mode "phyltree":
    const nCompPhylTree = (nMgf * (nMgf - 1)) / 2;
    const phylTreeMsg = nMgf + " MGF files, " + nCompPhylTree + " comparisons.";
    const phylTreeSubmitEnabled = (mgfFiles.length >= 2);
    // Message for compare mode "heatmap":
    const heatMapMsg = ""
    const heatMapSubmitEnabled = (sampleFile1 !== null);

    // Message for compare mode "spec-to-species":
    const nCompSpectra2Species = nMgf;
    const spectra2SpeciesMsg = nMgf + " MGF files, " + nCompSpectra2Species + " comparisons.";
    const spectra2SpeciesSubmitEnabled = ((sampleFile1 !== null) && mgfFiles.length >= 2);
    return {
        'phyltree': [phylTreeMsg, phylTreeSubmitEnabled],
        'heatmap': [heatMapMsg, heatMapSubmitEnabled],
        'spec-to-species': [spectra2SpeciesMsg, spectra2SpeciesSubmitEnabled]
    };
}
