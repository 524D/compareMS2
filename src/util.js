// Get list of MGF files in dir
const fs = require('fs');
function getMgfFiles(dir) {
  var mgfFiles=[];
  try { 
    fs.readdirSync(dir).forEach(function (file) {
      if (file.search(/\.mgf$/i) != -1) {
          mgfFiles.push(file);
        }
    });
  }
  catch(err) {
    console.log("Cant read dir: ", err.message);
  }
  return mgfFiles;
}
