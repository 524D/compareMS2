// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.


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
  document.getElementById("mgfdir").value = homedir
  document.getElementById("s2sfile").value = homedir

  // Handle directory browse button
  const {ipcRenderer} = require('electron')
  const selectDirBtn = document.getElementById('select-directory')
  selectDirBtn.addEventListener('click', (event) => {
    ipcRenderer.send('open-file-dialog')
  })
  ipcRenderer.on('selected-directory', (event, path) => {
    document.getElementById("mgfdir").value = `${path}`
  })


  // Handle submit button
  const {BrowserWindow} = require('electron').remote
  const path = require('path')
  const submitBtn = document.getElementById('submit')
  submitBtn.addEventListener('click', (event) => {
      const modalPath = path.join('file://', __dirname, '/tree.html')
      let win = new BrowserWindow({ width: 1200, height: 1000 })

      win.on('close', () => { win = null })
      win.removeMenu()
      win.loadURL(modalPath)
      win.show()
  })


const fs = require('fs');
fs.readdir(__dirname, function (err, files) {
    //handling error
    if (err) {
        return console.log('Unable to scan directory: ' + err);
    } 
    //listing all files using forEach
    files.forEach(function (file) {
        if (file.search(/\.mgf$/i) == -1) {
        // Do whatever you want to do with the file
        console.log(file); 
        }
    });
});
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
