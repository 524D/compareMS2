// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.
const { contextBridge, ipcRenderer } = require('electron/renderer')

// The following part handles message from the main process that only directly
// update the main window items.
// We don't use the contextBridge here to keep the code simple
window.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.on('show-about', (event) => {
        document.getElementById('about').style.display = 'block';
    });
    ipcRenderer.on('selected-speciesfile', (event, p) => {
        var fn = `${p}`;
        document.getElementById("s2sfile").value = fn;
    })
    ipcRenderer.on('selected-directory', (event, p) => {
        var mgfDirFull = p;
        const fn = mgfDirFull.dir;
        document.getElementById("mgfdir").value = fn;
    })
    ipcRenderer.on('selected-file1', (event, p) => {
        var fn = `${p}`;
        document.getElementById("file1").value = fn;
    })
    ipcRenderer.on('selected-file2', (event, p) => {
        var fn = `${p}`;
        document.getElementById("file2").value = fn;
    })
    ipcRenderer.on('show-alert', (event, type, text) => {
        const modal = document.getElementById('alert-modal');
        const title = document.getElementById('alert-modal-title');
        const msg = document.getElementById('alert-modal-text');
        if (type === 'error') {
            title.textContent = 'Error';
            title.className = 'alert-error';
        }
        else {
            title.textContent = 'Warning';
            title.className = 'alert-warning';
        }
        msg.textContent = text;
        modal.style.display = 'block';
    })
})

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
})