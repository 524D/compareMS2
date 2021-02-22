// All of the Node.js APIs are available in the preload process.
window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }

  // Set initial values for MGF directory and species file
  const homedir = require('os').homedir();
  const mgfdir = document.getElementById("mgfdir");
  const s2sfile = document.getElementById("s2sfile");
  mgfdir.value = homedir
  s2sfile.value = homedir

  
  // Update MGF files info
  const mgfinfo = document.getElementById('mgfinfo');
  
  // FIXME: update info only after waiting some time
  function updateMgfInfo(path) {
    mgfFiles = getMgfFiles(path);
    nMgf = mgfFiles.length;
    mgfinfo.innerHTML = nMgf + " MGF files, " + (nMgf * (nMgf -1))/2 + " comparisons.";
  }

  // Set initial value
  updateMgfInfo(document.getElementById("mgfdir").value);

  // Update on manual input
  const inputHandler = function(e) {
    updateMgfInfo(e.target.value);
  }
  mgfdir.addEventListener('input', inputHandler);
  
  // Handle directory browse button
  const {ipcRenderer} = require('electron')
  const selectDirBtn = document.getElementById('select-directory')
  
  selectDirBtn.addEventListener('click', (event) => {
    ipcRenderer.send('open-dir-dialog')
  })

  ipcRenderer.on('selected-directory', (event, path) => {
    p=`${path}`;
    document.getElementById("mgfdir").value = p;
    updateMgfInfo(p);
  })

  // Handle submit button
  const {BrowserWindow} = require('electron').remote
  const {getCurrentWindow} = require('electron').remote
  const path = require('path')
  const submitBtn = document.getElementById('submit')
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


  // const {spawn} = require('electron').remote.require('spawn')

  // const { spawn } = require('child_process');
  // const ls = spawn('ls', ['-lh', '/usr']);
  
  // ls.stdout.on('data', (data) => {
  //   console.log(`stdout: ${data}`);
  // });
  
  // ls.stderr.on('data', (data) => {
  //   console.error(`stderr: ${data}`);
  // });
  
  // ls.on('close', (code) => {
  //   console.log(`child process exited with code ${code}`);
  // });


})
