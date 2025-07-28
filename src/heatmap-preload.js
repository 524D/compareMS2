// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

const { contextBridge, ipcRenderer } = require('electron')

// These are used to communicate with the main process from the Spectra2Species BrowserWindow.
// E.g. Use window.s2sAPI.stop() to send a 'stop' message to the main process.
contextBridge.exposeInMainWorld(
    'heatmapAPI',
    {
        storeImage: (defaultName, format, data) => ipcRenderer.send('store-image-v2', defaultName, format, data),
        updateChart: (callback) => ipcRenderer.on('updateChart', (_event, chartContent) => callback(chartContent)),
        onLogMessage: (callback) => ipcRenderer.on('logMessage', (_event, message) => callback(message)),
        onLogError: (callback) => ipcRenderer.on('logError', (_event, message) => callback(message)),
        onSetActivity: (callback) => ipcRenderer.on('setActivity', (_event, message) => callback(message)),
        onHideLoading: (callback) => ipcRenderer.on('hideLoading', (_event) => callback()),
        toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
    }
);
