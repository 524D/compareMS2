// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

const { app } = nodeRequire('@electron/remote')
const { ipcRenderer } = nodeRequire('electron')
var appVersion = app.getVersion();

// Info on number of comparisons and Submit button state
// for each compare mode
// The first element is a string with the info text,
// the second element is a boolean indicating if the submit button should be enabled,
var computedItems = {
    'phyltree': ['', false],
    'heatmap': ['', false],
    'spec-to-species': ['', false]
}

const keepSettingsFn = `${nodeRequire('os').homedir()}/comparems2options.json`;
const selectDirBtn = document.getElementById('select-directory')
const selectFile1Btn = document.getElementById('select-file1')
const selectFile2Btn = document.getElementById('select-file2')
const selectSpeciesfileBtn = document.getElementById('select-speciesfile')

var s2sFileManualSet = false;

var mgfDirFull = {
    dir: "",
    mgfFiles: [],
    s2sFile: "",
};

const homedir = nodeRequire('os').homedir();

const defaultOptions = {
    compareMode: "phyltree",
    mgfDir: homedir,
    mzFile1: "",
    mzFile2: "",
    maxPrecursorDifference: 2.05,
    minBasepeakIntensity: 10000,
    minTotalIonCurrent: 0,
    maxRTDifference: 60,
    startRT: 0,
    endRT: 100000,
    maxScanNumberDifference: 10000,
    startScan: 1,
    endScan: 1000000,
    cutoff: 0.8,
    specMetric: 0,
    scaling: 1.0,
    noise: 10,
    metric: 2,
    qc: 0,
    topN: -1,
    s2sFile: homedir,
    outBasename: "comp",
    avgSpecie: true,
    outNexus: false,
    outNewick: false,
    outMega: true,
    impMissing: false,
    compareOrder: "smallest-largest",
    keepSettings: true,
}

// On document ready, request the options from the main process
$(document).ready(function () {
    // Request the options from the main process
    ipcRenderer.send('request-options');
});


// Set all user interface elements according to options
function setOptions(options) {
    // Set compare mode
    const cmpMode = options.compareMode;
    $('input[name="cmpmode"]').each(function () {
        if ($(this).val() === cmpMode) {
            $(this).prop('checked', true);
        } else {
            $(this).prop('checked', false);
        }
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
    mgfDirFull.dir = options.mgfDir;
    // FIXME: also get rest of mfgDirFull.
    updateMgfInfo();
}

// Get all values set by user
function getOptions() {
    var options = {
        compareMode: $('input[name="cmpmode"]:checked').val(),
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
    }
    return options;
}

function loadOptionsFromFile(fn, processOpts) {
    fs.readFile(fn, 'utf-8', (err, data) => {
        if (err) {
            alert("An error occurred reading the file :" + err.message);
            return;
        }
        else {
            const options = JSON.parse(data);
            // Check is all options in defaultOptions are present in options
            for (const key in defaultOptions) {
                if (!options.hasOwnProperty(key)) {
                    // If not, set the default value
                    options[key] = defaultOptions[key];
                }
            }
            // Check if options.mgfDir is set, if not, set it to the home
            processOpts(options);
        }
    });
}

function saveOptionsToFile(fn, options) {
    try { fs.writeFileSync(fn, JSON.stringify(options, null, 2), 'utf-8'); }
    catch (e) { alert('Failed to save options file'); }
}

// Update MGF files info
function updateMgfInfo() {
    const mgfinfo = document.getElementById('mgfinfo');
    const mgfFiles = mgfDirFull.mgfFiles;
    const nMgf = mgfFiles.length;
    const cmpMode = getCmpMode()
    var msg = "";
    var nComp = 0;
    switch (cmpMode) {
        case "phyltree":
            nComp = (nMgf * (nMgf - 1)) / 2;
            msg = nMgf + " MGF files, " + nComp + " comparisons.";
            break;
        case "spec-to-species":
            nComp = nMgf;
            msg = nMgf + " MGF files, " + nComp + " comparisons.";
            break;
    }

    mgfinfo.innerHTML = msg;
    // Disable submit button if < 2 MGF files
    updateSubmitButton();
}

function getCmpMode() {
    const mode = $('input[name="cmpmode"]:checked').val();
    return mode;
}

function computeSubmitButtonState(mode, mgfFiles, mgfFile1) {
    let enabled = false;
    switch (mode) {
        case "phyltree":
            if (mgfFiles.length >= 2) {
                enabled = true;
            }
            break;
        case "heatmap":
            if (mgfFile1) {
                enabled = true;
            }
            break;
        case "spec-to-species":
            if (mgfFile1 && mgfFiles.length >= 2) {
                enabled = true;
            }
            break;
        default:
            break;
    }
    return enabled;
}

// Enable or disable submit button
function updateSubmitButton() {
    updateMainWindowItems();
}

// Enable/disable elements depending on compare mode
function updateCmpModeElems() {
    const mode = getCmpMode();
    // Enable/disable elements depending on compare mode
    // Elements that must be set have class "enable_in_mode"
    // plus the mode name, e.g. "enable_in_mode compare"
    // This is done by adding/removing the class "disabled-area",
    // which makes the elements partly transparent and disables them.
    $(".enable_in_mode." + mode).removeClass("disabled-area");
    $(".enable_in_mode:not(." + mode + ")").addClass("disabled-area");
}

// Update elements in the main window
// This is called when the compare mode is changed or when the options are updated
// It updates the MGF info and the submit button.
function updateMainWindowItems() {
    // Get the current compare mode
    const mode = getCmpMode();
    // Update the MGF info
    const mgfinfo = document.getElementById('mgfinfo');
    mgfinfo.innerHTML = computedItems[mode][0];;
    // Update the submit button state
    let enabled = computedItems[mode][1];;
    $('#submit').prop('disabled', !enabled);
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
    ipcRenderer.send('open-dir-dialog')
})

selectFile1Btn.addEventListener('click', (event) => {
    ipcRenderer.send('open-file1-dialog')
})

selectFile2Btn.addEventListener('click', (event) => {
    ipcRenderer.send('open-file2-dialog')
})

selectSpeciesfileBtn.addEventListener('click', (event) => {
    ipcRenderer.send('open-speciesfile-dialog')
})

// Handle compare mode selection
$('.cmpmode').change(function () {
    updateCmpModeElems();
    updateSubmitButton();
    updateMgfInfo($('#mgfdir').val());
});

// Handle the "Compare only N most intense spectra" input
// Init 
$('#topN').hide();

$('#topAll').change(function () {
    if (this.checked) {
        $('#topN').hide();
        $('#topN').val(-1)
    }
    else {
        $('#topN').show();
        $('#topN').val(1000)
    }
});

// Handle closing the "about" overlay
$("#about-close").click(function () {
    //    $("#about").removeClass( "modal" ).addClass( "hidden");
    $('#about').hide();
});

// Handle messages from main process

ipcRenderer.on('save-options', (event) => {
    const options = getOptions();
    // Send message to main process to save options
    ipcRenderer.send('store-options', options);
})

ipcRenderer.on('selected-directory', (event, p) => {
    mgfDirFull = p;
    const fn = mgfDirFull.dir;
    document.getElementById("mgfdir").value = fn;
    updateMgfInfo();
    // If sample-to-species file was not manually set, check if
    // a file named 'sample_to_species.txt' exists in the selected
    // dir, and set the path if so.
    if (!s2sFileManualSet) {
        if (mgfDirFull.s2sFn) {
            document.getElementById("s2sfile").value = mgfDirFull.s2sFn;
        }
    }
})

ipcRenderer.on('selected-file1', (event, p) => {
    var fn = `${p}`;
    document.getElementById("file1").value = fn;
})

ipcRenderer.on('selected-file2', (event, p) => {
    var fn = `${p}`;
    document.getElementById("file2").value = fn;
})

ipcRenderer.on('selected-speciesfile', (event, p) => {
    var fn = `${p}`;
    document.getElementById("s2sfile").value = fn;
    s2sFileManualSet = true;
})

ipcRenderer.on('show-about', (event) => {
    $('#about').show();
});

ipcRenderer.on('update-options', (event, options, mgfInfo) => {
    // Update the options in the UI
    setOptions(options);
    // Update the MGF info
    updateMgfInfo();
    // Update the submit button state
    updateSubmitButton();
});

ipcRenderer.on('update-main-window-items', (event, mainWindowsComputedItems) => {
    // Update the main window items
    computedItems = mainWindowsComputedItems;
    updateMainWindowItems();
});

// Handle submit button
const submitBtn = document.getElementById('submit');
submitBtn.addEventListener('click', (event) => {
    const params = getOptions();
    // Check if we should show phylogenetic tree or show spectral comparison
    const mode = getCmpMode();
    ipcRenderer.send('start-comparison', mode, params);
})

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
    ipcRenderer.send('openSourceCodeInBrowser')
}