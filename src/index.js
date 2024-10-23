// SPDX-License-Identifier: MIT
// Copyright 2022 Rob Marissen.

const { BrowserWindow, app } = nodeRequire('@electron/remote')
const path = nodeRequire('path')
const { ipcRenderer } = nodeRequire('electron')
var appVersion = app.getVersion();

const selectDirBtn = document.getElementById('select-directory')
const selectFile1Btn = document.getElementById('select-file1')
const selectFile2Btn = document.getElementById('select-file2')
const selectSpeciesfileBtn = document.getElementById('select-speciesfile')

var s2sFileManualSet = false;

const homedir = nodeRequire('os').homedir();

const defaultOptions = {
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
}

// Set all user interface elements according to options
function setOptions(options) {
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
    updateMgfInfo(options.mgfDir);
}

// Get all values set by user
function getOptions() {
    var options = {
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
    }
    return options;
}

function loadOptionsFromFile(fn, processOpts) {
    fs.readFile(fn, 'utf-8', (err, data) => {
        if (err) {
            alert("An error ocurred reading the file :" + err.message);
            return;
        }
        else {
            const options = JSON.parse(data);
            processOpts(options);
        }
    });
}

function saveOptionsToFile(fn, options) {
    try { fs.writeFileSync(fn, JSON.stringify(options, null, 2), 'utf-8'); }
    catch (e) { alert('Failed to save options file'); }
}

// Update MGF files info
// FIXME: update info only after waiting some time
function updateMgfInfo(path) {
    const mgfinfo = document.getElementById('mgfinfo');
    var mgfFiles = getMgfFiles(path);
    var nMgf = mgfFiles.length;
    mgfinfo.innerHTML = nMgf + " MGF files, " + (nMgf * (nMgf - 1)) / 2 + " comparisons.";
    // Disable submit button if < 2 MGF files
    updateSubmitButton();
}

function getCmpMode() {
    const mode = $('input[name="cmpmode"]:checked').val();
    return mode;
}

// Enable or disable submit button
// The submit button is enabled if:
// - the compare mode is "compare" and both files are selected
// - the compare mode is "tree" and a folder is selected, and the
//     folder contains at least 2 MGF files
function updateSubmitButton() {
    const mode = getCmpMode()
    let enabled = false;
    if (mode == "heatmap") {
        if ($('#file1').val()) {
            enabled = true;
        }
    }
    else { // mode == "tree" 
        if ( $('#mgfdir').val() ) {
            const mgfFiles = getMgfFiles($('#mgfdir').val());
            if (mgfFiles.length >= 2) {
                enabled = true;
            }
        }
    }
    $('#submit').prop('disabled', !enabled);
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

// Set defaults for input fields
setOptions(defaultOptions);

// Grey out the elements that are not needed for the selected compare mode
updateCmpModeElems()

// Update MGF info on manual input
const inputHandler = function (e) {
    updateMgfInfo(e.target.value);
}
document.getElementById("mgfdir").addEventListener('input', inputHandler);

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
$('.cmpmode').change(function() {
    updateCmpModeElems();
    updateSubmitButton();
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
ipcRenderer.on('load-options', (event, p) => {
    var fn = `${p}`;
    loadOptionsFromFile(fn, setOptions);
})

ipcRenderer.on('save-options', (event, p) => {
    var fn = `${p}`;
    saveOptionsToFile(fn, getOptions());
})

ipcRenderer.on('reset-options', (event, p) => {
    setOptions(defaultOptions);
})

ipcRenderer.on('selected-directory', (event, p) => {
    var fn = `${p}`;
    document.getElementById("mgfdir").value = fn;
    updateMgfInfo(fn);
    // If sample-to-species file was not manually set, check if
    // a file named 'sample_to_species.txt' exists in the selected
    // dir, and set the path if so.
    if (!s2sFileManualSet) {
        const s2sFn = path.join(fn, "sample_to_species.txt");// p+"/sample_to_species.txt"; 
        fs.access(s2sFn, fs.F_OK, (err) => {
            if (err) {
                return
            }
            document.getElementById("s2sfile").value = s2sFn;
        });
    }
})

ipcRenderer.on('selected-file1', (event, p) => {
    var fn = `${p}`;
    document.getElementById("file1").value = fn;
    updateSubmitButton();    
})

ipcRenderer.on('selected-file2', (event, p) => {
    var fn = `${p}`;
    document.getElementById("file2").value = fn;
    updateSubmitButton();    
})

ipcRenderer.on('selected-speciesfile', (event, p) => {
    var fn = `${p}`;
    document.getElementById("s2sfile").value = fn;
    s2sFileManualSet = true;
})

ipcRenderer.on('show-about', (event) => {
    $('#about').show();
});

// Handle submit button
const submitBtn = document.getElementById('submit');
submitBtn.addEventListener('click', (event) => {
    var params = getOptions();
    // Check if we should show phylogenetic tree or show spectral comparison
    const mode = getCmpMode();
    if (mode == "heatmap"){
        ipcRenderer.send('compareSpecs', params)
    }
    else {
        ipcRenderer.send('maketree', params)
    }
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