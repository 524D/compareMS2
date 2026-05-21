// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the heatmap functionality.
const { BrowserWindow, ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { llog, elog, setActivity, buildCmdArgs, getHashName, safeWindowSend, isWindowValid, cleanupWindowResources, addActiveProcess, removeActiveProcess, compareDirName, getLogFilePath } = require('./main-common.js');

var generalParams = null;

function initHeatMap(genParams) {
    generalParams = genParams;
}

function showHeatMapWindow(mainWindow, icon, params) {
    let heatmapWindow = new BrowserWindow({
        width: 1200,
        height: 950,
        minWidth: 720,
        minHeight: 480,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'heatmap-preload.js')
        },
        icon: icon,
    });

    heatmapWindow.on('closed', () => {
        cleanupWindowResources(heatmapWindow.id);
    });

    heatmapWindow.removeMenu();
    heatmapWindow.loadFile(path.join(__dirname, '/heatmap.html'));

    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        heatmapWindow.webContents.openDevTools();
    }

    heatmapWindow.show();
    // Wait for the window to be ready before running the comparison
    heatmapWindow.webContents.once('did-finish-load', () => {
        safeWindowSend(heatmapWindow, 'set-log-path', getLogFilePath());
        runHeatMap(heatmapWindow, params, convertResultToHeatmap);
    });
}

function runHeatMap(window, userparams, onFinishedFunc) {
    let mzFile1 = userparams.mzFile1;
    let mzFile2;
    let title;
    let yAxisLabel;

    // If mzFile2 is not specified, use mzFile1 for both (self-comparison)
    if (userparams.mzFile2) {
        mzFile2 = userparams.mzFile2;
    } else {
        mzFile2 = userparams.mzFile1;
    }

    if (mzFile1 == mzFile2) {
        var file1Base = path.basename(mzFile1);
        title = "Self comparison {a|(" + file1Base + ")}";
    } else {
        var file1Base = path.basename(mzFile1);
        var file2Base = path.basename(mzFile2);
        title = "Two dataset comparison {a|(" + file1Base + " vs " + file2Base + ")}";
    }

    if (userparams.specMetric == "0") {
        yAxisLabel = "MS2 similarity (dot product)";
    } else {
        yAxisLabel = "MS2 similarity (spectral angle)";
    }

    // compareMS2 executables need local filenames, so change default dir
    process.chdir(path.dirname(userparams.mzFile1));
    llog(window, 'Change default dir: "' + path.dirname(userparams.mzFile1) + '"\n');

    // Create directory for compare results
    const compareDir = path.join(path.dirname(userparams.mzFile1), compareDirName);
    if (!fs.existsSync(compareDir)) fs.mkdirSync(compareDir, { recursive: true });

    // The order of input files is not important for the result.
    // We always order alphabetical, so that the check if we
    // already have the result works correctly.
    if (mzFile1 > mzFile2) {
        [mzFile1, mzFile2] = [mzFile2, mzFile1];
    }

    // Convert parameters to command line arguments for the comparems2 executable
    userparams.experimentalFeatures = 1; // Enable experimental for heatmap output in JSON
    const cmdArgs = buildCmdArgs(mzFile1, mzFile2, userparams);
    // Get the hash name and compare file
    const { cmpFile, cmpFileJSON, hashName } = getHashName(cmdArgs, compareDir);

    // Check if the compare file already exists (JSON contains heatmap data)
    if (fs.existsSync(cmpFileJSON)) {
        llog(window, 'Compare file already exists: ' + cmpFileJSON);
        onFinishedFunc(window, cmpFileJSON, title, yAxisLabel, userparams);
        return;
    }

    // Temporary output filename of compare ms2
    // used to avoid stale incomplete output after interrupt
    const comparems2tmp = path.join(compareDir, hashName + "-" + window.id + "-" + Date.now() + ".tmp");
    const comparems2tmpJSON = comparems2tmp + '.json';
    // Append output filename, should not be part of hash
    const cmdArgsWithOutput = [...cmdArgs, '-o', comparems2tmp, '-J', comparems2tmpJSON,];

    const compareMS2exe = generalParams.compareMS2Exe;
    // Properly quote the command line arguments so that we can paste in in a terminal window
    const quotedCompareArgs = cmdArgsWithOutput.map(arg => {
        // Convert non-string arguments to string
        if (typeof arg !== 'string') {
            arg = String(arg);
        } else if (arg.includes(' ')) {
            return `"${arg}"`;
        }
        return arg;
    });

    //    let cmdStr = compareMS2exe + JSON.stringify(cmdArgsWithOutput);
    let cmdStr = compareMS2exe + ' ' + quotedCompareArgs.join(' ');
    llog(window, 'Executing: ' + cmdStr + '\n');

    const cmp_ms2 = spawn(compareMS2exe, cmdArgsWithOutput);

    // Track this process
    addActiveProcess(window.id, cmp_ms2);

    cmp_ms2.stdout.on('data', (data) => {
        llog(window, data.toString());
    });

    cmp_ms2.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        elog(window, data.toString());
    });

    cmp_ms2.on('error', (data) => {
        // Remove from tracking
        removeActiveProcess(window.id, cmp_ms2);
        hideLoading(window);
        elog(window, 'Error running compareMS2');
        setActivity(window, 'Error running compareMS2');
    });

    cmp_ms2.stderr.on('exit', (code, signal) => {
        // Remove from tracking
        removeActiveProcess(window.id, cmp_ms2);
        hideLoading(window);
        elog(window, 'Error running compareMS2');
        setActivity(window, 'Error running compareMS2');
    });

    cmp_ms2.on('close', (code, signal) => {
        // Remove from tracking
        removeActiveProcess(window.id, cmp_ms2);

        if (isWindowValid(window)) {
            hideLoading(window);
        }

        if (!isWindowValid(window)) {
            return; // Don't continue if window is closed
        }

        if (code == null) {
            elog(window, "Error: comparems2 command line executable crashed (signal 0x" + signal.toString(16) + ")\n")
            setActivity(window, "Error: comparems2 command line executable crashed (signal 0x" + signal.toString(16) + ")\n")
        } else {
            if (code != 0) {
                elog(window, "Error: comparems2 command line exited with error code " + code.toString(16), "\n")
                setActivity(window, "Error: comparems2 command line exited with error code " + code.toString(16), "\n")
            } else {
                // Compare finished, rename temporary output files
                // to final filenames
                fs.rename(comparems2tmpJSON, cmpFileJSON, function (err) {
                    if (err) throw err
                    // Rename the text file
                    fs.rename(comparems2tmp, cmpFile, function (err) {
                        if (err) throw err
                    });
                    // Call the onFinishedFunc with the results
                    if (isWindowValid(window)) {
                        onFinishedFunc(window, cmpFileJSON, title, yAxisLabel, userparams);
                    }
                });
            }
        }
    });
}

// Convert the massDiffDotProdHistogram from the JSON data into the format required by heatmap
function convertDataFromJSON(jsonData) {
    let xData = [];
    let yData = [];
    let data = [];
    const histogram = jsonData.massDiffDotProdHistogram;
    const counts = histogram.count;
    const mzRange = histogram.mzRange;
    const mzMin = mzRange[0];
    const mzMax = mzRange[1];
    const xRange = mzMax - mzMin;

    // Create the data for the axis
    const il = counts.length;
    for (let i = 0; i < il; i++) {
        const x = (xRange * i) / il + mzMin;
        xData.push(x);
    }
    const jl = counts[0].length;
    //  The first half are bins for negative dot products, normally all zero -> don't show
    const js = Math.floor(jl / 2);
    for (let j = js; j < jl; j++) {
        y = j - js;
        yData.push(y);
    }

    // Extract the actual data
    // Determine number of columns
    // We assume that all rows have the same number of columns, so we can just look at the first row
    let maxVal = 0;

    for (let i = 0; i < il; i++) {
        const row = counts[i];
        const jl = row.length;
        //  The first half are bins for negative dot products, normally all zero -> don't show
        const js = Math.floor(jl / 2);
        for (let j = js; j < jl; j++) {
            const item = Math.log(row[j]);
            maxVal = Math.max(maxVal, item);
            // const x=(xRange*i)/il + mzMin;
            data.push({ value: [i, j - js, item] });
        }
    }
    return [data, xData, yData, maxVal, mzMin, mzMax];
}

function convertResultToHeatmap(window, cmpFileJSON, title, yAxisLabel, params) {
    // Read and parse the JSON file
    const jsonData = JSON.parse(fs.readFileSync(cmpFileJSON, 'utf8'));
    [data, xData, yData, maxVal, mzMin, mzMax] = convertDataFromJSON(jsonData)
    var chartContent = {
        title: title,
        yAxisLabel: yAxisLabel,
        data: data,
        xMin: mzMin,
        xMax: mzMax,
        xData: xData,
        yData: yData,
        realYMin: 0.0,
        maxVal: maxVal,
        compareDir: params.compareDir,
        mzFile1: params.mzFile1,
        s2sFile: params.s2sFile
    }
    safeWindowSend(window, 'updateChart', chartContent);
}

function hideLoading(window) {
    safeWindowSend(window, 'hideLoading');
}

exports.showHeatMapWindow = showHeatMapWindow;
exports.initHeatMap = initHeatMap;
