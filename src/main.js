// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.
const { app, BrowserWindow, Menu, shell } = require('electron');
const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initPhylTree, showPhylTreeWindow } = require('./main-phyltree.js');
const { initHeatMap, showHeatMapWindow } = require('./main-heatmap.js');
const { initS2S, showS2SWindow } = require('./main-spectra2species.js');
const { getCPUCount } = require('./main-common.js');
const { initializeParallelization } = require('./parallelization-manager.js');
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
    s2sFile: "",
    outBasename: "distance_matrix",
    avgSpecie: true,
    outNexus: false,
    outNewick: false,
    outMega: false,
    outMega12: false,
    impMissing: false,
    compareOrder: "smallest-largest",
    keepSettings: true,
    numberOfCPUs: getCPUCount(), // Default to the number of CPU cores
}

// The filename where options of the last run are stored
const prevOptionsFn = getUserDataFn();

// Parse any command line arguments supplied when launching the app.
// These override saved options and defaults (applied in the request-options handler).
const USAGE_STRING =
    'usage: compareMS2 [-h|--help]' +
    ' [<mgf directory>]' +
    ' [<first dataset.mgf>]' +
    ' [<second dataset.mgf>]' +
    ' [-W|--scan-range <first scan number>,<last scan number>]' +
    ' [-R|--rt-range <first retention time>,<last retention time>]' +
    ' [-c|--cutoff <score cutoff>]' +
    ' [-o|--output <output basename>]' +
    ' [-m|--min-intensity <min base peak intensity>,<min total ion current>]' +
    ' [-w|--max-scan-diff <maximum scan number difference>]' +
    ' [-r|--max-rt-diff <maximum retention time difference>]' +
    ' [-p|--max-precursor-diff <maximum difference in precursor mass>]' +
    ' [-s|--scaling <scaling power>]' +
    ' [-n|--noise <noise threshold>]' +
    ' [-d|--metric <distance metric (0, 1 or 2)>]' +
    ' [-q|--qc <QC measure (0)>]';
const cliArgOverrides = parseCommandLineArgs();

// We have split the code for the different compare modes into separate files
// This is to keep the main.js file clean and to allow for easier maintenance
// Some parameters are shared between the different compare modes, so we define them here
// and pass them to the different modules.
const generalParams = getExe();

// We don't accept filenames from the renderer process, but just use the data that was
// selected in the dialog.
// This is to prevent security issues with the renderer process.
var fileParams = getDefaultFileParams();

function getDefaultFileParams() {
    return {
        file1: "",
        file2: "",
        sampleDir: {
            dir: homedir,
            files: [],
            mgfFiles: [],
            mgfFilesFull: [],
            mgfFilesShort: []
        },
        s2sFile: "",
        sampleToSpeciesManuallySet: false, // Set to true if the user manually selected a sample-to-species file
    };
}

function getExe() {
    const myPath = app.getAppPath();
    // Return the path to the compareMS2 and compareMS2_to_distance_matrices executables
    let compareMS2Exe = null;
    let compToDistExe = null;

    if (process.platform === 'linux' && process.arch === 'x64') {
        compareMS2Exe = path.join(myPath, 'external_binaries', 'compareMS2');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
    } else if (process.platform === 'win32' && process.arch === 'x64') {
        compareMS2Exe = path.join(myPath, 'external_binaries', 'compareMS2.exe');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices.exe');
    }
    else if (process.platform == 'darwin') {
        compareMS2Exe = path.join(myPath, 'external_binaries', 'compareMS2_darwin');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices_darwin');
    } else {
        console.error('Unsupported platform: ' + process.platform);
    }
    return { compareMS2Exe: compareMS2Exe, compToDistExe: compToDistExe };
}

// Get the user data file name where the options are stored
// This is used to store the options for the next run of the application
// The file is stored in the userData directory of the application
// The userData directory is located in a platform-specific location:
// e.g. on Windows: C:\Users\<username>\AppData\Roaming\compareMS2
// e.g. on Linux: /home/<username>/.config/compareMS2
// e.g. on macOS: /Users/<username>/Library/Application Support/compareMS2
// The file is named compareMS2opts.json
// The directory is created if it does not exist yet.
function getUserDataFn() {
    const userData = app.getPath('userData');
    const fn = path.join(userData, 'compareMS2opts.json');
    // Ensure the userData directory exists
    if (!fs.existsSync(userData)) {
        fs.mkdirSync(userData, { recursive: true });
    }
    return fn;
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

function handleStoreImageV2(event, defaultName, imgFmt, imageData) {
    // Validate that the request comes from a legitimate child window (not mainWindow)
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow === mainWindow) {
        return;
    }

    // Sanitize the defaultName to ensure it is a valid filename
    defaultName = defaultName.replace(/[^a-z0-9_\-\.]/gi, '_').toLowerCase();
    // Ensure the defaultName does not end with a dot
    if (defaultName.endsWith('.')) {
        defaultName = defaultName.slice(0, -1);
    }
    // Sanitize the imgFmt to ensure it is a valid file extension
    imgFmt = imgFmt.replace(/[^a-z0-9_\-]/gi, '').toLowerCase();
    // Ensure the imgFmt is not empty
    if (!imgFmt) {
        imgFmt = 'png'; // Default to png if imgFmt is empty
    }
    // For PNG files, imageData is of type ArrayBuffer,
    // Convert it to a Buffer using Buffer.from
    if (imgFmt === 'png' && imageData instanceof ArrayBuffer) {
        imageData = Buffer.from(imageData);
    }

    const files = dialog.showSaveDialogSync(senderWindow, {
        title: 'Save image',
        defaultPath: defaultName + '' + imgFmt,
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
    fs.access(prevOptionsFn, fs.constants.F_OK, (err) => {
        if (err) {
            // Load the default options
            applyCliArgsToOptions(defaultOptions);
            updateOptionsToRenderer(defaultOptions);
        } else {
            // If the file exists, load the options from the file
            loadOptionsFromFile(prevOptionsFn, true, (options) => {
                // Apply CLI overrides on top of saved options
                applyCliArgsToOptions(options);
                // Update the options in the main window
                updateOptionsToRenderer(options);
            });
        }
    });
})

ipcMain.on('main-gui-action', (event, action) => {
    switch (action) {
        case 'select-dir': {
            const dirs = dialog.showOpenDialogSync(mainWindow, {
                title: 'Select sample directory',
                properties: ['openDirectory']
            });
            if (dirs && dirs[0]) {
                const dir = dirs[0];
                // Read the directory contents and update fileParams
                getSampleDirFiles(dir);
                const s2sFile = updateSampleToSpeciesFile(dir, fileParams);
                fileParams.s2sFile = s2sFile;
                mainWindow.send('selected-directory', fileParams.sampleDir);
                const mainWindowsComputedItems = getMainWindowCompItems(fileParams.sampleDir, fileParams.file1);
                mainWindow.send('update-main-window-items', mainWindowsComputedItems);
                // Send new s2s file in case it was updated
                mainWindow.send('selected-speciesfile', s2sFile);
            }
            break;
        }
        case 'select-file1': {
            const files = selectMGFfile('First sample file');
            if (files && files[0]) {
                fileParams.file1 = files[0];
                mainWindow.send('selected-file1', fileParams.file1);
                const mainWindowsComputedItems = getMainWindowCompItems(fileParams.sampleDir, fileParams.file1);
                mainWindow.send('update-main-window-items', mainWindowsComputedItems);
            }
            break;
        }
        case 'select-file2': {
            const files = selectMGFfile('Second sample file');
            if (files && files[0]) {
                fileParams.file2 = files[0];
                mainWindow.send('selected-file2', fileParams.file2);
            }
            break;
        }
        case 'select-speciesfile': {
            const files = dialog.showOpenDialogSync(mainWindow, {
                title: 'Open sample-to-species file',
                filters: [
                    { name: 'Text file', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            });
            if (files && files[0]) {
                fileParams.s2sFile = files[0];
                fileParams.sampleToSpeciesManuallySet = true;
                mainWindow.send('selected-speciesfile', fileParams.s2sFile);
            }
            break;
        }
        case 'clear-file2': {
            fileParams.file2 = null;
            mainWindow.send('selected-file2', '');
            break;
        }
        case 'clear-speciesfile': {
            fileParams.s2sFile = null;
            fileParams.sampleToSpeciesManuallySet = false;
            mainWindow.send('selected-speciesfile', '');
            break;
        }
    }
})

ipcMain.on('start-comparison', (event, mode, params) => {
    // Initialize parallelization manager with user settings
    if (params.numberOfCPUs && params.numberOfCPUs > 0) {
        initializeParallelization(params.numberOfCPUs);
    } else {
        initializeParallelization(getCPUCount());
    }

    // Save parameters for next time
    const fn = getUserDataFn();
    // Replace the file items in params with the info from fileParams
    params.mzFile1 = fileParams.file1;
    params.mzFile2 = fileParams.file2;
    params.s2sFile = fileParams.s2sFile;
    params.mgfDir = fileParams.sampleDir.dir;
    saveOptionsToFile(fn, params)
    params.sampleDir = fileParams.sampleDir; // Add the sampleDir info to the params that are passed to the compare windows

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

// Toggle full screen
ipcMain.on('toggle-fullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.setFullScreen(!window.isFullScreen());
    }
})

ipcMain.on('store-image-v2', handleStoreImageV2);

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
                loadOptionsFromFile(files[0], false, (options) => {
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
                "version": app.getVersion(),
                "availableCPUs": getCPUCount(), // Pass the number of CPUs to the renderer
            }
        });

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
    // Read the directory contents
    if (!fs.existsSync(dir)) {
        // Directory does not exist, set files to empty array
        fileParams.sampleDir = {
            dir: dir,
            files: [],
            mgfFiles: [],
            mgfFilesFull: [],
            mgfFilesShort: [],
        };
        return;
    }
    const filesAndDirs = fs.readdirSync(dir);
    const files = filesAndDirs.filter(file => {
        const filePath = path.join(dir, file);
        return fs.statSync(filePath).isFile();
    });
    // Filter for MGF files
    const mgfFiles = files.filter(file => file.endsWith('.mgf'));
    const mgfFilesFull = mgfFiles.map(file => path.join(dir, file));
    const mgfFilesShort = mgfFiles.map(file => path.basename(file));

    // Store the parameters in the fileParams object
    fileParams.sampleDir = {
        dir: dir,
        files: files,
        mgfFiles: mgfFiles,
        mgfFilesFull: mgfFilesFull,
        mgfFilesShort: mgfFilesShort,
    };
}

function loadOptionsFromFile(fn, honorKeepSettings, processOpts) {
    fs.readFile(fn, 'utf-8', (err, data) => {
        if (err) {
            mainWindow.webContents.send('show-alert', 'error', "An error occurred reading the file " + fn + " :" + err.message);
            saveOptionsToFile(fn, options);
            return;
        }
        else {
            let options = null;
            try {
                options = JSON.parse(data);
            } catch (e) {
                mainWindow.webContents.send('show-alert', 'error', "An error occurred parsing the options file " + fn + ". The file might be corrupted or not in the correct format.");
                options = defaultOptions;
                saveOptionsToFile(fn, options);
                return;
            }
            // If the Keep Settings option is not set, just set the default options
            if (honorKeepSettings && (!options.keepSettings)) {
                // Reset the options to the default options
                options = defaultOptions;
                options.keepSettings = false; // keepSettings should stay false
            }
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
            fileParams.s2sFile = options.s2sFile;
            processOpts(options);
        }
    });
}

function saveOptionsToFile(fn, options) {
    // Replace file names with stored paths
    options.mgfDir = fileParams.sampleDir.dir;
    options.mzFile1 = fileParams.file1;
    options.mzFile2 = fileParams.file2;
    options.s2sFile = fileParams.s2sFile;

    try { fs.writeFileSync(fn, JSON.stringify(options, null, 2), 'utf-8'); }
    catch (e) { alert('Failed to save options file'); }
}

function updateOptionsToRenderer(options) {
    // Send the options to the renderer process
    options.mgfDir = fileParams.sampleDir.dir;
    options.mzFile1 = fileParams.file1;
    options.mzFile2 = fileParams.file2;
    options.s2sFile = fileParams.s2sFile;
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
    const heatMapSubmitEnabled = (sampleFile1);

    // Message for compare mode "spec-to-species":
    const nCompSpectra2Species = nMgf;
    const spectra2SpeciesMsg = nMgf + " MGF files, " + nCompSpectra2Species + " comparisons.";
    const spectra2SpeciesSubmitEnabled = ((sampleFile1) && mgfFiles.length >= 2);
    return {
        'phyltree': [phylTreeMsg, phylTreeSubmitEnabled],
        'heatmap': [heatMapMsg, heatMapSubmitEnabled],
        'spec-to-species': [spectra2SpeciesMsg, spectra2SpeciesSubmitEnabled]
    };
}

// Apply a single parsed flag+value to the overrides object.
function applyFlag(flag, value, overrides) {
    switch (flag) {
        case 'W': {
            const parts = value.split(',');
            if (parts.length === 2) {
                overrides.startScan = parseInt(parts[0], 10);
                overrides.endScan = parseInt(parts[1], 10);
            }
            break;
        }
        case 'R': {
            const parts = value.split(',');
            if (parts.length === 2) {
                overrides.startRT = parseFloat(parts[0]);
                overrides.endRT = parseFloat(parts[1]);
            }
            break;
        }
        case 'c':
            overrides.cutoff = parseFloat(value);
            break;
        case 'o':
            overrides.outBasename = value;
            break;
        case 'm': {
            const parts = value.split(',');
            if (parts.length === 2) {
                overrides.minBasepeakIntensity = parseFloat(parts[0]);
                overrides.minTotalIonCurrent = parseFloat(parts[1]);
            }
            break;
        }
        case 'w':
            overrides.maxScanNumberDifference = parseFloat(value);
            break;
        case 'r':
            overrides.maxRTDifference = parseFloat(value);
            break;
        case 'p':
            overrides.maxPrecursorDifference = parseFloat(value);
            break;
        case 's':
            overrides.scaling = parseFloat(value);
            break;
        case 'n':
            overrides.noise = parseFloat(value);
            break;
        case 'd':
            overrides.metric = parseInt(value, 10);
            break;
        case 'q':
            overrides.qc = parseInt(value, 10);
            break;
        default:
            console.warn('Unknown command line flag: -' + flag);
    }
}

// Parse command line arguments supplied when launching the app.
// Flags mirror those of the compareMS2 binary (short and long forms):
//   -h  / --help                 print this help and exit
//   -W  / --scan-range           <first scan number>,<last scan number>
//   -R  / --rt-range             <first retention time>,<last retention time>
//   -c  / --cutoff               <score cutoff>
//   -o  / --output               <output basename>
//   -m  / --min-intensity        <min base peak intensity>,<min total ion current>
//   -w  / --max-scan-diff        <maximum scan number difference>
//   -r  / --max-rt-diff          <maximum retention time difference>
//   -p  / --max-precursor-diff   <maximum difference in precursor mass>
//   -s  / --scaling              <scaling power>
//   -n  / --noise                <noise threshold>
//   -d  / --metric               <distance metric (0, 1 or 2)>
//   -q  / --qc                   <QC measure (0)>
// Non-flag arguments that are existing .mgf files are treated as the first
// and second dataset filenames (at most 2). A non-flag argument that is an
// existing directory is treated as the mgfDir (at most 1).
function parseCommandLineArgs() {
    // In packaged apps argv[0] is the executable; in development argv[0] is
    // electron and argv[1] is the app path, so user args start at index 2.
    const rawArgs = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
    const overrides = {};
    const mgfFiles = [];

    // Maps long option names to their single-character equivalents.
    const longNameToShortFlag = {
        'scan-range': 'W',
        'rt-range': 'R',
        'cutoff': 'c',
        'output': 'o',
        'min-intensity': 'm',
        'max-scan-diff': 'w',
        'max-rt-diff': 'r',
        'max-precursor-diff': 'p',
        'scaling': 's',
        'noise': 'n',
        'metric': 'd',
        'qc': 'q',
    };

    let mgfDir = undefined;

    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];

        // Non-flag argument: treat as a positional MGF filename or directory.
        if (arg[0] !== '-') {
            let stat;
            try { stat = fs.statSync(arg); } catch (e) { stat = null; }
            if (stat && stat.isDirectory()) {
                if (mgfDir !== undefined) {
                    process.stderr.write('Error: more than one directory specified. At most 1 is allowed.\n');
                    process.exit(1);
                }
                mgfDir = arg;
            } else if (stat && stat.isFile() && arg.toLowerCase().endsWith('.mgf')) {
                mgfFiles.push(arg);
                if (mgfFiles.length > 2) {
                    process.stderr.write('Error: more than 2 MGF files specified. At most 2 are allowed.\n');
                    process.exit(1);
                }
            } else {
                process.stderr.write('Error: "' + arg + '" is not an existing .mgf file or directory.\n');
                process.exit(1);
            }
            continue;
        }

        if (arg.length < 2) continue;

        const flag = arg[1];

        // Long option: --name or --name=value
        if (flag === '-') {
            const longArg = arg.slice(2);
            if (longArg === 'help') {
                process.stdout.write(USAGE_STRING + '\n');
                process.exit(0);
            }
            const eqIdx = longArg.indexOf('=');
            let longKey, longVal;
            if (eqIdx !== -1) {
                longKey = longArg.slice(0, eqIdx);
                longVal = longArg.slice(eqIdx + 1);
            } else {
                longKey = longArg;
                i++;
                if (i >= rawArgs.length) {
                    process.stderr.write('Error: missing value for --' + longKey + '\n');
                    process.exit(1);
                }
                longVal = rawArgs[i];
            }

            const shortFlag = longNameToShortFlag[longKey];
            if (shortFlag) {
                applyFlag(shortFlag, longVal, overrides);
            }
            // Unknown long options (Electron internals etc.) are silently ignored.
            continue;
        }

        // -h prints usage and exits immediately (no value needed).
        if (flag === 'h') {
            process.stdout.write(USAGE_STRING + '\n');
            process.exit(0);
        }

        // Short option: -X or -Xvalue
        let value;
        if (arg.length > 2) {
            value = arg.slice(2);
        } else {
            i++;
            if (i >= rawArgs.length) break;
            value = rawArgs[i];
        }
        applyFlag(flag, value, overrides);
    }

    if (mgfFiles.length >= 1) overrides.mzFile1 = mgfFiles[0];
    if (mgfFiles.length >= 2) overrides.mzFile2 = mgfFiles[1];
    if (mgfDir !== undefined) overrides.mgfDir = mgfDir;

    return overrides;
}

// Apply CLI argument overrides to an options object.
// Also updates fileParams for file-related overrides so that
// updateOptionsToRenderer picks up the correct paths.
function applyCliArgsToOptions(options) {
    Object.assign(options, cliArgOverrides);
    if (cliArgOverrides.mgfDir !== undefined) {
        getSampleDirFiles(cliArgOverrides.mgfDir);
    }
    if (cliArgOverrides.mzFile1 !== undefined) {
        fileParams.file1 = cliArgOverrides.mzFile1;
        // Only derive mgfDir from the file if not explicitly specified
        if (cliArgOverrides.mgfDir === undefined) {
            getSampleDirFiles(path.dirname(cliArgOverrides.mzFile1));
        }
    }
    if (cliArgOverrides.mzFile2 !== undefined) {
        fileParams.file2 = cliArgOverrides.mzFile2;
    }
}

function updateSampleToSpeciesFile(dir, fileParams) {
    const s2sFnCheck = path.join(dir, "sample_to_species.txt");
    var s2sFn = fileParams.s2sFile;
    // Check if sample_to_species.txt exists
    try {
        fs.accessSync(s2sFnCheck, fs.constants.F_OK);
        if (!fileParams.sampleToSpeciesManuallySet) {
            // If the file exists and we don't have a s2sFile yet, set it
            s2sFn = s2sFnCheck;
        }
    }
    catch (err) {        // File does not exist, do nothing
    };
    return s2sFn;
}

