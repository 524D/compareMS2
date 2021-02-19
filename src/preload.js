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
  const app = require('electron').remote.app
  var basepath = app.getAppPath();
  document.getElementById("mgfdir").value = basepath
  document.getElementById("s2sfile").value = basepath

  // Handle directory brows button
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


})
