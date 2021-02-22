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
