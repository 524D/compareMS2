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
    for (const sampleFn of sampleFiles) {
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
    for (const sampleFn of sampleFiles) {
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
        height: 720,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            enableRemoteModule: true,
            contextIsolation: true,
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

async function runS2S(params, window) {
    // Start the spectra2species run

    // Sleep for 2 seconds
    await sleep(2000);

    const dummy = option = {
        xAxis: {
            type: 'category',
            data: ['Cow', 'Horse', 'Human', 'T.Rex', 'E.T.', 'Ant', 'Soy bean']
        },
        yAxis: {
            type: 'value'
        },
        series: [
            {
                data: [
                    {
                        value: 99,
                        itemStyle: {
                            color: '#a900A0'
                        }
                    },
                    {
                        value: 50,
                        itemStyle: {
                            color: '#8844A0'
                        }
                    },
                    {
                        value: 20,
                        itemStyle: {
                            color: '#7844A0'
                        }
                    },
                    {
                        value: 15,
                        itemStyle: {
                            color: '#6844A0'
                        }
                    },
                    {
                        value: 14,
                        itemStyle: {
                            color: '#5844A0'
                        }
                    },
                    {
                        value: 10,
                        itemStyle: {
                            color: '#4844A0'
                        }
                    },
                    {
                        value: 6,
                        itemStyle: {
                            color: '#3844A0'
                        }
                    }
                ],
                type: 'bar'
            }
        ]
    };

    window.webContents.send('updateEchartJSON', dummy);

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
    for (const sampleFile of sampleFiles) {
        const sampleFileFull = path.join(params.mgfDir, sampleFile);
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
            const spawnSync = require('child_process').spawnSync;
            try {
                spawnSync(compareMS2exe, cmdArgs, { windowsHide: true, stdio: 'inherit' });
                console.log('Compare file created: ' + cmpFile);
            } catch (error) {
                console.error('Error running compareMS2:', error);
                continue; // Skip to the next sample file if there is an error
            }
        }
        // Rename the output file to the final name
        if (fs.existsSync(cmpFileJSON)) {
            fs.renameSync(comparems2tmpJSON, cmpFileJSON);
            fs.renameSync(comparems2tmp, cmpFile);
            llog(window, 'Compare file created: ' + cmpFileJSON);
        }
    }
}

// This function reads an array of compareFiles and returns a maps of distances
// for each specie in the sample2SpeciesFile. The compareFiles are expected to be
// in the format created by compareMS2, and the sample2SpeciesFile is expected to
// be a tab-separated file with two columns: sample name and species name.
function comparisons2Distance(specie, compareFiles, sample2SpeciesFile) {

    // Check if the compareFiles array is empty
    if (compareFiles.length === 0) {
        console.error('No compare files provided.');
        return [];
    }
    // Check if the sample2SpeciesFile exists
    if (!fs.existsSync(sample2SpeciesFile)) {
        console.error('Sample to species file does not exist: ' + sample2SpeciesFile);
        return [];
    }

    // Initialize an empty distance map
    const distanceMap = {};

    // Read sample2SpeciesFile into an array of strings
    const sample2SpeciesRaw = fs.readFileSync(sample2SpeciesFile, 'utf8');
    const sample2SpeciesRaw1 = sample2SpeciesRaw.split('\n').filter(line => line.trim() !== ''); // Remove empty lines

    const sample2Species = ensureSample2Species(sample2SpeciesRaw1, compareFiles);

    for (const compareFile of compareFiles) {
        const parsedData = parseCompareMS2JSON(compareFile);
        const specie1 = sample2Species[parsedData.sample1];
        const specie2 = sample2Species[parsedData.sample2];
        const distance = parsedData.distance;
        // Check if the species match the given specie
        if (specie1 === specie || specie2 === specie) {
            const otherSpecie = specie1 === specie ? specie2 : specie1;
            // If the other species is not in the distance map, initialize it
            if (!distanceMap.hasOwnProperty(otherSpecie)) {
                distanceMap[otherSpecie] = [];
            }
            // Add the distance to the distance map
            distanceMap[otherSpecie].push(distance);
        }
    }
    // Create an average distance map from the distance map
    const averageDistanceMap = {};
    for (const otherSpecie in distanceMap) {
        //        if (distanceMap.hasOwnProperty(otherSpecie)) {
        const distances = distanceMap[otherSpecie];
        // Calculate the average distance
        const averageDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
        averageDistanceMap[otherSpecie] = averageDistance;
        //        }
    }

    // Sort the average distance map by distance
    const sortedDistanceMap = Object.entries(averageDistanceMap).sort((a, b) => a[1] - b[1]);

    return sortedDistanceMap;

}

// This function converts a raw sample2Species file into a dictionary
// where the keys are the sample names and the values are the species names.
// Furthermore, it checks if all samples in sampleFiles are present in the sample2SpeciesRaw file,
// and if not, it adds them with the species name that is equal to the sample name
function ensureSample2Species(sample2SpeciesRaw, sampleFiles) {
    const sample2Species = {};
    const lines = sample2SpeciesRaw.split('\n');

    // Parse the sample2SpeciesRaw file
    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length === 2) {
            const sample = parts[0].trim();
            const species = parts[1].trim();
            sample2Species[sample] = species;
        }
    }

    // Ensure all samples in sampleFiles are present in sample2Species
    for (const sample of sampleFiles) {
        if (!sample2Species.hasOwnProperty(sample)) {
            sample2Species[sample] = path.basename(sample, path.extname(sample)); // Use the sample name as species name
        }
    }

    return sample2Species;
}

function parseCompareMS2JSON(jsonFile) {
    // This function parses the JSON file created by compareMS2 and returns an array of objects
    // with the following properties:  'sample1', 'sample2','distance'
    const jsonData = fs.readFileSync(jsonFile, 'utf8');
    const data = JSON.parse(jsonData);

    file1 = path.basename(data.datasetA);
    file2 = path.basename(data.datasetB);
    distance = data.setDistance;
    return {
        sample1: file1,
        sample2: file2,
        distance: distance,
    };
}

exports.showS2SWindow = showS2SWindow;
exports.initS2S = initS2S;
