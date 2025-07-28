// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the heatmap functionality.
const { BrowserWindow, ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { llog, elog, setActivity, buildCmdArgs, getHashName } = require('./main-common.js');

const compareDirName = 'compareresult'; // Directory where the compare results are stored relative to the mgfDir

const xMin = -1.6;
const xMax = +1.6;
const yMin = 0.0;
const yMax = +100.0;

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

    heatmapWindow.removeMenu();
    heatmapWindow.loadFile(path.join(__dirname, '/heatmap.html'));

    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        heatmapWindow.webContents.openDevTools();
    }

    heatmapWindow.show();
    // Wait for the window to be ready before running the comparison
    heatmapWindow.webContents.once('did-finish-load', () => {
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
    userparams.experimentalFeatures = 1; // Enable experimental for heatmap output
    const cmdArgs = buildCmdArgs(mzFile1, mzFile2, userparams);
    // Get the hash name and compare file
    const { cmpFile, cmpFileJSON, hashName } = getHashName(cmdArgs, compareDir);

    // Insert -x before extenson of cmpFile name for experimental features
    const cmpFileExpFeatures = cmpFile.replace(/\.txt$/, "-x.txt");

    // Check if the compare file already exists
    if (fs.existsSync(cmpFileExpFeatures)) {
        llog(window, 'Compare file already exists: ' + cmpFileExpFeatures);
        onFinishedFunc(window, cmpFileExpFeatures, title, yAxisLabel, userparams);
        return;
    }

    // Temporary output filename of compare ms2
    // used to avoid stale incomplete output after interrupt
    const comparems2tmp = path.join(compareDir, hashName + "-" + window.id + "-" + Date.now() + ".tmp");
    const comparems2tmpJSON = comparems2tmp + '.json';
    // "Experimental features"=output heatmap data
    const comparems2tmpX = path.join(compareDir, hashName + "-" + window.id + "-" + Date.now() + "-x.tmp");
    // Append output filename, should not be part of hash
    const cmdArgsWithOutput = [...cmdArgs, '-o', comparems2tmp, '-X', comparems2tmpX, '-J', comparems2tmpJSON,];

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

    cmp_ms2.stdout.on('data', (data) => {
        llog(window, data.toString());
    });

    cmp_ms2.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        elog(window, data.toString());
    });

    cmp_ms2.on('error', (data) => {
        hideLoading(window);
        elog(window, 'Error running compareMS2');
        setActivity(window, 'Error running compareMS2');
    });

    cmp_ms2.stderr.on('exit', (code, signal) => {
        hideLoading(window);
        elog(window, 'Error running compareMS2');
        setActivity(window, 'Error running compareMS2');
    });

    cmp_ms2.on('close', (code, signal) => {
        hideLoading(window);
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
                fs.rename(comparems2tmpX, cmpFileExpFeatures, function (err) {
                    if (err) throw err
                    // Rename the JSON file
                    fs.rename(comparems2tmpJSON, cmpFileJSON, function (err) {
                        if (err) throw err
                        // Rename the text file
                        fs.rename(comparems2tmp, cmpFile, function (err) {
                            if (err) throw err
                        });
                    });
                    // Call the onFinishedFunc with the results
                    onFinishedFunc(window, cmpFileExpFeatures, title, yAxisLabel, userparams);
                });
            }
        }
    });
}

// Convert the TAB delimited data in tabData into the format required by heatmap
function convertData(tabData) {
    let xData = [];
    let yData = [];
    let data = [];
    let lines = tabData.split('\n');
    const yRange = yMax - yMin;
    const xRange = xMax - xMin;
    // Remove empty lines

    lines = lines.filter(function (line) {
        return line.trim() !== '';
    });

    // We ignore lines at the start that are all zeros
    const il = lines.length;
    let i;
    for (i = 0; i < il; i++) {
        let line = lines[i];
        let items = line.split('\t');
        if (!(items.every(item => item == 0))) {
            // Leave the loop when we find the first non-zero line
            break;
        }
    }

    const realYmin = (yRange * i) / il + yMin;

    // i is now the index of the first non-zero line
    // We use the first non-zero row to determine the number of columns
    let items = lines[i].split('\t');
    const jl = items.length;
    for (let j = 0; j < jl; j++) {
        const x = (xRange * j) / jl + xMin;
        xData.push(x);
    }

    // Extract the actual data
    let maxVal = 0;
    let y = 0;
    for (; i < il; i++) {
        let line = lines[i];
        let items = line.split('\t');
        const jl = items.length;

        // const y = (yRange*i)/il+yMin;
        yData.push(y);

        for (let j = 0; j < jl; j++) {
            let item = items[j];
            item = Math.log(item);
            maxVal = Math.max(maxVal, parseFloat(item));
            const x = j; // x here is just the index, not the actual value
            // const x=(xRange*j)/jl + xMin
            data.push({ value: [x, y, parseFloat(item)] });
        }
        y++;

    }
    return [data, xData, yData, realYmin, maxVal];
}

function convertResultToHeatmap(window, cmpFile, title, yAxisLabel, params) {
    // Read cmpFile into tabData
    let tabData = fs.readFileSync(cmpFile, 'utf8');
    [data, xData, yData, realYMin, maxVal] = convertData(tabData)
    var chartContent = {
        title: title,
        yAxisLabel: yAxisLabel,
        data: data,
        xMin: xMin,
        xMax: xMax,
        xData: xData,
        yData: yData,
        realYMin: realYMin,
        maxVal: maxVal,
        compareDir: params.compareDir,
        mzFile1: params.mzFile1,
        s2sFile: params.s2sFile
    }
    window.webContents.send('updateChart', chartContent);
}

function hideLoading(window) {
    if (window) {
        window.webContents.send('hideLoading');
    }
}

exports.showHeatMapWindow = showHeatMapWindow;
exports.initHeatMap = initHeatMap;
