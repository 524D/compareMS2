// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain, app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const lineReader = require('line-reader');
const { llog, elog, setActivity, buildCmdArgs, getHashName, safeWindowSend, isWindowValid, cleanupWindowResources, addActiveProcess, removeActiveProcess, compareDirName, getLogFilePath } = require('./main-common.js');
const { UPGMA } = require('./upgma.js');
const { getParallelizationManager } = require('./parallelization-manager.js');

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


    // Start computation when the renderer signals it is fully initialized
    ipcMain.on('tree-ready', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;
        const state = computationStates.get(window.id);
        if (!state) return;
        safeWindowSend(window, 'set-log-path', getLogFilePath());
        runTreeComparison(window, window.id, state.params);
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

/**
 * Clean up all resources associated with a window when it's closed
 */
function cleanupWindowResourcesPhyltree(windowId) {
    // Use common process cleanup
    cleanupWindowResources(windowId);

    // Remove computation state (phyltree-specific)
    computationStates.delete(windowId);
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
        topology: '',
        params: params
    });

    phyltreeWindow.on('closed', () => {
        cleanupWindowResourcesPhyltree(phyltreeWindow.id);
    });

    phyltreeWindow.removeMenu();
    phyltreeWindow.loadFile(path.join(__dirname, '/tree.html'));

    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        phyltreeWindow.webContents.openDevTools();
    }

    phyltreeWindow.show();
    // Computation starts when the renderer sends 'tree-ready' after
    // RequireJS finishes loading phylotree and d3 (see tree.js / tree-preload.js).
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
            const { cmpFile, cmpFileJSON } = getHashName(cmdArgs, compareDir);

            if (fs.existsSync(cmpFileJSON)) {
                rowCacheFiles.push(cmpFileJSON);
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
        for (const cmpFileJSON of resumeInfo.existingCacheFiles) {
            fs.appendFileSync(state.compResultListFile, cmpFileJSON + "\n");
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

    if (!state || !isWindowValid(window) || !computationStates.has(instanceId)) return;

    const nMgf = state.mgfFiles.length;
    llog(window, `Starting phylogenetic tree computation with ${parallelManager.getTotalSlots()} parallel processes (shared across all windows)`);

    if (startFromRow > 1) {
        const skippedComparisons = ((startFromRow - 1) * startFromRow) / 2;
        llog(window, `Resuming from row ${startFromRow} (${skippedComparisons} comparisons already cached)`);
    }    // Process each row of the comparison matrix, starting from the specified row
    for (let file1Idx = startFromRow; file1Idx < nMgf; file1Idx++) {
        if (state.paused) {
            // Wait for resume
            while (state.paused && isWindowValid(window) && computationStates.has(instanceId)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        if (!isWindowValid(window) || !computationStates.has(instanceId)) {
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

        updateProgress(window, nMgf, file1Idx - 1, 0); // Update progress before starting the row

        // Execute all comparisons for this row in parallel
        let rowResults;
        try {
            rowResults = await Promise.all(
                rowTasks.map(task => executeTreeComparison(task, window, instanceId, params))
            );
        } catch (error) {
            safeWindowSend(window, 'tree-error', 'compareMS2 failed. Try running with fewer CPUs (under "Settings") or use a computer with more memory.');
            return;
        }

        // Add successful results to the comparison list
        for (const result of rowResults) {
            if (result.success) {
                fs.appendFileSync(state.compResultListFile, result.cmpFileJSON + "\n");
            }
        }

        // After completing a row, create the tree with current results
        try {
            await makeTree(window, instanceId, params);
        } catch (error) {
            if (isWindowValid(window) && computationStates.has(instanceId)) {
                elog(window, `Error creating tree: ${error.message}`);
            }
            // If window is closed, ignore the error
        }
    }

    // Computation finished
    await finishComputation(window, instanceId, params);
}

async function executeTreeComparison(task, window, instanceId, params) {
    const state = computationStates.get(instanceId);
    const { mgf1, mgf2, file1Idx, file2Idx } = task;

    // Order alphabetically for consistent hashing
    let orderedMgf1 = mgf1;
    let orderedMgf2 = mgf2;
    if (mgf1 > mgf2) {
        [orderedMgf1, orderedMgf2] = [mgf2, mgf1];
    }

    const cmdArgs = buildCmdArgs(orderedMgf1, orderedMgf2, params);
    const { cmpFile, cmpFileJSON, hashName } = getHashName(cmdArgs, state.compareDir);

    // Check if result already exists
    if (fs.existsSync(cmpFileJSON)) {
        llog(window, 'Compare file already exists: ' + cmpFileJSON, hashName);
        return { success: true, cmpFileJSON };
    }

    // Use the parallelization manager to control execution
    return await getParallelizationManager().executeTask(async () => {
        const comparems2tmp = path.join(state.compareDir, `${hashName}-${instanceId}.tmp`);
        const comparems2tmpJSON = comparems2tmp + '.json';
        const compareMS2exe = generalParams.compareMS2Exe;
        const cmdArgsWithOutput = [...cmdArgs, '-o', comparems2tmp, '-J', comparems2tmpJSON];

        try {
            await new Promise((resolve, reject) => {
                // Check if window is still valid before starting process
                if (!isWindowValid(window, instanceId)) {
                    reject(new Error('Window closed'));
                    return;
                }

                // Send activity update
                const activity = `Comparing ${path.basename(orderedMgf1)} vs ${path.basename(orderedMgf2)}`;
                setActivity(window, activity);
                const cmp_ms2 = spawn(compareMS2exe, cmdArgsWithOutput);

                // Track this process
                addActiveProcess(instanceId, cmp_ms2);

                cmp_ms2.stdout.on('data', (data) => {
                    llog(window, data.toString(), hashName);
                });
                cmp_ms2.stderr.on('data', (data) => {
                    elog(window, data.toString(), hashName);
                });

                cmp_ms2.on('error', (error) => {
                    // Remove from tracking
                    removeActiveProcess(instanceId, cmp_ms2);
                    reject(error);
                });

                cmp_ms2.on('close', (code) => {
                    // Remove from tracking
                    removeActiveProcess(instanceId, cmp_ms2);

                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`compareMS2 exited with code ${code}`));
                    }
                });
            });

            // Rename temporary file to final name
            fs.renameSync(comparems2tmpJSON, cmpFileJSON);
            fs.renameSync(comparems2tmp, cmpFile);
            llog(window, 'Compare file created: ' + cmpFileJSON, hashName);
            updateProgress(window, state.mgfFiles.length, file1Idx, file2Idx);
            return { success: true, cmpFileJSON };

        } catch (error) {
            elog(window, `Error running compareMS2: ${error.message}`, hashName);
            throw error;
        }
    });
}

function updateProgress(window, nMgfFiles, file1Idx, file2Idx) {
    const totalComparisons = (nMgfFiles * (nMgfFiles - 1)) / 2;
    const completedComparisons = ((file1Idx - 1) * file1Idx) / 2 + file2Idx + 1;
    const progress = completedComparisons / totalComparisons;
    safeWindowSend(window, 'progress-update', progress * 100);
}

async function makeTree(window, instanceId, params) {
    // Check if window is still valid first
    if (!isWindowValid(window) || !computationStates.has(instanceId)) {
        throw new Error('Window closed or invalid state');
    }

    const state = computationStates.get(instanceId);
    if (!state) {
        throw new Error('Window closed or invalid state');
    }

    const outputBasename = params.outBasename + `-${instanceId}`;

    return runCompToDistExe(
        window,
        instanceId,
        params,
        state,
        ['-J'],
        outputBasename,
        'Creating tree',
        'Distance matrix created successfully',
        'creating distance matrix',
        (window, instanceId, params, dfArg) => {
            const df = dfArg + "_distance_matrix.json";
            parseDistanceMatrix(window, instanceId, params, df);
        }
    );
}

function parseDistanceMatrix(window, instanceId, params, df) {
    const state = computationStates.get(instanceId);

    setActivity(window, 'Computing tree');

    // Read and parse JSON file
    const jsonContent = fs.readFileSync(df, 'utf8');
    const data = JSON.parse(jsonContent);
    const distanceMatrix = data.distanceMatrix;

    // Extract species information
    const labels = [];
    const qualMap = new Map();
    let qualMin = Number.MAX_VALUE;
    let qualMax = Number.MIN_VALUE;
    let qualSum = 0;
    let qualN = 0;

    for (const species of distanceMatrix.species) {
        // Sanitize species name (replace invalid characters)
        const sanitizedName = species.name.replace(/[ :;,()\[\]]/g, "_");
        labels.push(sanitizedName);

        const qc = species.qc;
        qualMap.set(sanitizedName, qc);
        qualMin = Math.min(qc, qualMin);
        qualMax = Math.max(qc, qualMax);
        qualSum += qc;
        qualN++;
    }

    // Build full distance matrix for UPGMA
    // The JSON contains lower triangular matrix, convert to format expected by UPGMA
    const matrix = [[]]; // First element must be empty
    const distances = distanceMatrix.distances;

    for (let i = 0; i < distances.length; i++) {
        matrix.push(distances[i]);
    }

    // Generate Newick tree using UPGMA
    const newick = UPGMA(matrix, labels);
    const topology = newick.replace(/:[-0-9.]+/g, "");

    // Send tree data to renderer
    safeWindowSend(window, 'treeData', {
        newick,
        topology,
        qualMap: Object.fromEntries(qualMap),
        qualMin: qualMin,
        qualMax: qualMax,
        qualAvg: qualN > 0 ? qualSum / qualN : 0
    });

    state.newick = newick;
    state.topology = topology;
    computationStates.set(instanceId, state);
}

async function finishComputation(window, instanceId, params) {
    const state = computationStates.get(instanceId);

    // Generate other output file formats as requested
    const outputPromises = [];

    var outputFormats = ["-J"]; // Always generate JSON format

    if (params.outMega) {
        outputFormats.push('-m');
    }

    if (params.outMega12) {
        outputFormats.push('-m2');
    }

    if (params.outNexus) {
        outputFormats.push('-n');
    }

    outputPromises.push(runCompToDistExe(
        window,
        instanceId,
        params,
        state,
        outputFormats,
        params.outBasename,
        'Generating requested output formats',
        'Output formats generated successfully',
        'output format generation'
    ));

    // Wait for all output generation to complete
    if (outputPromises.length > 0) {
        await Promise.all(outputPromises);
    }

    // Delete temporary json file
    const outBasenameTmp = path.join(params.mgfDir, params.outBasename) + `-${instanceId}_distance_matrix.json`;
    if (fs.existsSync(outBasenameTmp)) {
        fs.unlinkSync(outBasenameTmp);
    }

    // Rename comparison list file to final name
    const listFn = path.join(params.mgfDir, "cmp_list.txt");
    if (fs.existsSync(state.compResultListFile)) {
        fs.renameSync(state.compResultListFile, listFn);
    }

    // Write Newick file if requested
    if (params.outNewick) {
        const newickFn = path.join(params.mgfDir, params.outBasename) + ".nwk";
        fs.writeFileSync(newickFn, state.newick + ";");
    }

    // Ensure progress bar shows 100% completion
    safeWindowSend(window, 'progress-update', 100);

    setActivity(window, 'Finished');
}

/**
 * Generic function to run compareMS2_to_distance_matrices with specified format options
 * @param {BrowserWindow} window - The window to send updates to
 * @param {number} instanceId - The instance ID for tracking
 * @param {Object} params - Comparison parameters
 * @param {Object} state - Computation state
 * @param {Array<string>} formatFlags - Array of format flags (e.g., ['-m', '-m2', '-n'])
 * @param {string} outputBasename - Output file basename (can include instanceId suffix)
 * @param {string} activityMsg - Activity message to display
 * @param {string} successMsg - Success log message
 * @param {string} errorContext - Error context description
 * @param {Function} onSuccess - Optional callback function called on success with (window, instanceId, params, outputFile)
 * @returns {Promise} Promise that resolves when the process completes
 */
function runCompToDistExe(window, instanceId, params, state, formatFlags, outputBasename, activityMsg, successMsg, errorContext, onSuccess = null) {
    const compToDistExe = generalParams.compToDistExe;

    setActivity(window, activityMsg);

    const dfArg = path.join(params.mgfDir, outputBasename);
    const cmdArgs = [
        '-i', state.compResultListFile,
        '-o', dfArg,
        '-c', params.cutoff,
        ...formatFlags
    ];
    if (fs.existsSync(params.s2sFile)) {
        cmdArgs.push('-x', params.s2sFile);
    }

    llog(window, `Running ${compToDistExe} with args: ${cmdArgs.join(' ')}`);

    return new Promise((resolve, reject) => {
        // Check if window is still valid before starting process
        if (onSuccess && !isWindowValid(window, instanceId)) {
            reject(new Error('Window closed'));
            return;
        }

        const c2d = spawn(compToDistExe, cmdArgs);

        // Track this process
        addActiveProcess(instanceId, c2d);

        c2d.stdout.on('data', (data) => {
            llog(window, data.toString());
        });
        c2d.stderr.on('data', (data) => {
            elog(window, data.toString());
        });
        c2d.on('close', (code) => {
            // Remove from tracking
            removeActiveProcess(instanceId, c2d);

            // Check if window is still valid after process completes (for makeTree callback)
            if (onSuccess && !isWindowValid(window, instanceId)) {
                reject(new Error('Window closed'));
                return;
            }

            if (code === 0) {
                llog(window, successMsg);
                if (onSuccess) {
                    onSuccess(window, instanceId, params, dfArg);
                }
                resolve();
            } else {
                elog(window, `${compToDistExe} exited with code 0x${code.toString(16)}`);
                if (onSuccess) {
                    setActivity(window, `Error ${errorContext}`);
                }
                reject(new Error(`${errorContext} failed with code ${code}`));
            }
        });
        c2d.on('error', (error) => {
            // Remove from tracking
            removeActiveProcess(instanceId, c2d);
            elog(window, `Error running ${compToDistExe} for ${errorContext}: ${error.message}`);
            reject(error);
        });
    });
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
