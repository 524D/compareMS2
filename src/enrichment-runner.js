// SPDX-License-Identifier: MIT
// Coalesced worker_threads runner for off-thread Fisher's Exact Test library enrichment.

const path = require('path');
const { Worker } = require('worker_threads');

const DEFAULT_WORKER_PATH = path.join(__dirname, 'enrichment-worker.js');

/**
 * Creates a persistent worker runner that coalesces rapid streaming snapshots
 * via schedule(items) and resolves exact final snapshots via computeFinal(items).
 * @param {object} [options]
 * @param {string} [options.workerPath]
 * @param {(result: any[]) => void} [options.onResult]
 * @param {(err: Error) => void} [options.onError]
 */
function createEnrichmentRunner(options = {}) {
    const workerPath = options.workerPath || DEFAULT_WORKER_PATH;
    const onResult = typeof options.onResult === 'function' ? options.onResult : null;
    const onError = typeof options.onError === 'function' ? options.onError : null;

    let worker = null;
    let terminated = false;
    let inFlight = false;
    let nextId = 0;
    let dispatches = 0;
    let latestScheduledItems = null;
    const finalQueue = [];
    const finalResolvers = new Map();

    function rejectAllPendingFinals(err) {
        while (finalQueue.length > 0) {
            const entry = finalQueue.shift();
            entry.reject(err);
        }
        for (const [id, resolver] of finalResolvers.entries()) {
            finalResolvers.delete(id);
            resolver.reject(err);
        }
    }

    function ensureWorker() {
        if (worker || terminated) {
            return worker;
        }
        worker = new Worker(workerPath);
        worker.on('message', (msg) => {
            inFlight = false;
            const id = msg && msg.id;
            const resolver = finalResolvers.get(id);
            if (resolver) {
                finalResolvers.delete(id);
                if (msg && msg.error) {
                    resolver.reject(new Error(msg.error));
                } else {
                    resolver.resolve(msg ? msg.result : []);
                }
            } else if (!terminated) {
                if (msg && msg.error) {
                    if (onError) onError(new Error(msg.error));
                } else if (latestScheduledItems === null && finalQueue.length === 0 && onResult) {
                    onResult(msg ? msg.result : []);
                }
            }
            pump();
        });
        worker.on('error', (err) => {
            inFlight = false;
            const currentWorker = worker;
            worker = null;
            rejectAllPendingFinals(err);
            if (!terminated && onError) {
                onError(err);
            }
            if (currentWorker) {
                currentWorker.terminate().catch(() => {});
            }
        });
        worker.on('exit', (code) => {
            const wasInFlight = inFlight;
            inFlight = false;
            worker = null;
            if (!terminated && (wasInFlight || finalQueue.length > 0 || finalResolvers.size > 0)) {
                const err = new Error(`Enrichment worker exited unexpectedly with code ${code}`);
                rejectAllPendingFinals(err);
                if (onError) {
                    onError(err);
                }
            }
        });
        return worker;
    }

    function pump() {
        if (terminated || inFlight) {
            return;
        }
        if (finalQueue.length > 0) {
            const entry = finalQueue.shift();
            const w = ensureWorker();
            if (!w) {
                entry.reject(new Error('Enrichment runner terminated'));
                return;
            }
            const id = ++nextId;
            dispatches++;
            inFlight = true;
            finalResolvers.set(id, { resolve: entry.resolve, reject: entry.reject });
            w.postMessage({ id, items: entry.items });
            return;
        }
        if (latestScheduledItems !== null) {
            const items = latestScheduledItems;
            latestScheduledItems = null;
            const w = ensureWorker();
            if (!w) {
                return;
            }
            const id = ++nextId;
            dispatches++;
            inFlight = true;
            w.postMessage({ id, items });
        }
    }

    function schedule(items) {
        if (terminated || !Array.isArray(items) || items.length === 0) {
            return;
        }
        latestScheduledItems = items;
        pump();
    }

    function computeFinal(items) {
        if (terminated) {
            return Promise.reject(new Error('Enrichment runner terminated'));
        }
        latestScheduledItems = null;
        return new Promise((resolve, reject) => {
            finalQueue.push({ items, resolve, reject });
            pump();
        });
    }

    async function terminate() {
        if (terminated) {
            return;
        }
        terminated = true;
        latestScheduledItems = null;
        rejectAllPendingFinals(new Error('Enrichment runner terminated'));
        if (worker) {
            const w = worker;
            worker = null;
            await w.terminate();
        }
    }

    return {
        schedule,
        computeFinal,
        terminate,
        getStats: () => ({ dispatches }),
    };
}

module.exports = {
    createEnrichmentRunner,
};
