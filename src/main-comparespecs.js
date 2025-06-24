// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let specWindows = [];
let specParams = [];
let specInstanceCount = 0;

var generalParams = null;

function initCompareSpecs(genParams) {
    generalParams = genParams;

    ipcMain.on('phyltree-stop', (event, p) => {
    })

    ipcMain.on('phyltree-pause', (event, p) => {
    })

    ipcMain.on('phyltree-continue', (event, p) => {
    })
}

function showCompareSpecsWindow(mainWindow, icon, params) {
    let specWindow = new BrowserWindow({
        width: 1200,
        height: 950,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: false,  // without this, we can't open new windows
            preload: path.join(__dirname, 'heatmap-preload.js')
        },
        icon: icon,
    });
    specInstanceCount++;
    specWindows[specInstanceCount] = specWindow;
    specParams[specInstanceCount] = params;
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
}

exports.showCompareSpecsWindow = showCompareSpecsWindow;
exports.initCompareSpecs = initCompareSpecs;
