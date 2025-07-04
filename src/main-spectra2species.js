// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const log = require('electron-log');

const compareDirName = 'compareresult'; // Directory where the compare results are stored relative to the mgfDir

let s2sWindows = [];
let s2sParams = [];
let s2sInstanceCount = 0;

var generalParams = null;

function initS2S(genParams) {
    generalParams = genParams;

    ipcMain.on('s2s-stop', (event, p) => {
    })

    ipcMain.on('s2s-pause', (event, p) => {
    })

    ipcMain.on('s2s-continue', (event, p) => {
    })
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readSampleFiles(mgfDir) {
    // Read all files in the mgfDir directory and return an array of sample files
    if (!fs.existsSync(mgfDir)) {
        console.error('Directory does not exist: ' + mgfDir);
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

// FIXME: the following 2 functions should go into a separate module because
// they are used in other compare modes as well

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
    return hex.substr(0, 24)
}

// Output logging
function llog(window, msg) {
    log.info(msg);

    msg = msg.replace(/(?:\r\n|\r|\n)/g, '<br>');
    msg = msg.replace(/(?: )/g, '&nbsp;');
    window.webContents.send('logMessage', msg);
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
    s2sInstanceCount++;
    s2sWindows[s2sInstanceCount] = s2sWindow;

    s2sParams[s2sInstanceCount] = structuredClone(params); // Ensure params is a deep copy

    s2sWindow.on('close', () => { s2sWindow = null })
    s2sWindow.removeMenu();
    s2sWindow.loadFile(path.join(__dirname, '/spectra2species.html'),
        {
            query: {
                "userparams": JSON.stringify(params),
                "instanceId": s2sInstanceCount
            }
        });
    require("@electron/remote/main").enable(s2sWindow.webContents);
    if (typeof process.env.CPM_MS2_DEBUG !== 'undefined') {
        // Open the DevTools.
        s2sWindow.webContents.openDevTools();
    }

    s2sWindow.show();
    runS2S(params, s2sWindow);
}

// Start the spectra2species run
async function runS2S(params, window) {
    // Create directory for compare results
    const compareDir = path.join(params.mgfDir, compareDirName);
    if (!fs.existsSync(compareDir)) fs.mkdirSync(compareDir, { recursive: true });

    const sampleFiles = readSampleFiles(params.mgfDir);
    if (sampleFiles.length === 0) {
        console.error('No sample files found in directory: ' + params.mgfDir);
        return;
    }
    const sample2Species = readSample2Species(params.s2sFile, sampleFiles);

    // Compare params.mzFile1 to all files in sampleFiles
    // After each comparison compute the distances,
    // and create a JSON
    // data structure that can be used to create an eCharts bar chart
    const cmpFilesJSON = [];
    const compareResults = [];
    for (const sampleFile of sampleFiles) {
        const sampleFileFull = path.join(params.mgfDir, sampleFile);
        // Skip the mzFile1 file, it is the reference file
        if (sampleFileFull == params.mzFile1) {
            console.log('Skipping reference file: ' + sampleFileFull);
            continue;
        }
        // Convert parameters to command line arguments for the comparems2 executable
        const cmdArgs = buildCmdArgs(params.mzFile1, sampleFileFull, params);
        // Get the hash name and compare file
        const { cmpFile, cmpFileJSON, hashName } = getHashName(cmdArgs, compareDir);
        // Check if the compare file already exists
        if (fs.existsSync(cmpFileJSON)) {
            console.log('Compare file already exists: ' + cmpFileJSON);
        }
        else {

            // Temporary output filename of compare ms2
            // used to avoid stale incomplete output after interrupt
            const comparems2tmp = path.join(compareDir, hashName + "-" + s2sInstanceCount + ".tmp");
            const comparems2tmpJSON = comparems2tmp + '.json';
            // Append output filename, should not be part of hash
            cmdArgs.push('-o', comparems2tmp, '-J', comparems2tmpJSON);

            const compareMS2exe = generalParams.compareMS2Exe;
            let cmdStr = compareMS2exe + JSON.stringify(cmdArgs);
            llog(window, 'Executing: ' + cmdStr + '\n');

            // If the compare file does not exist, run the compareMS2 executable
            const spawn = require('child_process').spawn;
            try {
                await new Promise((resolve, reject) => {
                    const child = spawn(compareMS2exe, cmdArgs, { windowsHide: true, stdio: 'inherit' });

                    child.on('close', (code) => {
                        if (code === 0) {
                            console.log('Compare file created: ' + cmpFile);
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
                console.error('Error running compareMS2:', error);
                continue; // Skip to the next sample file if there is an error
            }
            // Rename the output file to the final name
            if (fs.existsSync(comparems2tmpJSON)) {
                fs.renameSync(comparems2tmpJSON, cmpFileJSON);
                fs.renameSync(comparems2tmp, cmpFile);
                llog(window, 'Compare file created: ' + cmpFileJSON);
            } else {
                llog(window, 'Compare file not created: ' + cmpFileJSON);
                continue; // Skip to the next sample file if the compare file was not created
            }
        }
        // Add the compare file to the list of compare files
        cmpFilesJSON.push(cmpFileJSON);
        // Append the compare results
        compareResults.push(parseCompareMS2JSON(cmpFileJSON));
        // Create a distance map
        const distanceMap = comparisons2Distance(params.mzFile1, compareResults, sample2Species);
        if (distanceMap.length === 0) {
            llog(window, 'No distances found for sample: ' + sampleFile);
            continue; // Skip to the next sample file if no distances were found
        }
        // Convert distances to similarities
        distanceMap.forEach(item => {
            item.similarity = distance2Similarity(item.distance);
        });
        // Create the echartData object for the eCharts bar chart
        const echartData = makeEChartsOption(distanceMap, params.mzFile1);
        await sleep(200); // FIXME: Why is this needed? Without, precomputed files don't show up in the chart

        // Send the echartData to the renderer process to update the chart
        window.webContents.send('updateEchartJSON', echartData);
        // Log the distances for debugging
        llog(window, 'Distances for sample ' + sampleFile + ': ' + JSON.stringify(distanceMap, null, 2));
    }
    // After all comparisons, send a message to the renderer process to indicate completion
    llog(window, 'Spectra2Species comparison completed successfully.');
}

// Convert distance to similarity
function distance2Similarity(distance) {
    const similarity = 1 / (1 + distance); // Convert distance to similarity
    // Round similarity to 4 decimal places
    return Math.round(similarity * 10000) / 10000;
}

// This function reads an array of results from comparisons and returns a maps of distances
// for each specie in the sample2Species (as returned by readSample2Species).
function comparisons2Distance(checkFileName, compareResults, sample2Species) {
    // Initialize an empty distance map
    const distanceMap = {};

    for (const compareResult of compareResults) {
        if ((checkFileName !== compareResult.sample1) && (checkFileName !== compareResult.sample2)) {
            console.error(`Check file ${checkFileName} does not match sample names ${sample1Base} or ${sample2Base}. This should never happen.`);
            continue; // Skip this comparison if the check file does not match the sample names
        }
        const otherFile = (checkFileName === compareResult.sample1 ? compareResult.sample2 : compareResult.sample1);
        const otherFileBase = path.basename(otherFile);
        // Check if the sample names are in the sample2Species map
        if (!sample2Species.hasOwnProperty(otherFileBase)) {
            console.error(`Sample names ${otherFileBase} not found in sample2Species map. This should never happen.`);
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

// Create the echartData object for the eCharts bar chart
function makeEChartsOption(distanceMap, mzFile1) {
    var maxVal = 1; // Set the maximum value for the visualMap to the maximum similarity value
    if (distanceMap.length > 0) {
        maxVal = Math.max(...distanceMap.map(item => item.similarity));
    }
    // Adjust the fond size according to the number of items in the distanceMap
    const fontSize = Math.max(10, 12 - Math.floor(distanceMap.length / 10)); // Decrease font size as the number of items increases, but not below 10

    return {
        title: {
            text: 'Spectra2Species Comparison for ' + path.basename(mzFile1),
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow' // Use shadow pointer for bar chart
            }
        },
        grid: {
            left: '13%',
            right: '10%',
            bottom: '2%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: distanceMap.map(item => item.species), // Use species names as x-axis
            axisLabel: {
                interval: 0, // Show all labels
                rotate: 45, // Rotate labels for better readability
                overflow: 'truncate', // Truncate labels that are too long
                textStyle: {
                    fontSize: fontSize
                }
            }
        },
        yAxis: {
            type: 'value',
            name: 'Similarity',
            axisLabel: {
                formatter: '{value}' // Format the y-axis labels
            }
        },
        visualMap: {
            max: maxVal,
        },

        series: [{
            name: 'Similarity',
            type: 'bar',
            data: distanceMap.map(item => ({
                value: item.similarity,
            })),
            emphasis: {
                focus: 'series',
                itemStyle: {
                    color: '#FF5722' // Change color on hover
                }
            }
        }]
    };
}

exports.showS2SWindow = showS2SWindow;
exports.initS2S = initS2S;
