// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains common functions used by all parts of het main process.
const { process } = require('electron');
const log = require('electron-log');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// The subdirectory (relative to the MGF directory) where comparison results are cached
const compareDirName = 'compareresult';

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
 * Convert a compareMS2 txt output file to JSON format and write it to disk.
 * The txt file uses tab-separated key/value pairs; histogram lines encode the
 * dot-product distribution. Fields that have no equivalent in the txt format
 * (commandLine) are set to an empty string.
 * @param {string} txtFilePath  - Path to the input .txt file
 * @param {string} jsonFilePath - Path to write the output .json file
 * @returns {object} The parsed result object
 */
function convertTxtToJson(txtFilePath, jsonFilePath) {
    const content = fs.readFileSync(txtFilePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

    const result = {
        commandLine: '',
        convertedFromTxt: true,
        datasetA: '',
        datasetB: '',
        setDistance: 0,
        setMetric: 0,
        scanRange: [0, 0],
        maxScanDiff: 0,
        maxMzDiff: 0,
        scalingPower: 0,
        noiseThreshold: 0,
        minBasepeakIntensity: 0,
        minTotalIonCurrent: 0,
        datasetAQC: 0,
        datasetBQC: 0,
        nrGtCutoff: 0,
        nrComparisons: 0,
        minPeaks: 0,
        maxPeaks: 0,
        mzRange: [0, 0],
        mzBinSize: 0,
        nrMzBins: 0,
        dotProdHistogram: {
            nrBins: 0,
            dotProdRange: [0, 0],
            count: []
        }
    };

    const histogramEntries = [];

    for (const line of lines) {
        const parts = line.split('\t');
        const key = parts[0];
        switch (key) {
            case 'dataset_A': result.datasetA = parts[1]; break;
            case 'dataset_B': result.datasetB = parts[1]; break;
            case 'set_distance': result.setDistance = parseFloat(parts[1]); break;
            case 'set_metric': result.setMetric = parseInt(parts[1]); break;
            case 'scan_range': result.scanRange = [parseInt(parts[1]), parseInt(parts[2])]; break;
            case 'max_scan_diff': result.maxScanDiff = parseFloat(parts[1]); break;
            case 'max_m/z_diff': result.maxMzDiff = parseFloat(parts[1]); break;
            case 'scaling_power': result.scalingPower = parseFloat(parts[1]); break;
            case 'noise_threshold': result.noiseThreshold = parseFloat(parts[1]); break;
            case 'min_basepeak_intensity': result.minBasepeakIntensity = parseFloat(parts[1]); break;
            case 'min_total_ion_current': result.minTotalIonCurrent = parseFloat(parts[1]); break;
            case 'dataset_A_QC': result.datasetAQC = parseFloat(parts[1]); break;
            case 'dataset_B_QC': result.datasetBQC = parseFloat(parts[1]); break;
            case 'n_gt_cutoff': result.nrGtCutoff = parseInt(parts[1]); break;
            case 'n_comparisons': result.nrComparisons = parseInt(parts[1]); break;
            case 'min_peaks': result.minPeaks = parseInt(parts[1]); break;
            case 'max_peaks': result.maxPeaks = parseInt(parts[1]); break;
            case 'm/z_range': result.mzRange = [parseFloat(parts[1]), parseFloat(parts[2])]; break;
            case 'm/z_bin_size': result.mzBinSize = parseFloat(parts[1]); break;
            case 'n_m/z_bins': result.nrMzBins = parseInt(parts[1]); break;
            case 'histogram':
                // Format: histogram\tlo\thi\tmid\tcount\t[second_count]
                histogramEntries.push({
                    lo: parseFloat(parts[1]),
                    hi: parseFloat(parts[2]),
                    count: parseInt(parts[4])
                });
                break;
        }
    }

    if (histogramEntries.length > 0) {
        result.dotProdHistogram.nrBins = histogramEntries.length;
        result.dotProdHistogram.dotProdRange = [
            histogramEntries[0].lo,
            histogramEntries[histogramEntries.length - 1].hi
        ];
        result.dotProdHistogram.count = histogramEntries.map(e => e.count);
    }

    fs.writeFileSync(jsonFilePath, JSON.stringify(result, null, '\t'));
    return result;
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
exports.compareDirName = compareDirName;
exports.convertTxtToJson = convertTxtToJson;
