// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// This file contains the part of the main process that relates to the spectra2species functionality.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');

let s2sWindows = [];
let s2sParams = [];
let s2sInstanceCount = 0;

var compareMS2exe = null; // Path to the compareMS2 executable
var compToDistExe = null; // Path to the compareMS2_to_distance_matrices executable

function initS2S() {
    setExe();
    ipcMain.on('s2s-stop', (event, p) => {
    })

    ipcMain.on('s2s-pause', (event, p) => {
    })

    ipcMain.on('s2s-continue', (event, p) => {
    })
}

function setExe() {
    const myPath = app.getAppPath();

    if (process.platform === 'linux' && process.arch === 'x64') {
        compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
    } else if (process.platform === 'win32' && process.arch === 'x64') {
        compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2.exe');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices.exe');
    }
    else if (process.platform == 'darwin') {
        compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2_darwin');
        compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices_darwin');
    } else {
        console.error('Unsupported platform: ' + process.platform);
        return;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to show the Spectra2Species window
function showS2SWindow(mainWindow, icon, params) {
    let s2sWindow = new BrowserWindow({
        width: 1200,
        height: 950,
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
