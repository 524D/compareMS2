// SPDX-License-Identifier: MIT
// Copyright 2022 Rob Marissen.

// Get list of MGF files in dir
const fs = require('fs');
const crypto = require('crypto');

function getMgfFiles(dir) {
    var mgfFiles = [];
    try {
        fs.readdirSync(dir).forEach(function (file) {
            if (file.search(/\.mgf$/i) != -1) {
                mgfFiles.push(file);
            }
        });
    }
    catch (err) {
        console.log("Cant read dir: ", err.message);
    }
    return mgfFiles;
}

// Return an hexadecimal hash from an object
// The hash is the first 24 (for brevity) hex characters
// of the SHA256 hash of the JSON representation of the object
function shortHashObj(obj) {
    const json = JSON.stringify(obj);
    let sha256 = crypto.createHash('sha256');
    let hex = sha256.update(json).digest('hex');
    return hex.substr(0, 24)
}

window.nodeRequire = require;
delete window.require;
delete window.exports;
delete window.module;
