// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain, app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const lineReader = require('line-reader');
const { llog, elog, setActivity, buildCmdArgs, getHashName } = require('./main-common.js');
const { UPGMA } = require('./upgma.js');

const compareDirName = 'compareresult';

let computationStates = new Map(); // Track computation state for each instance

var generalParams = null;

function initPhylTree(genParams) {
    generalParams = genParams;

    // Handle tree computation requests
    ipcMain.on('tree-pause-computation', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        pauseComputation(window.id);
    });

    ipcMain.on('tree-resume-computation', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        resumeComputation(window.id);
    });


    // FIXME: This should be handled by the main process
    ipcMain.on('tree-download-image', async (event, imageType, svgData, filename) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showSaveDialog(window, {
            title: 'Save phylotree image',
            defaultPath: filename,
            filters: imageType === 'svg'
                ? [{ name: 'SVG files', extensions: ['svg'] }]
                : [{ name: 'PNG files', extensions: ['png'] }]
        });

        if (!result.canceled) {
            fs.writeFileSync(result.filePath, svgData);
        }
    });

}

function showPhylTreeWindow(mainWindow, icon, params) {
    let phyltreeWindow = new BrowserWindow({
        width: 1200,
        height: 950,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'tree-preload.js')
        },
        icon: icon,
    });

    computationStates.set(phyltreeWindow.id, {
        paused: false,
        file1Idx: 1,
        file2Idx: 0,
        mgfFiles: [],
        compareDir: '',
        compResultListFile: '',
        newick: '',
        topology: ''
    });

    // On window close, remove from maps
    phyltreeWindow.on('close', () => {
        computationStates.delete(phyltreeWindow.id);
    });

    phyltreeWindow.removeMenu();
    phyltreeWindow.loadFile(path.join(__dirname, '/tree.html'));

    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        phyltreeWindow.webContents.openDevTools();
    }

    phyltreeWindow.show();
    // Wait for the window to be ready before running the comparison
    phyltreeWindow.webContents.once('did-finish-load', () => {
        runTreeComparison(phyltreeWindow, phyltreeWindow.id, params);
    });
}

function runTreeComparison(window, instanceId, params) {
    const state = computationStates.get(instanceId);

    if (!state || !window) return false;

    // Initialize computation state

    state.mgfFiles = params.sampleDir.mgfFilesFull || [];
    sortFiles(state.mgfFiles, params.compareOrder);

    // Create compare directory
    state.compareDir = path.join(params.mgfDir, compareDirName);
    if (!fs.existsSync(state.compareDir)) {
        fs.mkdirSync(state.compareDir, { recursive: true });
    }

    // Create comparison list file
    state.compResultListFile = path.join(params.mgfDir, `cmp_list-${instanceId}.txt`);
    fs.closeSync(fs.openSync(state.compResultListFile, 'w'));
    computationStates.set(instanceId, state);

    // Start comparison
    compareNext(window, instanceId, params);
    return true;
}

function compareNext(window, instanceId, params) {
    const state = computationStates.get(instanceId);
    const compareMS2exe = generalParams.compareMS2Exe;


    if (!state || !window || state.paused) return;

    // Update progress
    const nMgf = state.mgfFiles.length;
    const progress = ((state.file1Idx * (state.file1Idx - 1) / 2) + state.file2Idx) / (nMgf * (nMgf - 1) / 2);
    window.webContents.send('progress-update', progress * 100);

    if (state.file1Idx >= state.mgfFiles.length) {
        // Computation finished
        finishComputation(window, instanceId, params);
        return;
    }

    // Send activity update
    const activity = `Comparing ${state.mgfFiles[state.file1Idx]} ${state.mgfFiles[state.file2Idx]}`;
    setActivity(window, activity);

    let mgf1 = state.mgfFiles[state.file1Idx];
    let mgf2 = state.mgfFiles[state.file2Idx];

    // Order alphabetically for consistent hashing
    if (mgf1 > mgf2) {
        [mgf1, mgf2] = [mgf2, mgf1];
    }

    const cmdArgs = buildCmdArgs(mgf1, mgf2, params);
    const { cmpFile, hashName } = getHashName(cmdArgs, state.compareDir);
    const comparems2tmp = path.join(state.compareDir, `${hashName}-${instanceId}.tmp`);

    cmdArgs.push('-o', comparems2tmp);

    // Check if result already exists
    if (fs.existsSync(cmpFile)) {
        compareFinished(window, instanceId, params, cmpFile);
        return;
    }

    // Run comparison
    const cmp_ms2 = spawn(compareMS2exe, cmdArgs);

    cmp_ms2.stdout.on('data', (data) => {
        llog(window, data.toString());
    });

    cmp_ms2.stderr.on('data', (data) => {
        elog(window, data.toString());
    });

    cmp_ms2.on('error', () => {
        elog(window, 'Error running compareMS2');
        setActivity(window, 'Error running compareMS2');
    });

    cmp_ms2.on('close', (code) => {
        if (code === 0) {
            fs.rename(comparems2tmp, cmpFile, (err) => {
                if (err) throw err;
                compareFinished(window, instanceId, params, cmpFile);
            });
        } else {
            elog(window, `compareMS2 exited with code ${code}`);
        }
    });
}

function compareFinished(window, instanceId, params, cmpFile) {
    const state = computationStates.get(instanceId);

    fs.appendFileSync(state.compResultListFile, cmpFile + "\n");
    state.file2Idx++;
    computationStates.set(instanceId, state);


    if (state.file2Idx < state.file1Idx) {
        // Continue with next comparison
        setTimeout(() => compareNext(window, instanceId, params), 0);
    } else {
        // Row finished, create tree
        makeTree(window, instanceId, params);
    }
}

function makeTree(window, instanceId, params) {
    const state = computationStates.get(instanceId);
    const compToDistExe = generalParams.compToDistExe;


    setActivity(window, 'Creating tree');

    const dfArg = path.join(params.mgfDir, params.outBasename) + `-${instanceId}`;
    const df = dfArg + "_distance_matrix.meg";

    const cmdArgs = [
        '-i', state.compResultListFile,
        '-o', dfArg,
        '-c', params.cutoff,
        '-m'
    ];
    if (fs.existsSync(params.s2sFile)) {
        cmdArgs.push('-x', params.s2sFile);
    }
    llog(window, `Running ${compToDistExe} with args: ${cmdArgs.join(' ')}`);
    const c2d = spawn(compToDistExe, cmdArgs);
    c2d.stdout.on('data', (data) => {
        llog(window, data.toString());
    });
    c2d.stderr.on('data', (data) => {
        elog(window, data.toString());
    });
    c2d.on('close', (code) => {
        if (code === 0) {
            parseDistanceMatrix(window, instanceId, params, df);
        } else {
            elog(window, `${compToDistExe} exited with code 0x${code.toString(16)}`);
            setActivity(window, 'Error creating distance matrix');
        }
    });
}

function parseDistanceMatrix(window, instanceId, params, df) {
    const state = computationStates.get(instanceId);

    setActivity(window, 'Computing tree');

    const distanceParse = {
        parseState: 'init',
        reSpecies: /^QC\s+(.+)\s+([0-9\.]+)$/,
        reMatrix: /^[0-9. \t]+$/,
        reMatrixCapt: /([0-9\.]+)/g,
        labels: [],
        qualMin: Number.MAX_VALUE,
        qualMax: Number.MIN_VALUE,
        qualSum: 0,
        qualN: 0,
        matrix: [[]], // First element must be empty
        qualMap: new Map()
    };

    lineReader.eachLine(df, (line, last) => {
        parseDistanceMatrixLine(line, distanceParse);

        if (last) {
            // Generate Newick tree using UPGMA
            const newick = UPGMA(distanceParse.matrix, distanceParse.labels);
            const topology = newick.replace(/:[-0-9.]+/g, "");

            // Send tree data to renderer
            window.webContents.send('treeData', {
                newick,
                topology,
                qualMap: Object.fromEntries(distanceParse.qualMap),
                qualMin: distanceParse.qualMin,
                qualMax: distanceParse.qualMax,
                qualAvg: distanceParse.qualN > 0 ? distanceParse.qualSum / distanceParse.qualN : 0
            });

            state.newick = newick;
            state.topology = topology;
            // Continue with next row
            state.file2Idx = 0;
            state.file1Idx++;
            computationStates.set(instanceId, state);

            // FIXME: Replace/remove timeout 
            setTimeout(() => compareNext(window, instanceId, params), 1000);
        }
    });
}

function parseDistanceMatrixLine(line, distanceParse) {
    if ((distanceParse.parseState == 'init') || (distanceParse.parseState == 'labels')) {
        let s = line.match(distanceParse.reSpecies);
        if ((s) && (s.length != 0)) {
            distanceParse.parseState = 'labels';
            let specie = s[1].replace(/[ :;,()\[\]]/g, "_");
            distanceParse.labels.push(specie);

            let q = parseFloat(s[2]);
            distanceParse.qualMap.set(specie, q);
            distanceParse.qualMin = Math.min(q, distanceParse.qualMin);
            distanceParse.qualMax = Math.max(q, distanceParse.qualMax);
            distanceParse.qualSum += q;
            distanceParse.qualN++;
        } else if (distanceParse.parseState == 'labels') {
            distanceParse.parseState = 'matrix';
        }
    }

    if (distanceParse.parseState == 'matrix') {
        if (distanceParse.reMatrix.test(line)) {
            let row = line.match(distanceParse.reMatrixCapt);
            row = row.map(x => +x);
            distanceParse.matrix.push(row);
        }
    }
}

function finishComputation(window, instanceId, params) {
    const state = computationStates.get(instanceId);

    setActivity(window, 'Finished');
    window.webContents.send('tree-computation-finished');

    // Move final files
    const tmpResultFn = path.join(params.mgfDir, params.outBasename) + `-${instanceId}_distance_matrix.meg`;
    const resultFn = path.join(params.mgfDir, params.outBasename + '_distance_matrix.meg');

    if (fs.existsSync(tmpResultFn)) {
        fs.renameSync(tmpResultFn, resultFn);
    }

    const listFn = path.join(params.mgfDir, "cmp_list.txt");
    if (fs.existsSync(state.compResultListFile)) {
        fs.renameSync(state.compResultListFile, listFn);
    }

    if (params.outNewick) {
        const newickFn = path.join(params.mgfDir, params.outBasename) + ".nwk";
        fs.writeFileSync(newickFn, state.newick + ";");
    }
}

function pauseComputation(instanceId) {
    if (computationStates.get(instanceId)) {
        computationStates.get(instanceId).paused = true;
    }
}

function resumeComputation(instanceId) {
    if (computationStates.get(instanceId)) {
        computationStates.get(instanceId).paused = false;
        // Resume computation - you may need to pass params here
    }
}

function sortFiles(files, compareOrder) {
    let fsz = files.map(file => ({
        fn: file,
        s: fs.statSync(file).size
    }));

    fsz.sort((a, b) => a.s - b.s);

    const sortedFiles = fsz.map(f => f.fn);
    files.splice(0, files.length, ...sortedFiles);

    const l = files.length;
    const l2 = Math.floor(l / 2);

    switch (compareOrder) {
        case "smallest-largest":
            for (let i1 = 1; i1 < l2; i1 += 2) {
                let i2 = l - i1;
                [files[i1], files[i2]] = [files[i2], files[i1]];
            }
            break;
        case "largest":
            files.reverse();
            break;
        case "random":
            for (let i = l - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [files[i], files[j]] = [files[j], files[i]];
            }
            break;
    }
}

exports.showPhylTreeWindow = showPhylTreeWindow;
exports.initPhylTree = initPhylTree;
