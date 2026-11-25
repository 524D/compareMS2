// SPDX-License-Identifier: MIT
// Worker thread running Fisher's Exact Test library enrichment off Electron's main thread.

const { parentPort } = require('worker_threads');
const { computeLibraryEnrichment } = require('./enrichment.js');

if (parentPort) {
    parentPort.on('message', (msg) => {
        const { id, items } = msg || {};
        try {
            const result = computeLibraryEnrichment(items);
            parentPort.postMessage({ id, result });
        } catch (err) {
            parentPort.postMessage({
                id,
                error: err && err.message ? err.message : String(err),
            });
        }
    });
}
