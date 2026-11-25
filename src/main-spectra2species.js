// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { llog, elog, setActivity, buildCmdArgs, getHashName, getCPUCount, safeWindowSend, isWindowValid, cleanupWindowResources, addActiveProcess, removeActiveProcess, compareDirName, getLogFilePath } = require('./main-common.js');
const { getParallelizationManager } = require('./parallelization-manager.js');
const { computeLibraryEnrichment, enrichmentToTSV } = require('./enrichment.js');
const { readSample2Species } = require('./sample2species.js');

var generalParams = null;

function initS2S(genParams) {
    generalParams = genParams;

    ipcMain.on('export-s2s-enrichment', (event, defaultName, distanceMap) => {
        const senderWindow = BrowserWindow.fromWebContents(event.sender);
        const savePath = dialog.showSaveDialogSync(senderWindow, {
            title: 'Save enrichment table',
            defaultPath: (defaultName || 'spectra2species_enrichment') + '.tsv',
            filters: [
                { name: 'Tab-separated values', extensions: ['tsv', 'txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        if (savePath) {
            try {
                fs.writeFileSync(savePath, enrichmentToTSV(distanceMap), 'utf8');
                if (senderWindow) {
                    setActivity(senderWindow, 'Saved enrichment table to ' + path.basename(savePath));
                }
            } catch (err) {
                if (senderWindow) {
                    elog(senderWindow, 'Failed saving enrichment table: ' + err.message);
                }
            }
        }
    });
}

function readSampleFiles(mgfDir, window) {
    // Read all files in the mgfDir directory and return an array of sample files
    if (!fs.existsSync(mgfDir)) {
        elog(window, 'Directory does not exist: ' + mgfDir);
        return [];
    }
    const files = fs.readdirSync(mgfDir);
    // Filter files to only include .mfg files
    const sampleFiles = files.filter(file => file.endsWith('.mgf')); // Get the full path of the files
    return sampleFiles;
}

// Function to show the spectra2species window
function showS2SWindow(mainWindow, icon, params) {
    let s2sWindow = new BrowserWindow({
        width: 1200,
        height: 960,
        minWidth: 720,
        minHeight: 480,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'spectra2species-preload.js')
        },
        icon: icon,
    });
    s2sWindow.on('closed', () => {
        cleanupWindowResources(s2sWindow.id);
    });
    s2sWindow.removeMenu();
    s2sWindow.loadFile(path.join(__dirname, '/spectra2species.html'));
    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        // Open the DevTools.
        s2sWindow.webContents.openDevTools();
    }

    s2sWindow.show();
    // Wait for the window to be ready before running the comparison
    s2sWindow.webContents.once('did-finish-load', () => {
        safeWindowSend(s2sWindow, 'set-log-path', getLogFilePath());
        runS2S(params, s2sWindow);
    });
}

// Start the spectra2species run
async function runS2S(params, window) {
    const parallelManager = getParallelizationManager();
    const maxParallel = parallelManager.getTotalSlots();

    llog(window, `Using ${maxParallel} parallel processes for comparisons (shared across all windows)`);

    // Initialize progress bar
    safeWindowSend(window, 'progress-update', 0);

    var errors = 0; // Count the number of errors
    // Create directory for compare results
    const compareDir = path.join(params.mgfDir, compareDirName);
    if (!fs.existsSync(compareDir)) fs.mkdirSync(compareDir, { recursive: true });

    const sampleFiles = readSampleFiles(params.mgfDir, window);
    if (sampleFiles.length === 0) {
        elog(window, 'No sample files found in directory: ' + params.mgfDir);
        return;
    }
    const sample2Species = readSample2Species(params.s2sFile, sampleFiles);

    // Compare params.mzFile1 to all files in sampleFiles
    // Filter out the reference file and prepare comparison tasks
    const comparisonTasks = [];
    for (const sampleFile of sampleFiles) {
        const sampleFileFull = path.join(params.mgfDir, sampleFile);
        // Skip the mzFile1 file, it is the reference file
        if (sampleFileFull == params.mzFile1) {
            llog(window, 'No self-compare, skipping file: ' + sampleFileFull);
            continue;
        }
        comparisonTasks.push({
            sampleFile,
            sampleFileFull
        });
    }

    // Track results as they complete
    const cmpFilesJSON = [];
    const compareResults = [];
    let completedTasks = 0;
    const totalTasks = comparisonTasks.length;
    let aborted = false;

    // Function to execute a single comparison
    async function executeComparison(task) {
        const { sampleFile, sampleFileFull } = task;

        setActivity(window, `Comparing ${path.basename(sampleFileFull)}`);

        // Convert parameters to command line arguments for the comparems2 executable
        const cmdArgs = buildCmdArgs(params.mzFile1, sampleFileFull, params);
        // Get the hash name and compare file
        const { _, cmpFileJSON, hashName } = getHashName(cmdArgs, compareDir);

        // Check if the compare file already exists
        if (fs.existsSync(cmpFileJSON)) {
            llog(window, 'Compare file already exists: ' + cmpFileJSON, hashName);
            return { success: true, cmpFileJSON, sampleFile };
        }

        // Temporary output filename of compare ms2
        // used to avoid stale incomplete output after interrupt
        const comparems2tmpJSON = path.join(compareDir, hashName + "-" + window.id + "-" + Date.now() + ".tmp.json");
        // Append output filename, should not be part of hash
        const cmdArgsWithOutput = [...cmdArgs, '-J', comparems2tmpJSON];

        const compareMS2exe = generalParams.compareMS2Exe;
        let cmdStr = compareMS2exe + JSON.stringify(cmdArgsWithOutput);
        llog(window, 'Executing: ' + cmdStr + '\n', hashName);

        // Use the parallelization manager to control execution
        return await parallelManager.executeTask(async () => {
            if (aborted) {
                throw new Error('aborted');
            }
            // Check if window is still valid before starting process
            if (!isWindowValid(window)) {
                return { success: false, error: 'Window closed', sampleFile };
            }

            // Run the compareMS2 executable
            try {
                await new Promise((resolve, reject) => {
                    const child = spawn(compareMS2exe, cmdArgsWithOutput, { windowsHide: true, stdio: 'inherit' });

                    // Track this process
                    addActiveProcess(window.id, child);

                    child.on('close', (code) => {
                        // Remove from tracking
                        removeActiveProcess(window.id, child);

                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`compareMS2 process exited with code ${code}`));
                        }
                    });

                    child.on('error', (error) => {
                        // Remove from tracking
                        removeActiveProcess(window.id, child);
                        reject(error);
                    });
                });
            } catch (error) {
                elog(window, `Error running compareMS2: ${error.message}`, hashName);
                throw error;
            }

            // Rename the output file to the final name
            if (fs.existsSync(comparems2tmpJSON)) {
                fs.renameSync(comparems2tmpJSON, cmpFileJSON);
                llog(window, 'Compare file created: ' + cmpFileJSON, hashName);
                return { success: true, cmpFileJSON, sampleFile };
            } else {
                const err = new Error('Output file not created: ' + cmpFileJSON);
                elog(window, err.message, hashName);
                throw err;
            }
        });
    }

    // Function to process a completed comparison result
    function processCompletedComparison(result) {
        if (result.success) {
            // Add the compare file to the list of compare files
            cmpFilesJSON.push(result.cmpFileJSON);
            // Append the compare results
            compareResults.push(parseCompareMS2JSON(result.cmpFileJSON));

            // Create a distance map (includes similarity & Fisher's exact enrichment stats)
            const distanceMap = comparisons2Distance(params.mzFile1, compareResults, sample2Species, window, params.topN);
            if (distanceMap.length === 0) {
                llog(window, 'No distances found for sample: ' + result.sampleFile);
                return;
            }

            // Update the chart with current results
            safeWindowSend(window, 'updateChart', distanceMap,
                path.basename(params.mgfDir),
                path.basename(params.mzFile1),
                params.s2sFile ? path.basename(params.s2sFile) : params.s2sFile);
        } else {
            errors++;
        }
        completedTasks++;

        // Update progress bar
        const progress = (completedTasks / totalTasks) * 100;
        safeWindowSend(window, 'progress-update', progress);
    }

    // Execute all comparisons in parallel using Promise.all
    // The parallelization manager will handle the actual concurrency control
    try {
        await Promise.all(
            comparisonTasks.map(async (task) => {
                const result = await executeComparison(task);
                processCompletedComparison(result);
                return result;
            })
        );
    } catch (error) {
        aborted = true;
        cleanupWindowResources(window.id);
        safeWindowSend(window, 's2s-error', 'compareMS2 failed. Try running with fewer CPUs (under "Settings") or use a computer with more memory.');
        return;
    }

    // Automatically write Fisher's exact enrichment table in TSV format
    const finalDistanceMap = compareResults.length > 0
        ? comparisons2Distance(params.mzFile1, compareResults, sample2Species, window, params.topN)
        : [];
    let savedMsg = '';
    if (finalDistanceMap.length > 0) {
        const outBase = (params.outBasename && params.outBasename.trim()) ? params.outBasename.trim() : 'spectra2species';
        const queryStem = path.basename(params.mzFile1, path.extname(params.mzFile1));
        const enrichmentTsvPath = path.join(params.mgfDir, `${outBase}_${queryStem}_enrichment.tsv`);
        try {
            fs.writeFileSync(enrichmentTsvPath, enrichmentToTSV(finalDistanceMap), 'utf8');
            llog(window, 'Enrichment TSV saved to: ' + enrichmentTsvPath);
            savedMsg = ` (saved ${path.basename(enrichmentTsvPath)})`;
        } catch (err) {
            elog(window, 'Failed writing enrichment TSV: ' + err.message);
        }
    }

    // After all comparisons, send a message to the renderer process to indicate completion
    safeWindowSend(window, 'progress-update', 100);
    setActivity(window, 'spectra2species comparison completed successfully.' + savedMsg);
}

// Convert distance to similarity
function distance2Similarity(distance) {
    if (!Number.isFinite(distance) || distance < 0) {
        return 0;
    }
    const similarity = 1 / (1 + distance); // Convert distance to similarity
    // Round similarity to 4 decimal places
    return Math.round(similarity * 10000) / 10000;
}

// This function reads an array of results from comparisons and returns a sorted array
// of species distances, similarities, and Fisher's Exact Test enrichment statistics.
function comparisons2Distance(checkFileName, compareResults, sample2Species, window, topN = -1) {
    // Initialize an empty distance/enrichment bucket map
    const speciesBuckets = {};

    for (const compareResult of compareResults) {
        if ((checkFileName !== compareResult.sample1) && (checkFileName !== compareResult.sample2)) {
            if (window) {
                elog(window, `Check file ${checkFileName} does not match sample names ${compareResult.sample1} or ${compareResult.sample2}. This should never happen.`);
            }
            continue; // Skip this comparison if the check file does not match the sample names
        }
        const otherFile = (checkFileName === compareResult.sample1 ? compareResult.sample2 : compareResult.sample1);
        const otherFileBase = path.basename(otherFile);
        // Check if the sample names are in the sample2Species map
        if (!Object.prototype.hasOwnProperty.call(sample2Species, otherFileBase)) {
            if (window) {
                elog(window, `Sample names ${otherFileBase} not found in sample2Species map. This should never happen.`);
            }
            continue; // Skip this comparison if the sample names are not found
        }
        const otherSpecie = sample2Species[otherFileBase];
        const distance = compareResult.distance;
        // If the other species is not in the bucket map, initialize it
        if (!Object.prototype.hasOwnProperty.call(speciesBuckets, otherSpecie)) {
            speciesBuckets[otherSpecie] = {
                distances: [],
                matched: 0,
                total: 0,
                comparisons: 0,
            };
        }
        const bucket = speciesBuckets[otherSpecie];
        const matched = Number.isFinite(compareResult.nrGtCutoff) ? Math.max(0, compareResult.nrGtCutoff) : 0;
        const qcA = Number.isFinite(compareResult.datasetAQC) ? Math.max(0, compareResult.datasetAQC) : 0;
        const qcB = Number.isFinite(compareResult.datasetBQC) ? Math.max(0, compareResult.datasetBQC) : 0;
        const effA = (Number.isFinite(topN) && topN > 0) ? Math.min(qcA, topN) : qcA;
        const effB = (Number.isFinite(topN) && topN > 0) ? Math.min(qcB, topN) : qcB;
        const total = Math.max(effA + effB, matched);
        const comparisons = Number.isFinite(compareResult.nrComparisons) ? Math.max(0, compareResult.nrComparisons) : 0;

        bucket.distances.push(distance);
        bucket.matched += matched;
        bucket.total += total;
        bucket.comparisons += comparisons;
    }

    // Create an average distance map from the buckets
    const averageDistanceMap = [];
    for (const otherSpecie in speciesBuckets) {
        const bucket = speciesBuckets[otherSpecie];
        const hasInf = bucket.distances.some(v => !Number.isFinite(v));
        const averageDistance = hasInf
            ? Infinity
            : bucket.distances.reduce((sum, value) => sum + value, 0) / bucket.distances.length;
        averageDistanceMap.push({
            species: otherSpecie,
            distance: averageDistance,
            similarity: distance2Similarity(averageDistance),
            matched: bucket.matched,
            total: bucket.total,
            comparisons: bucket.comparisons,
            sampleCount: bucket.distances.length,
        });
    }

    // Sort the average distance map by distance and attach Fisher's exact enrichment stats
    const sortedDistanceMap = averageDistanceMap.sort((a, b) => a.distance - b.distance);
    return computeLibraryEnrichment(sortedDistanceMap);
}

function parseCompareMS2JSON(jsonFile) {
    // Parse JSON file created by compareMS2 with distance and spectral count metadata
    const jsonData = fs.readFileSync(jsonFile, 'utf8');
    const data = JSON.parse(jsonData);

    const rawDist = data.setDistance;
    const parsedDist = (rawDist === 'INF' || rawDist === null || rawDist === undefined) ? Infinity : Number(rawDist);
    const distance = Number.isFinite(parsedDist) ? parsedDist : Infinity;

    return {
        sample1: data.datasetA,
        sample2: data.datasetB,
        distance,
        nrGtCutoff: Number.isFinite(data.nrGtCutoff) ? data.nrGtCutoff : 0,
        nrComparisons: Number.isFinite(data.nrComparisons) ? data.nrComparisons : 0,
        datasetAQC: Number.isFinite(data.datasetAQC) ? data.datasetAQC : 0,
        datasetBQC: Number.isFinite(data.datasetBQC) ? data.datasetBQC : 0,
    };
}

exports.showS2SWindow = showS2SWindow;
exports.initS2S = initS2S;
