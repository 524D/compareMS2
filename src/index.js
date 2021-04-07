const {BrowserWindow, getCurrentWindow} = nodeRequire('electron').remote
const path = nodeRequire('path')
const {ipcRenderer} = nodeRequire('electron')
var appVersion = nodeRequire('electron').remote.app.getVersion();

const selectDirBtn = document.getElementById('select-directory')
const selectSpeciesfileBtn = document.getElementById('select-speciesfile')

var s2sFileManualSet = false;

const homedir = nodeRequire('os').homedir();

const defaultOptions = {
  mgfDir: homedir,
  precMassDiff: 2.05,
  chromPeakW: 1500,
  captureLog: true,
  richOutput: true,
  s2sFile: homedir,
  outBasename: "comp",
  cutoff: 0.8,
  avgSpecie: true,
  outNexus: false,
  outMega: true,
  impMissing: false,
  compareOrder: "smallest-largest",
}

// Set all user interface elements according to options
function setOptions(options) {
  document.getElementById("mgfdir").value = options.mgfDir;
  document.getElementById("precmassdif").value = options.precMassDiff;
  document.getElementById("chrompeakw").value = options.chromPeakW;
  document.getElementById("capturelog").checked = options.captureLog;
  document.getElementById("richoutput").checked = options.richOutput;
  document.getElementById("s2sfile").value = options.s2sFile;
  document.getElementById("outbasename").value = options.outBasename;
  document.getElementById("cutoff").value = options.cutoff;
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
    mgfDir : document.getElementById("mgfdir").value,
    precMassDiff : parseFloat(document.getElementById("precmassdif").value),
    chromPeakW : parseFloat(document.getElementById("chrompeakw").value),
    captureLog : document.getElementById("capturelog").checked,
    richOutput : document.getElementById("richoutput").checked,
    s2sFile : document.getElementById("s2sfile").value,
    outBasename : document.getElementById("outbasename").value,
    cutoff : parseFloat(document.getElementById("cutoff").value),
    avgSpecie : document.getElementById("avgspecie").checked,
    outNexus : document.getElementById("outnexus").checked,
    outMega : document.getElementById("outmega").checked,
    impMissing : document.getElementById("impmiss").checked,
    compareOrder : document.getElementById("compare-order").value,
  }
  return options;
}

function loadOptionsFromFile(fn, processOpts) {
  fs.readFile(fn, 'utf-8', (err, data) => {
    if(err){
        alert("An error ocurred reading the file :" + err.message);
        return;
    }
    else {
      const options=JSON.parse(data);
      processOpts(options);
    }
  });
}

function saveOptionsToFile(fn, options) {
  try { fs.writeFileSync(fn, JSON.stringify(options, null, 2), 'utf-8'); }
  catch(e) { alert('Failed to save options file'); }
}

// Update MGF files info
// FIXME: update info only after waiting some time
function updateMgfInfo(path) {
  const mgfinfo = document.getElementById('mgfinfo');
  var mgfFiles = getMgfFiles(path);
  var nMgf = mgfFiles.length;
  mgfinfo.innerHTML = nMgf + " MGF files, " + (nMgf * (nMgf -1))/2 + " comparisons.";
  // Disable submit button if < 2 MGF files
  document.getElementById("submit").disabled = (nMgf<2);
}

// *******************************start of initialization ******************************************** //

// Set defaults for input fields
setOptions(defaultOptions);

// Update MGF info on manual input
const inputHandler = function(e) {
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
  var fn=`${p}`;
  loadOptionsFromFile(fn, setOptions);
})

ipcRenderer.on('save-options', (event, p) => {
  var fn=`${p}`;
  saveOptionsToFile(fn, getOptions());
})

ipcRenderer.on('reset-options', (event, p) => {
  setOptions(defaultOptions);
})

ipcRenderer.on('selected-directory', (event, p) => {
  var fn=`${p}`;
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
  var fn=`${p}`;
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
