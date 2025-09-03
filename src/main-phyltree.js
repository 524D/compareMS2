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
const { getParallelizationManager } = require('./parallelization-manager.js');

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

/**
 * Finds the last complete row in the phylogenetic comparison matrix for which
 * all cache files exist. This allows resuming computation from where it left off
 * when the application is restarted, avoiding redundant comparisons.
 * 
 * @param {Array} mgfFiles - Array of MGF file paths
 * @param {string} compareDir - Directory containing cache files
 * @param {Object} params - Comparison parameters used for hashing
 * @returns {Object} Object containing lastCompleteRow index and array of existing cache files
 */
function findLastCompleteRow(mgfFiles, compareDir, params) {
    const nMgf = mgfFiles.length;
    let lastCompleteRow = 0;
    const existingCacheFiles = [];

    // Check each row of the comparison matrix
    for (let file1Idx = 1; file1Idx < nMgf; file1Idx++) {
        let rowComplete = true;
        const rowCacheFiles = [];

        // Check if all cache files exist for this row
        for (let file2Idx = 0; file2Idx < file1Idx; file2Idx++) {
            const mgf1 = mgfFiles[file1Idx];
            const mgf2 = mgfFiles[file2Idx];

            // Order alphabetically for consistent hashing (same as in executeTreeComparison)
            let orderedMgf1 = mgf1;
            let orderedMgf2 = mgf2;
            if (mgf1 > mgf2) {
                [orderedMgf1, orderedMgf2] = [mgf2, mgf1];
            }

            const cmdArgs = buildCmdArgs(orderedMgf1, orderedMgf2, params);
            const { cmpFile } = getHashName(cmdArgs, compareDir);

            if (fs.existsSync(cmpFile)) {
                rowCacheFiles.push(cmpFile);
            } else {
                rowComplete = false;
                break; // This row is incomplete, no need to check remaining files
            }
        }

        if (rowComplete) {
            lastCompleteRow = file1Idx;
            existingCacheFiles.push(...rowCacheFiles);
        } else {
            break; // Found an incomplete row, stop checking
        }
    }

    return {
        lastCompleteRow,
        existingCacheFiles
    };
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

    // Check for existing cache files and determine starting point
    const resumeInfo = findLastCompleteRow(state.mgfFiles, state.compareDir, params);
    if (resumeInfo.lastCompleteRow > 0) {
        const totalComparisons = ((state.mgfFiles.length - 1) * (state.mgfFiles.length)) / 2;
        const cachedComparisons = resumeInfo.existingCacheFiles.length;
        const percentageCached = Math.round((cachedComparisons / totalComparisons) * 100);

        llog(window, `Found ${cachedComparisons} cached comparison results (${percentageCached}% of total)`);
        llog(window, `Resuming computation from row ${resumeInfo.lastCompleteRow + 1} of ${state.mgfFiles.length - 1}`);

        // Populate comparison list file with existing cache files
        for (const cmpFile of resumeInfo.existingCacheFiles) {
            fs.appendFileSync(state.compResultListFile, cmpFile + "\n");
        }

        // Generate intermediate tree with existing data if we have a substantial amount cached
        if (resumeInfo.lastCompleteRow >= 2) {
            makeTree(window, instanceId, params).then(() => {
                // Start comparison with parallel processing from the resume point
                runParallelTreeComparison(window, instanceId, params, resumeInfo.lastCompleteRow + 1);
            }).catch(() => {
                // If tree generation fails, start from the beginning
                llog(window, "Failed to generate tree from cached data, starting fresh computation");
                runParallelTreeComparison(window, instanceId, params);
            });
        } else {
            // Not enough cached data for meaningful tree, start from resume point
            runParallelTreeComparison(window, instanceId, params, resumeInfo.lastCompleteRow + 1);
        }
    } else {
        llog(window, "No cached comparison results found, starting fresh computation");
        // Start comparison with parallel processing from the beginning
        runParallelTreeComparison(window, instanceId, params);
    }
    return true;
}

async function runParallelTreeComparison(window, instanceId, params, startFromRow = 1) {
    const state = computationStates.get(instanceId);
    const parallelManager = getParallelizationManager();

    if (!state || !window) return;

    const nMgf = state.mgfFiles.length;
    llog(window, `Starting phylogenetic tree computation with ${parallelManager.getTotalSlots()} parallel processes (shared across all windows)`);

    if (startFromRow > 1) {
        const skippedComparisons = ((startFromRow - 1) * startFromRow) / 2;
        llog(window, `Resuming from row ${startFromRow} (${skippedComparisons} comparisons already cached)`);
    }    // Process each row of the comparison matrix, starting from the specified row
    for (let file1Idx = startFromRow; file1Idx < nMgf; file1Idx++) {
        if (state.paused) {
            // Wait for resume
            while (state.paused) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        if (!window || !computationStates.has(instanceId)) {
            // Window was closed
            return;
        }

        // Create comparison tasks for this row
        const rowTasks = [];
        for (let file2Idx = 0; file2Idx < file1Idx; file2Idx++) {
            rowTasks.push({
                file1Idx,
                file2Idx,
                mgf1: state.mgfFiles[file1Idx],
                mgf2: state.mgfFiles[file2Idx]
            });
        }

        // Update progress (account for the starting row)
        const totalRows = nMgf - 1;
        const completedRows = (file1Idx - 1);
        const progress = completedRows / totalRows;
        window.webContents.send('progress-update', progress * 100);

        // Execute all comparisons for this row in parallel
        const rowResults = await Promise.all(
            rowTasks.map(task => executeTreeComparison(task, window, instanceId, params))
        );

        // Add successful results to the comparison list
        for (const result of rowResults) {
            if (result.success) {
                fs.appendFileSync(state.compResultListFile, result.cmpFile + "\n");
            }
        }

        // After completing a row, create the tree with current results
        await makeTree(window, instanceId, params);
    }

    // Computation finished
    finishComputation(window, instanceId, params);
}

async function executeTreeComparison(task, window, instanceId, params) {
    const state = computationStates.get(instanceId);
    const { mgf1, mgf2, file1Idx, file2Idx } = task;

    // Send activity update
    const activity = `Comparing ${path.basename(mgf1)} vs ${path.basename(mgf2)}`;
    setActivity(window, activity);

    // Order alphabetically for consistent hashing
    let orderedMgf1 = mgf1;
    let orderedMgf2 = mgf2;
    if (mgf1 > mgf2) {
        [orderedMgf1, orderedMgf2] = [mgf2, mgf1];
    }

    const cmdArgs = buildCmdArgs(orderedMgf1, orderedMgf2, params);
    const { cmpFile, hashName } = getHashName(cmdArgs, state.compareDir);

    // Check if result already exists
    if (fs.existsSync(cmpFile)) {
        llog(window, 'Compare file already exists: ' + cmpFile);
        return { success: true, cmpFile };
    }

    // Use the parallelization manager to control execution
    return await getParallelizationManager().executeTask(async () => {
        const comparems2tmp = path.join(state.compareDir, `${hashName}-${instanceId}.tmp`);
        const compareMS2exe = generalParams.compareMS2Exe;
        const cmdArgsWithOutput = [...cmdArgs, '-o', comparems2tmp];

        try {
            await new Promise((resolve, reject) => {
                const cmp_ms2 = spawn(compareMS2exe, cmdArgsWithOutput);

                cmp_ms2.stdout.on('data', (data) => {
                    llog(window, data.toString());
                });

                cmp_ms2.stderr.on('data', (data) => {
                    elog(window, data.toString());
                });

                cmp_ms2.on('error', (error) => {
                    reject(error);
                });

                cmp_ms2.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`compareMS2 exited with code ${code}`));
                    }
                });
            });

            // Rename temporary file to final name
            fs.renameSync(comparems2tmp, cmpFile);
            return { success: true, cmpFile };

        } catch (error) {
            elog(window, `Error running compareMS2: ${error.message}`);
            return { success: false, error: error.message };
        }
    });
}


async function makeTree(window, instanceId, params) {
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

    return new Promise((resolve, reject) => {
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
                resolve();
            } else {
                elog(window, `${compToDistExe} exited with code 0x${code.toString(16)}`);
                setActivity(window, 'Error creating distance matrix');
                reject(new Error(`Distance matrix creation failed with code ${code}`));
            }
        });
        c2d.on('error', (error) => {
            elog(window, `Error running ${compToDistExe}: ${error.message}`);
            reject(error);
        });
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
            computationStates.set(instanceId, state);

            // Tree data sent to renderer - row completed in parallel implementation
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
    let state = computationStates.get(instanceId);
    if (state) {
        state.paused = true;
        computationStates.set(instanceId, state);
    }
}

function resumeComputation(instanceId) {
    let state = computationStates.get(instanceId);
    if (state) {
        state.paused = false;
        computationStates.set(instanceId, state);
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
