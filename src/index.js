const {BrowserWindow, getCurrentWindow} = nodeRequire('electron').remote
const path = nodeRequire('path')
const {ipcRenderer} = nodeRequire('electron')

// Update MGF files info
// FIXME: update info only after waiting some time
function updateMgfInfo(path) {
    const mgfinfo = document.getElementById('mgfinfo');
    var mgfFiles = getMgfFiles(path);
    var nMgf = mgfFiles.length;
    mgfinfo.innerHTML = nMgf + " MGF files, " + (nMgf * (nMgf -1))/2 + " comparisons.";
}

// Set initial value of MGF files info
updateMgfInfo(document.getElementById("mgfdir").value);

// Update MGF info on manual input
const inputHandler = function(e) {
updateMgfInfo(e.target.value);
}
mgfdir.addEventListener('input', inputHandler);

// Handle directory browse button
const selectDirBtn = document.getElementById('select-directory')

selectDirBtn.addEventListener('click', (event) => {
  ipcRenderer.send('open-dir-dialog')
})

ipcRenderer.on('selected-directory', (event, path) => {
  var p=`${path}`;
  document.getElementById("mgfdir").value = p;
  updateMgfInfo(p);
})

  // Handle submit button
const submitBtn = document.getElementById('submit');
submitBtn.addEventListener('click', (event) => {
  var params = {
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
    outNeely : document.getElementById("outneely").checked,
    impMissing : document.getElementById("impmiss").checked,
  }
  const modalPath = path.join('file://', __dirname, '/tree.html')
  let win = new BrowserWindow({
      width: 1200,
      height: 1000,
      parent: getCurrentWindow(),
      modal: true })

  win.on('close', () => { win = null })
  win.removeMenu()
  win.loadURL(modalPath)
  win.show()
  ipcRenderer.send('userparams', params)
})
