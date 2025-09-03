// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains common functions used by all parts of het main process.
const { process } = require('electron');
const log = require('electron-log');
const crypto = require('crypto');
const path = require('path');

// Global process tracking - using window.id as key since it's globally unique
let activeProcesses = new Map(); // Map<windowId, Set<childProcess>>

// Function to log messages to the web page and the Electron log
function llog(window, msg) {
    log.info(msg);
    // FIXME: Logging to the UI takes tremendous time, and is not very useful if here are no errors
    // So for now, we only log to the console
    //    safeWindowSend(window, 'logMessage', msg);
}

// Function to log error messages to the web page and the Electron log
function elog(window, msg) {
    log.error(msg);
    safeWindowSend(window, 'logError', msg);
}

// Function to send a message to the renderer process to set activity status
function setActivity(window, msg) {
    safeWindowSend(window, 'setActivity', msg);
}

/**
 * Safely send a message to a window, checking if it still exists
 */
function safeWindowSend(window, channel, ...args) {
    try {
        if (window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed()) {
            window.webContents.send(channel, ...args);
            return true;
        }
    } catch (error) {
        console.log(`Failed to send message to window: ${error.message}`);
    }
    return false;
}

/**
 * Check if a window is still valid and computation should continue
 */
function isWindowValid(window, instanceId = null) {
    return window &&
        !window.isDestroyed() &&
        window.webContents &&
        !window.webContents.isDestroyed() &&
        (instanceId === null || true); // instanceId check can be added by calling modules if needed
}

// Function to build the command line arguments for the compareMS2 executable
function buildCmdArgs(mgf1, mgf2, opts) {
    let cmdArgs =
        ['-A', mgf1,
            '-B', mgf2,
            '-p', opts.maxPrecursorDifference,
            '-m', opts.minBasepeakIntensity + ',' + opts.minTotalIonCurrent,
            '-w', opts.maxScanNumberDifference,
            '-W', opts.startScan + ',' + opts.endScan,
            '-r', opts.maxRTDifference,
            '-R', opts.startRT + ',' + opts.endRT,
            '-c', opts.cutoff,
            '-f', opts.specMetric,
            '-s', opts.scaling,
            '-n', opts.noise,
            '-q', opts.qc,
            '-d', opts.metric,
            '-N', opts.topN,
        ]
    // If opts.experimentalFeatures exists, add the experimental features flag
    if (opts.experimentalFeatures) {
        cmdArgs = cmdArgs.concat(['-x', opts.experimentalFeatures]);
    }
    return cmdArgs
}

function getHashName(cmdArgs, compareDir) {
    // Create a unique filename based on parameters
    const hashName = shortHashObj({ cmdArgs });
    const cmpFile = path.join(compareDir, hashName + '.txt');
    const cmpFileJSON = path.join(compareDir, hashName + '.json');
    return { cmpFile, cmpFileJSON, hashName };
}

// Return an hexadecimal hash from an object
// The hash is the first 24 (for brevity) hex characters
// of the SHA256 hash of the JSON representation of the object
function shortHashObj(obj) {
    const json = JSON.stringify(obj);
    let sha256 = crypto.createHash('sha256');
    let hex = sha256.update(json).digest('hex');
    return hex.substring(0, 24);
}

function getSystemMemoryInfo() {
    const meminfo = process.getSystemMemoryInfo();
    return {
        // meminfo is in KB, convert to GB
        total: meminfo.total / (1024 * 1024),
        free: meminfo.free / (1024 * 1024)
    };
}

function getCPUCount() {
    return require('os').cpus().length;
}

/**
 * Clean up all resources associated with a window when it's closed
 */
function cleanupWindowResources(windowId) {
    // Stop any running processes for this window
    if (activeProcesses.has(windowId)) {
        const processes = activeProcesses.get(windowId);
        processes.forEach(process => {
            if (process && !process.killed) {
                process.kill('SIGTERM');
            }
        });
        activeProcesses.delete(windowId);
    }
}

/**
 * Add a process to tracking for a specific window
 */
function addActiveProcess(windowId, process) {
    if (!activeProcesses.has(windowId)) {
        activeProcesses.set(windowId, new Set());
    }
    activeProcesses.get(windowId).add(process);
}

/**
 * Remove a process from tracking for a specific window
 */
function removeActiveProcess(windowId, process) {
    if (activeProcesses.has(windowId)) {
        activeProcesses.get(windowId).delete(process);
    }
}

exports.llog = llog;
exports.elog = elog;
exports.setActivity = setActivity;
exports.safeWindowSend = safeWindowSend;
exports.isWindowValid = isWindowValid;
exports.buildCmdArgs = buildCmdArgs;
exports.getHashName = getHashName;
exports.shortHashObj = shortHashObj;
exports.getSystemMemoryInfo = getSystemMemoryInfo;
exports.getCPUCount = getCPUCount;
exports.cleanupWindowResources = cleanupWindowResources;
exports.addActiveProcess = addActiveProcess;
exports.removeActiveProcess = removeActiveProcess;
