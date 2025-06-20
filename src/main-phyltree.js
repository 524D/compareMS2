// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let treeWindows = [];
let treeParams = [];
let treeInstanceCount = 0;

var generalParams = null;

function initPhylTree(genParams) {
    generalParams = genParams;
    ipcMain.on('phyltree-stop', (event, p) => {
    })

    ipcMain.on('phyltree-pause', (event, p) => {
    })

    ipcMain.on('phyltree-continue', (event, p) => {
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
}

function showPhylTreeWindow(mainWindow, icon, params) {
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
        icon: icon,
    });
    treeInstanceCount++;
    treeWindows[treeInstanceCount] = treeWindow;
    treeParams[treeInstanceCount] = params;
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
}

exports.showPhylTreeWindow = showPhylTreeWindow;
exports.initPhylTree = initPhylTree;
