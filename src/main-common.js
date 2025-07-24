// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains common functions used by all parts of het main process.
const { process } = require('electron');
const log = require('electron-log');
const crypto = require('crypto');
const path = require('path');

// Function to log messages to the web page and the Electron log
function llog(window, msg) {
    log.info(msg);
    window.webContents.send('logMessage', msg);
}

// Function to log error messages to the web page and the Electron log
function elog(window, msg) {
    log.error(msg);
    window.webContents.send('logError', msg);
}

// Function to send a message to the renderer process to set activity status
function setActivity(window, msg) {
    window.webContents.send('setActivity', msg);
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

exports.llog = llog;
exports.elog = elog;
exports.setActivity = setActivity;
exports.buildCmdArgs = buildCmdArgs;
exports.getHashName = getHashName;
exports.shortHashObj = shortHashObj;
exports.getSystemMemoryInfo = getSystemMemoryInfo;
exports.getCPUCount = getCPUCount;
