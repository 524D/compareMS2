// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// FIXME: enable context isolation by implementing all relevant functions in preload.js and
//  uncommenting below

// const { contextBridge, ipcRenderer } = require('electron/renderer')

// // Expose protected methods that allow the renderer process to use
// // FIXME: All communication with the main process should be done this way
// contextBridge.exposeInMainWorld('electronAPI', {
//     storeImage: (imgFmt, imageData, instanceId) => ipcRenderer.send('store-image', imgFmt, imageData, instanceId)
// })

window.addEventListener('DOMContentLoaded', () => {
})
