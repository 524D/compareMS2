// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('treeAPI', {

    // Toggle fullscreen
    toggleFullscreen: () => ipcRenderer.send('tree-toggle-fullscreen'),

    // Download image
    downloadImage: (imageType, svgData, filename) => ipcRenderer.send('tree-download-image', imageType, svgData, filename),

    // Event listeners for updates from main process
    onProgressUpdate: (callback) => ipcRenderer.on('progress-update', callback),
    onActivityUpdate: (callback) => ipcRenderer.on('setActivity', callback),
    onLogMessage: (callback) => ipcRenderer.on('logMessage', callback),
    onLogError: (callback) => ipcRenderer.on('logError', callback),
    onTreeData: (callback) => ipcRenderer.on('treeData', callback),
    onError: (callback) => ipcRenderer.on('tree-error', callback),

    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

    // Notify the main process that the tree renderer is fully initialized
    notifyReady: () => ipcRenderer.send('tree-ready'),

});

