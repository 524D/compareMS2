// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.
const { contextBridge, ipcRenderer } = require('electron/renderer')

// Expose protected methods that allow the renderer process to use
contextBridge.exposeInMainWorld('electronAPI', {
    requestOptions: () => ipcRenderer.send('request-options'),
    storeOptions: (options) => ipcRenderer.send('store-options', options),
    mainGuiAction: (action) => ipcRenderer.send('main-gui-action', action),
    openSourceCodeInBrowser: () => ipcRenderer.send('openSourceCodeInBrowser'),
    startComparison: (mode, params) => ipcRenderer.send('start-comparison', mode, params),
    // Handle messages from main process
    onSaveOptions: (callback) => ipcRenderer.on('save-options', (_event) => callback()),
    onUpdateOptions: (callback) => ipcRenderer.on('update-options', (_event, options) => callback(options)),
    onUpdateMainWindowItems: (callback) => ipcRenderer.on('update-main-window-items', (_event, value) => callback(value)),
    onShowAbout: (callback) => ipcRenderer.on('show-about', (_event) => callback()),
    onSelectedSpeciesFile: (callback) => ipcRenderer.on('selected-speciesfile', (_event, p) => callback(p)),
    onSelectedDirectory: (callback) => ipcRenderer.on('selected-directory', (_event, p) => callback(p)),
    onSelectedFile1: (callback) => ipcRenderer.on('selected-file1', (_event, p) => callback(p)),
    onSelectedFile2: (callback) => ipcRenderer.on('selected-file2', (_event, p) => callback(p)),
    onShowAlert: (callback) => ipcRenderer.on('show-alert', (_event, type, text) => callback(type, text)),
})