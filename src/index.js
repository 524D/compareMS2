// SPDX-License-Identifier: MIT
// Copyright 2022 Rob Marissen.

const { BrowserWindow, getCurrentWindow } = nodeRequire('electron').remote
const path = nodeRequire('path')
const { ipcRenderer } = nodeRequire('electron')
var appVersion = nodeRequire('electron').remote.app.getVersion();

const selectDirBtn = document.getElementById('select-directory')
const selectSpeciesfileBtn = document.getElementById('select-speciesfile')

var s2sFileManualSet = false;

const homedir = nodeRequire('os').homedir();

const defaultOptions = {
  mgfDir: homedir,
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
  scaling: 0.5,
  noise: 10,
  metric: 2,
  qc: 0,
  topN: -1,
  s2sFile: homedir,
  outBasename: "comp",
  avgSpecie: true,
  outNexus: false,
  outMega: true,
  impMissing: false,
  compareOrder: "smallest-largest",
}

// Set all user interface elements according to options
function setOptions(options) {
  document.getElementById("mgfdir").value = options.mgfDir;
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
  document.getElementById("scaling").value = options.scaling;
  document.getElementById("noise").value = options.noise;
  document.getElementById("metric").value = options.metric;
  document.getElementById("qc").value = options.qc;
  document.getElementById("topN").value = options.topN;
  document.getElementById("s2sfile").value = options.s2sFile;
  document.getElementById("outbasename").value = options.outBasename;
  document.getElementById("avgspecie").checked = options.avgSpecie;
  document.getElementById("outnexus").checked = options.outNexus;
  document.getElementById("outmega").checked = options.outMega;
  document.getElementById("impmiss").checked = options.impMissing;
  document.getElementById("compare-order").value = options.compareOrder;
  updateMgfInfo(options.mgfDir);
}

// Get all values set by user
function getOptions() {
  var options = {
    mgfDir: document.getElementById("mgfdir").value,
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
    scaling: parseFloat(document.getElementById("scaling").value),
    noise: parseFloat(document.getElementById("noise").value),
    metric: parseFloat(document.getElementById("metric").value),
    qc: parseFloat(document.getElementById("qc").value),
    topN: parseFloat(document.getElementById("topN").value),
    s2sFile: document.getElementById("s2sfile").value,
    outBasename: document.getElementById("outbasename").value,
    avgSpecie: document.getElementById("avgspecie").checked,
    outNexus: document.getElementById("outnexus").checked,
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
  document.getElementById("submit").disabled = (nMgf < 2);
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

// Update MGF info on manual input
const inputHandler = function (e) {
  updateMgfInfo(e.target.value);
}
document.getElementById("mgfdir").addEventListener('input', inputHandler);

// Handle browse buttons
selectDirBtn.addEventListener('click', (event) => {
  ipcRenderer.send('open-dir-dialog')
})

selectSpeciesfileBtn.addEventListener('click', (event) => {
  ipcRenderer.send('open-speciesfile-dialog')
})

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

ipcRenderer.on('selected-speciesfile', (event, p) => {
  var fn = `${p}`;
  document.getElementById("s2sfile").value = fn;
  s2sFileManualSet = true;
})

// Handle submit button
const submitBtn = document.getElementById('submit');
submitBtn.addEventListener('click', (event) => {
  var params = getOptions();
  ipcRenderer.send('maketree', params)
})

// Show version
const versDiv = document.getElementById('versioninfo');
versDiv.innerHTML = "version: " + appVersion;
