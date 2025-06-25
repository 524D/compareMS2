// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.
const searchParams = new URLSearchParams(window.location.search);
const appVersion = searchParams.get('version') || 'unknown';

const selectDirBtn = document.getElementById('select-directory');
const selectFile1Btn = document.getElementById('select-file1');
const selectFile2Btn = document.getElementById('select-file2');
const selectSpeciesfileBtn = document.getElementById('select-speciesfile');

// Info on number of comparisons and Submit button state
// for each compare mode
// The first element is a string with the info text,
// the second element is a boolean indicating if the submit button should be enabled,
var computedItems = {
    'phyltree': ['', false],
    'heatmap': ['', false],
    'spec-to-species': ['', false]
};

// On document ready, request the options from the main process
document.addEventListener('DOMContentLoaded', function () {
    // Request the options from the main process
    window.electronAPI.requestOptions();
});

// Set all user interface elements according to options
function setOptions(options) {
    // Set compare mode
    const cmpMode = options.compareMode;
    document.querySelectorAll('input[name="cmpmode"]').forEach(function (radio) {
        radio.checked = (radio.value === cmpMode);
    });

    document.getElementById("mgfdir").value = options.mgfDir;
    document.getElementById("file1").value = options.mzFile1;
    document.getElementById("file2").value = options.mzFile2;
    document.getElementById("precmassdif").value = options.maxPrecursorDifference;
    document.getElementById("minBasepeakIntensity").value = options.minBasepeakIntensity;
    document.getElementById("minTotalIonCurrent").value = options.minTotalIonCurrent;
    document.getElementById("maxRTDifference").value = options.maxRTDifference;
    document.getElementById("startRT").value = options.startRT;
    document.getElementById("endRT").value = options.endRT;
    document.getElementById("maxscannumberdifference").value = options.maxScanNumberDifference;
    document.getElementById("startScan").value = options.startScan;
    document.getElementById("endScan").value = options.endScan;
    document.getElementById("cutoff").value = options.cutoff;
    document.getElementById("specMetric").value = options.specMetric;
    document.getElementById("scaling").value = options.scaling;
    document.getElementById("noise").value = options.noise;
    document.getElementById("metric").value = options.metric;
    document.getElementById("qc").value = options.qc;
    document.getElementById("topN").value = options.topN;
    document.getElementById("s2sfile").value = options.s2sFile;
    document.getElementById("outbasename").value = options.outBasename;
    document.getElementById("avgspecie").checked = options.avgSpecie;
    document.getElementById("outnexus").checked = options.outNexus;
    document.getElementById("outnewick").checked = options.outNewick;
    document.getElementById("outmega").checked = options.outMega;
    document.getElementById("impmiss").checked = options.impMissing;
    document.getElementById("compare-order").value = options.compareOrder;
    document.getElementById("keepsetting").value = options.keepSettings;
}

// Get all values set by user
function getOptions() {
    var options = {
        compareMode: document.querySelector('input[name="cmpmode"]:checked').value,
        mgfDir: document.getElementById("mgfdir").value,
        mzFile1: document.getElementById("file1").value,
        mzFile2: document.getElementById("file2").value,
        maxPrecursorDifference: parseFloat(document.getElementById("precmassdif").value),
        minBasepeakIntensity: parseFloat(document.getElementById("minBasepeakIntensity").value),
        minTotalIonCurrent: parseFloat(document.getElementById("minTotalIonCurrent").value),
        maxRTDifference: document.getElementById("maxRTDifference").value,
        startRT: document.getElementById("startRT").value,
        endRT: document.getElementById("endRT").value,
        maxScanNumberDifference: parseFloat(document.getElementById("maxscannumberdifference").value),
        startScan: parseFloat(document.getElementById("startScan").value),
        endScan: parseFloat(document.getElementById("endScan").value),
        cutoff: parseFloat(document.getElementById("cutoff").value),
        specMetric: parseFloat(document.getElementById("specMetric").value),
        scaling: parseFloat(document.getElementById("scaling").value),
        noise: parseFloat(document.getElementById("noise").value),
        metric: parseFloat(document.getElementById("metric").value),
        qc: parseFloat(document.getElementById("qc").value),
        topN: parseFloat(document.getElementById("topN").value),
        s2sFile: document.getElementById("s2sfile").value,
        outBasename: document.getElementById("outbasename").value,
        avgSpecie: document.getElementById("avgspecie").checked,
        outNexus: document.getElementById("outnexus").checked,
        outNewick: document.getElementById("outnewick").checked,
        outMega: document.getElementById("outmega").checked,
        impMissing: document.getElementById("impmiss").checked,
        compareOrder: document.getElementById("compare-order").value,
        keepSettings: document.getElementById("keepsetting").value,
    };
    return options;
}

function getCmpMode() {
    const mode = document.querySelector('input[name="cmpmode"]:checked').value;
    return mode;
}

// Update elements in the main window
// This is called when the compare mode is changed or when the options are updated
// It updates the MGF info and the submit button.
function updateMainWindowItems() {
    // Get the current compare mode
    const mode = getCmpMode();
    // Update the MGF info
    const mgfinfo = document.getElementById('mgfinfo');
    mgfinfo.innerHTML = computedItems[mode][0];

    // Enable/disable elements depending on compare mode
    // Elements that must be set have class "enable_in_mode"
    // plus the mode name, e.g. "enable_in_mode compare"
    // This is done by adding/removing the class "disabled-area",
    // which makes the elements partly transparent and disables them.
    document.querySelectorAll(`.enable_in_mode.${mode}`).forEach(element => {
        element.classList.remove("disabled-area");
    });

    document.querySelectorAll('.enable_in_mode').forEach(element => {
        if (!element.classList.contains(mode)) {
            element.classList.add("disabled-area");
        }
    });

    // Update the submit button state
    let enabled = computedItems[mode][1];
    document.getElementById('submit').disabled = !enabled;
}

function openTab(evt, tabName) {
    // Declare all variables
    var i, tabcontent, tablinks;

    // Get all elements with class="tabcontent" and hide them
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Get all elements with class="tablinks" and remove the class "active"
    tablinks = document.getElementsByClassName("tablinks");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    // Show the current tab, and add an "active" class to the button that opened the tab
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

// *******************************start of initialization ******************************************** //

// Handle browse buttons
selectDirBtn.addEventListener('click', (event) => {
    window.electronAPI.openDirDialog();
});

selectFile1Btn.addEventListener('click', (event) => {
    window.electronAPI.openFile1Dialog();
});

selectFile2Btn.addEventListener('click', (event) => {
    window.electronAPI.openFile2Dialog();
});

selectSpeciesfileBtn.addEventListener('click', (event) => {
    window.electronAPI.openSpeciesfileDialog();
});

// Handle compare mode selection
document.querySelectorAll('.cmpmode').forEach(radio => {
    radio.addEventListener('change', function () {
        updateMainWindowItems();
    });
});

// Handle the "Compare only N most intense spectra" input
// Init 
document.getElementById('topN').style.display = 'none';

document.getElementById('topAll').addEventListener('change', function () {
    if (this.checked) {
        document.getElementById('topN').style.display = 'none';
        document.getElementById('topN').value = -1;
    }
    else {
        document.getElementById('topN').style.display = 'block';
        document.getElementById('topN').value = 1000;
    }
});

// Handle closing the "about" overlay
document.getElementById("about-close").addEventListener('click', function () {
    document.getElementById('about').style.display = 'none';
});

// This function handles the request for options from the main process
// It is called when the menu option "Save Options" is clicked
window.electronAPI.onSaveOptions(() => {
    const options = getOptions();
    // Send message to main process to save options
    window.electronAPI.storeOptions(options);
});

// This function handles the update of options from the main process
// It is called when the main process sends an update for options,
// such as when the app starts or when options are loaded through the menu
window.electronAPI.onUpdateOptions((options, mgfInfo) => {
    // Update the options in the UI
    setOptions(options);
});

// This function handles the update of computed main window items from the main process
window.electronAPI.onUpdateMainWindowItems((mainWindowsComputedItems) => {
    // Update the main window items
    computedItems = mainWindowsComputedItems;
    updateMainWindowItems();
});

// Handle submit button
const submitBtn = document.getElementById('submit');
submitBtn.addEventListener('click', (event) => {
    const params = getOptions();
    // Start the comparison in the selected mode
    const mode = getCmpMode();
    window.electronAPI.startComparison(mode, params);
});

// Show version
const versDiv = document.getElementById('versioninfo');
versDiv.innerHTML = "version: " + appVersion;

// Enable tooltips
$(document).tooltip({
    position: {
        my: "left top",
        at: "left+50 bottom-2",
        collision: "none"
    }
});

function openSourceCodeInBrowser() {
    window.electronAPI.openSourceCodeInBrowser();
}