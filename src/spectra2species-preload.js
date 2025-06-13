// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

const { contextBridge, ipcRenderer } = require('electron')

// These are used to communicate with the main process from the Spectra2Species BrowserWindow.
// E.g. Use window.s2sAPI.stop() to send a 'stop' message to the main process.
contextBridge.exposeInMainWorld(
    's2sAPI',
    {
        stop: () => ipcRenderer.send('s2s-stop'),
        pause: () => ipcRenderer.send('s2s-pause'),
        continue: () => ipcRenderer.send('s2s-continue'),
        updateEchartJSON: (callback) => ipcRenderer.on('updateEchartJSON', (_event, value) => callback(value)),
    }
)

