// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { llog, elog, setActivity, buildCmdArgs, getHashName, getCPUCount } = require('./main-common.js');
const { getParallelizationManager } = require('./parallelization-manager.js');

const compareDirName = 'compareresult'; // Directory where the compare results are stored relative to the mgfDir

var generalParams = null;

function initS2S(genParams) {
    generalParams = genParams;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

// Read the Sample2Species file
// The file is expected to be a tab-separated file with two columns: sample name and species name
// 
// The sample name is the base name of the sample file.
// If the sample name is not present in the file, it will be added with the species name equal to the sample name.
function readSample2Species(fn, sampleFiles) {
    const sample2Species = {};
    const extraSamples = new Set(); // To collect all sample names
    const sampleFilesBaseNames = sampleFiles.map(file => path.basename(file)); // Get base names of sample files
    if (fs.existsSync(fn)) {
        const sample2SpeciesRaw = fs.readFileSync(fn, 'utf8');
        const lines = sample2SpeciesRaw.split('\n').filter(line => line.trim() !== ''); // Remove empty lines
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length === 2) {
                const sample = parts[0].trim();
                const species = parts[1].trim();
                sample2Species[sample] = species;
                extraSamples.add(species); // Add sample
            }
        }
    }
    // Remove the samples that exist in sampleFiles from the extraSamples set
    for (const sampleFn of sampleFilesBaseNames) {
        if (extraSamples.has(sampleFn)) {
            extraSamples.delete(sampleFn);
        }
    }
    // The remaining samples in extraSamples are not present in the sample2Species file
    // Remove them from the sample2Species object
    for (const sample of extraSamples) {
        if (sample2Species.hasOwnProperty(sample)) {
            delete sample2Species[sample];
        }
    }

    // Ensure all samples in sampleFiles are present in the sample2Species
    for (const sampleFn of sampleFilesBaseNames) {
        if (!sample2Species.hasOwnProperty(sampleFn)) {
            sample2Species[sampleFn] = sampleFn; // Use the sample name
        }
    }
    return sample2Species;
}

// Function to show the Spectra2Species window
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
    s2sWindow.on('close', () => { s2sWindow = null })
    s2sWindow.removeMenu();
    s2sWindow.loadFile(path.join(__dirname, '/spectra2species.html'));
    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        // Open the DevTools.
        s2sWindow.webContents.openDevTools();
    }

    s2sWindow.show();
    // Wait for the window to be ready before running the comparison
    s2sWindow.webContents.once('did-finish-load', () => {
        runS2S(params, s2sWindow);
    });
}

// Start the spectra2species run
async function runS2S(params, window) {
    const parallelManager = getParallelizationManager();
    const maxParallel = parallelManager.getTotalSlots();

    llog(window, `Using ${maxParallel} parallel processes for comparisons (shared across all windows)`);

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

    // Function to execute a single comparison
    async function executeComparison(task) {
        const { sampleFile, sampleFileFull } = task;

        setActivity(window, `Comparing ${path.basename(sampleFileFull)} (${completedTasks + 1}/${totalTasks})`);

        // Convert parameters to command line arguments for the comparems2 executable
        const cmdArgs = buildCmdArgs(params.mzFile1, sampleFileFull, params);
        // Get the hash name and compare file
        const { cmpFile, cmpFileJSON, hashName } = getHashName(cmdArgs, compareDir);

        // Check if the compare file already exists
        if (fs.existsSync(cmpFileJSON)) {
            llog(window, 'Compare file already exists: ' + cmpFileJSON);
            return { success: true, cmpFileJSON, sampleFile };
        }

        // Temporary output filename of compare ms2
        // used to avoid stale incomplete output after interrupt
        const comparems2tmp = path.join(compareDir, hashName + "-" + window.id + "-" + Date.now() + ".tmp");
        const comparems2tmpJSON = comparems2tmp + '.json';
        // Append output filename, should not be part of hash
        const cmdArgsWithOutput = [...cmdArgs, '-o', comparems2tmp, '-J', comparems2tmpJSON];

        const compareMS2exe = generalParams.compareMS2Exe;
        let cmdStr = compareMS2exe + JSON.stringify(cmdArgsWithOutput);
        llog(window, 'Executing: ' + cmdStr + '\n');

        // Use the parallelization manager to control execution
        return await parallelManager.executeTask(async () => {
            // Run the compareMS2 executable
            try {
                await new Promise((resolve, reject) => {
                    const child = spawn(compareMS2exe, cmdArgsWithOutput, { windowsHide: true, stdio: 'inherit' });

                    child.on('close', (code) => {
                        if (code === 0) {
                            llog(window, 'Compare file created: ' + cmpFile);
                            resolve();
                        } else {
                            reject(new Error(`compareMS2 process exited with code ${code}`));
                        }
                    });

                    child.on('error', (error) => {
                        reject(error);
                    });
                });
            } catch (error) {
                elog(window, 'Error running compareMS2:', error);
                return { success: false, error, sampleFile };
            }

            // Rename the output file to the final name
            if (fs.existsSync(comparems2tmpJSON)) {
                fs.renameSync(comparems2tmpJSON, cmpFileJSON);
                fs.renameSync(comparems2tmp, cmpFile);
                llog(window, 'Compare file created: ' + cmpFileJSON);
                return { success: true, cmpFileJSON, sampleFile };
            } else {
                elog(window, 'Compare file not created: ' + cmpFileJSON);
                return { success: false, error: 'Output file not created', sampleFile };
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

            // Create a distance map
            const distanceMap = comparisons2Distance(params.mzFile1, compareResults, sample2Species, window);
            if (distanceMap.length === 0) {
                llog(window, 'No distances found for sample: ' + result.sampleFile);
                return;
            }

            // Convert distances to similarities
            distanceMap.forEach(item => {
                item.similarity = distance2Similarity(item.distance);
            });

            // Update the chart with current results
            window.webContents.send('updateChart', distanceMap,
                path.basename(params.mgfDir),
                path.basename(params.mzFile1),
                params.s2sFile ? path.basename(params.s2sFile) : params.s2sFile);
        } else {
            errors++;
        }
        completedTasks++;
    }

    // Execute all comparisons in parallel using Promise.all
    // The parallelization manager will handle the actual concurrency control
    const allResults = await Promise.all(
        comparisonTasks.map(async (task) => {
            try {
                const result = await executeComparison(task);
                processCompletedComparison(result);
                return result;
            } catch (error) {
                elog(window, 'Comparison task failed:', error);
                errors++;
                completedTasks++;
                return { success: false, error, sampleFile: task.sampleFile };
            }
        })
    );

    // After all comparisons, send a message to the renderer process to indicate completion
    if (errors > 0) {
        setActivity(window, `Spectra2Species comparison completed with ${errors} errors. Check the logs for details.`);
    } else {
        setActivity(window, 'Spectra2Species comparison completed successfully.');
    }
}

// Convert distance to similarity
function distance2Similarity(distance) {
    const similarity = 1 / (1 + distance); // Convert distance to similarity
    // Round similarity to 4 decimal places
    return Math.round(similarity * 10000) / 10000;
}

// This function reads an array of results from comparisons and returns a maps of distances
// for each specie in the sample2Species (as returned by readSample2Species).
function comparisons2Distance(checkFileName, compareResults, sample2Species, window) {
    // Initialize an empty distance map
    const distanceMap = {};

    for (const compareResult of compareResults) {
        if ((checkFileName !== compareResult.sample1) && (checkFileName !== compareResult.sample2)) {
            elog(window, `Check file ${checkFileName} does not match sample names ${sample1Base} or ${sample2Base}. This should never happen.`);
            continue; // Skip this comparison if the check file does not match the sample names
        }
        const otherFile = (checkFileName === compareResult.sample1 ? compareResult.sample2 : compareResult.sample1);
        const otherFileBase = path.basename(otherFile);
        // Check if the sample names are in the sample2Species map
        if (!sample2Species.hasOwnProperty(otherFileBase)) {
            elog(window, `Sample names ${otherFileBase} not found in sample2Species map. This should never happen.`);
            continue; // Skip this comparison if the sample names are not found
        }
        const otherSpecie = sample2Species[otherFileBase];
        const distance = compareResult.distance;
        // If the other species is not in the distance map, initialize it
        if (!distanceMap.hasOwnProperty(otherSpecie)) {
            distanceMap[otherSpecie] = [];
        }
        // Add the distance to the distance map
        distanceMap[otherSpecie].push(distance);
    }
    // Create an average distance map from the distance map
    const averageDistanceMap = [];
    for (const otherSpecie in distanceMap) {
        const distances = distanceMap[otherSpecie];
        // Calculate the average distance
        const averageDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
        averageDistanceMap.push({ species: otherSpecie, distance: averageDistance });
    }

    // Sort the average distance map by distance
    const sortedDistanceMap = averageDistanceMap.sort((a, b) => a.distance - b.distance);

    return sortedDistanceMap;

}

function parseCompareMS2JSON(jsonFile) {
    // This function parses the JSON file created by compareMS2 and returns an array of objects
    // with the following properties:  'sample1', 'sample2','distance'
    const jsonData = fs.readFileSync(jsonFile, 'utf8');
    const data = JSON.parse(jsonData);

    file1 = data.datasetA;
    file2 = data.datasetB;
    distance = data.setDistance;
    return {
        sample1: file1,
        sample2: file2,
        distance: distance,
    };
}

exports.showS2SWindow = showS2SWindow;
exports.initS2S = initS2S;
