// SPDX-License-Identifier: MIT
// Copyright 2022 Rob Marissen.

const { ipcRenderer } = nodeRequire('electron');
const app = nodeRequire('electron').remote.app;
const path = nodeRequire('path');
const { spawn } = nodeRequire('child_process');
const lineReader = nodeRequire('line-reader');
const log = nodeRequire('electron-log');
const downloadSvg = nodeRequire('svg-crowbar').downloadSvg;
const d3ToPng = nodeRequire('d3-svg-to-png');
const querystring = nodeRequire('querystring');
const d3 = nodeRequire('d3');
const phylotree = nodeRequire('phylotree');

const legendWidth = 320; // With of the legend

let query = querystring.parse(global.location.search);
let userparams = JSON.parse(query['?userparams']);
let instanceId = query['instanceId'];
let legendTimer;

// The color scale for converting quality values into color.
// Overwritten when min/max quality values are known
let color_scale = d3.scaleLinear().domain([0, 5, 9]).range(["#FF0000", "#0000FF", "#00FF00"]);

// Quality is stored in a map for easy/fast lookup
// There seems no way to transfer extra data to colorNodesByName 'node-styler' function,
// so this is a global variable
let qualMap = new Map();
// Maximum/min/avg of sample/species quality
let qualMax = 0;
let qualMin = 0;
let qualAvg = 0;

// Get the spectrum quality for a given specie
function specQual(specie) {
    let q = parseInt(specie.slice(-1));
    return q;
}

function colorNodesByName(element, data) {
    let specie = data.data.name;
    let q = qualMap.get(specie);
    if (q) {
        let s = color_scale(q);
        element.style("fill", s);
    }
};

let treeOptions = {
    'container': "#main-tree-item",
    'draw-size-bubbles': false,
    'brush': false, // We have no use for the brush
    'show-scale': true,
    'transitions': false,
    'zoom': false, // Zoom = true doesn't work, SVG size is not updated
    'max-radius': 2000,
    "annular-limit": 0.1, // 0.38196601125010515,
    compression: 1.0,
    "align-tips": false,
    scaling: true,
    'node-styler': colorNodesByName,
};

var test_string = "(((EELA:0.150276,CONGERA:0.213019):0.230956,(EELB:0.263487,CONGERB:0.202633):0.246917):0.094785,((CAVEFISH:0.451027,(GOLDFISH:0.340495,ZEBRAFISH:0.390163):0.220565):0.067778,((((((NSAM:0.008113,NARG:0.014065):0.052991,SPUN:0.061003,(SMIC:0.027806,SDIA:0.015298,SXAN:0.046873):0.046977):0.009822,(NAUR:0.081298,(SSPI:0.023876,STIE:0.013652):0.058179):0.091775):0.073346,(MVIO:0.012271,MBER:0.039798):0.178835):0.147992,((BFNKILLIFISH:0.317455,(ONIL:0.029217,XCAU:0.084388):0.201166):0.055908,THORNYHEAD:0.252481):0.061905):0.157214,LAMPFISH:0.717196,((SCABBARDA:0.189684,SCABBARDB:0.362015):0.282263,((VIPERFISH:0.318217,BLACKDRAGON:0.109912):0.123642,LOOSEJAW:0.397100):0.287152):0.140663):0.206729):0.222485,(COELACANTH:0.558103,((CLAWEDFROG:0.441842,SALAMANDER:0.299607):0.135307,((CHAMELEON:0.771665,((PIGEON:0.150909,CHICKEN:0.172733):0.082163,ZEBRAFINCH:0.099172):0.272338):0.014055,((BOVINE:0.167569,DOLPHIN:0.157450):0.104783,ELEPHANT:0.166557):0.367205):0.050892):0.114731):0.295021)myroot";
let tree = new phylotree.phylotree(test_string)
let rendered_tree = tree.render(treeOptions)

const compareDirName = 'compareresult'
let compareDir;

// newick format of tree
let newick = '';
// Idem, without distance info (topology only)
let topology = '';

let file1Idx;
let file2Idx;
let paramsGlobal;  // To save memory in recursive call, we store these in global variables
let mgfFilesGlobal;
let compareMS2exe;
let compToDistExe;
let compResultListFile;
const myPath = app.getAppPath();


function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Output logging
function llog(msg) {
    log.info(msg);

    msg = msg.replace(/(?:\r\n|\r|\n)/g, '<br>');
    msg = msg.replace(/(?: )/g, '&nbsp;');
    document.getElementById('stdout').innerHTML += msg;
}

function elog(msg) {
    log.error(msg);
    msg = msg.replace(/(?:\r\n|\r|\n)/g, '<br>');
    msg = msg.replace(/(?: )/g, '&nbsp;');
    msg = '<span class="warn>' + msg + '</span>';
    document.getElementById('stdout').innerHTML += msg;
}

function runToDistance(mega) {
    let cmdArgs = ['-i', compResultListFile,
        '-o', path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename),
        '-c', paramsGlobal.cutoff
    ]
    if (mega) {
        cmdArgs.push('-m');
    }

    let s2s = paramsGlobal.s2sFile;
    // If the file to species mapping file exists, use it
    if (fs.existsSync(s2s) && fs.lstatSync(s2s).isFile()) {
        cmdArgs.push('-x', s2s)
    }

    let cmdStr = compToDistExe + JSON.stringify(cmdArgs);
    llog('Executing: ' + cmdStr + '\n');
    const c2d = spawn(compToDistExe, cmdArgs);
    c2d.stdout.on('data', (data) => {
        data = escapeHtml(data.toString());
        data = data.replace(/(?:\r\n|\r|\n)/g, '<br>');
        data = data.replace(/(?: )/g, '&nbsp;');
        document.getElementById('stdout').innerHTML += data;
    });

    c2d.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    c2d.on('error', (data) => {
        console.error('Error running compareMS2_to_distance_matrices');
        act.innerHTML = 'Error running compareMS2_to_distance_matrices';
    });

    c2d.stderr.on('exit', (code, signal) => {
        console.error('Error running compareMS2_to_distance_matrices');
        act.innerHTML = 'Error running compareMS2_to_distance_matrices';
    });

    c2d.on('close', (code) => {
    });
}

function compareNext() {
    let act = document.getElementById('activity');

    // Update progress bar
    let nMgf = mgfFilesGlobal.length;
    let progress = ((file1Idx * (file1Idx - 1) / 2) + file2Idx) / (nMgf * (nMgf - 1) / 2);
    document.getElementById('progress').value = progress * 100;

    if (file1Idx >= mgfFilesGlobal.length) {
        act.innerHTML = 'Finished';
        // Disable buttons
        document.getElementById('pause').disabled = true;
        document.getElementById('details').disabled = true;
        // Hide "details" section
        $(".tvert-details").css("visibility", "hidden");
        $(".info-details").css("height", "1px");

        // Rename the result file of our instance to the final name
        const tmpResultFn = path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename) + "-" + instanceId + "_distance_matrix.meg";
        const resultFn = path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename + '_distance_matrix.meg');
        ipcRenderer.send('move-file', tmpResultFn, resultFn);
        const listFn = path.join(paramsGlobal.mgfDir, "cmp_list.txt");
        ipcRenderer.send('move-file', compResultListFile, listFn);

        if (paramsGlobal.outNewick) {
            llog('Creating Newick output');
            const newickFn = path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename) + ".nwk";
            ipcRenderer.send('write-newick', newickFn, newick + ";");
        }
        if (paramsGlobal.outNexus) {
            llog('Creating Nexus output');
            runToDistance(false);
        }
    }
    else {
        act.innerHTML = 'Comparing ' + escapeHtml(mgfFilesGlobal[file1Idx]) + ' ' + mgfFilesGlobal[file2Idx];

        let mgf1 = mgfFilesGlobal[file1Idx];
        let mgf2 = mgfFilesGlobal[file2Idx];
        // The order of input files is not important for the result.
        // We always order alphabetical, so that the check if we
        // already have the result works correctly.
        if (mgf1 > mgf2) {
            [mgf1, mgf2] = [mgf2, mgf1];
        }

        let cmdArgs =
            ['-A', mgf1,
                '-B', mgf2,
                '-p', paramsGlobal.maxPrecursorDifference,
                '-m', paramsGlobal.minBasepeakIntensity + ',' + paramsGlobal.minTotalIonCurrent,
                '-w', paramsGlobal.maxScanNumberDifference,
                '-W', paramsGlobal.startScan + ',' + paramsGlobal.endScan,
                '-r', paramsGlobal.maxRTDifference,
                '-R', paramsGlobal.startRT + ',' + paramsGlobal.endRT,
                '-c', paramsGlobal.cutoff,
                '-s', paramsGlobal.scaling,
                '-n', paramsGlobal.noise,
                '-q', paramsGlobal.qc,
                '-d', paramsGlobal.metric,
                '-N', paramsGlobal.topN,
            ]
        // Create a unique filename based on parameters
        const hashName = shortHashObj({ cmdArgs });
        let cmpFile = path.join(compareDir, hashName + ".txt");

        // Temporary output filename of compare ms2
        // used to avoid stale incomplete output after interrupt
        const comparems2tmp = path.join(compareDir, hashName + "-" + instanceId + ".tmp");

        // Append output filename, should now be part of hash
        cmdArgs.push('-o', comparems2tmp);

        let cmdStr = compareMS2exe + JSON.stringify(cmdArgs);
        llog('Executing: ' + cmdStr + '\n');

        // If this file exist, we already have the result. Skip comparison
        if (fs.existsSync(cmpFile)) {
            compareFinished(compResultListFile, cmpFile);
        }
        else {
            const cmp_ms2 = spawn(compareMS2exe, cmdArgs);

            cmp_ms2.stdout.on('data', (data) => {
                data = escapeHtml(data.toString());
                data = data.replace(/(?:\r\n|\r|\n)/g, '<br>');
                data = data.replace(/(?: )/g, '&nbsp;');
                document.getElementById('stdout').innerHTML += data;
            });

            cmp_ms2.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
                elog(data.toString());
            });

            cmp_ms2.on('error', (data) => {
                console.error('Error running compareMS2');
                act.innerHTML = 'Error running compareMS2';
            });

            cmp_ms2.stderr.on('exit', (code, signal) => {
                console.error('Error running compareMS2');
                act.innerHTML = 'Error running compareMS2';
            });

            cmp_ms2.on('close', (code, signal) => {
                if (code == null) {
                    elog("Error: comparems2 command line executable crashed.\n")
                }
                else {
                    // Compare finished, rename temporary output file
                    // to final filename
                    compareDir
                    fs.rename(comparems2tmp, cmpFile, function (err) {
                        if (err) throw err
                        compareFinished(compResultListFile, cmpFile);
                    });
                }
            });
        }
    }
}

function compareFinished(compResultListFile, cmpFile) {
    fs.appendFileSync(compResultListFile, cmpFile + "\n");
    file2Idx++;
    if (file2Idx < file1Idx) {
        // If row is not finished, schedule next comparison
        setTimeout(function () { compareNext(); }, 0);
    }
    else {
        // Finished new row, create tree
        makeTree();
    }
}

// Parse distance matrix that is output by compareMS2_to_distance_matrices
function parseDistanceMatrixLine(line, distanceParse) {
    if ((distanceParse.parseState == 'init') ||
        (distanceParse.parseState == 'labels')) {
        let s = line.match(distanceParse.reSpecies);
        if ((s) && (s.length != 0)) {
            distanceParse.parseState = 'labels';
            // Replace characters that are not allowed in a Newick string
            let specie = s[1].replace(/[ :;,()\[\]]/g, "_");
            distanceParse.labels.push(specie);
            // Store the quality score, and keep track of min/max values
            let q = parseFloat(s[2]);
            qualMap.set(specie, q);
            distanceParse.qualMin = Math.min(q, distanceParse.qualMin);
            distanceParse.qualMax = Math.max(q, distanceParse.qualMax);
            distanceParse.qualSum += q;
            distanceParse.qualN++;
        } else if (distanceParse.parseState == 'labels') {
            distanceParse.parseState = 'matrix';
        }
    }
    if (distanceParse.parseState == 'matrix') {
        if (distanceParse.reMatrix.test(line)) {
            let row = line.match(distanceParse.reMatrixCapt);
            // First one contains whole string, remove
            // row.shift();
            // Convert strings to numbers
            row = row.map(x => +x)
            distanceParse.matrix.push(row);
        }
    }
}

function makeTree() {
    let act = document.getElementById('activity');
    act.innerHTML = 'Creating tree';

    // To avoid problems when multiple compares are ran simultaneous,
    // the intermediate result file gets a "unique" name based on the instance number.
    let cmdArgs = ['-i', compResultListFile,
        '-o', path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename) + "-" + instanceId,
        '-c', paramsGlobal.cutoff,
        '-m'  // Generate MEGA format
    ]
    let s2s = paramsGlobal.s2sFile;
    // If the file to species mapping file exists, use it
    if (fs.existsSync(s2s) && fs.lstatSync(s2s).isFile()) {
        cmdArgs.push('-x', s2s)
    }

    let cmdStr = compToDistExe + JSON.stringify(cmdArgs);
    llog('Executing: ' + cmdStr + '\n');
    const c2d = spawn(compToDistExe, cmdArgs);
    c2d.stdout.on('data', (data) => {
        data = escapeHtml(data.toString());
        data = data.replace(/(?:\r\n|\r|\n)/g, '<br>');
        data = data.replace(/(?: )/g, '&nbsp;');
        document.getElementById('stdout').innerHTML += data;
    });

    c2d.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    c2d.on('error', (data) => {
        console.error('Error running compareMS2_to_distance_matrices');
        act.innerHTML = 'Error running compareMS2_to_distance_matrices';
    });

    c2d.stderr.on('exit', (code, signal) => {
        console.error('Error running compareMS2_to_distance_matrices');
        act.innerHTML = 'Error running compareMS2_to_distance_matrices';
    });

    c2d.on('close', (code) => {
        act.innerHTML = 'Computing tree';
        // Extract matrix and names from compareMS2_to_distance_matrices output
        let distanceParse = {
            parseState: 'init',
            reSpecies: /^QC\s+(.+)\s+([0-9\.]+)$/,
            reMatrix: /^[0-9. \t]+$/,
            reMatrixCapt: /([0-9\.]+)/g,
            labels: [],
            qualMin: Number.MAX_VALUE,
            qualMax: Number.MIN_VALUE,
            qualSum: 0,
            qualN: 0,
            matrix: [], // Will be filled with rows -> 2D matrix
        }
        distanceParse.matrix[0] = []; // First element must be empty
        const df = path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename) + "-" + instanceId + "_distance_matrix.meg";
        // Reading line by line
        lineReader.eachLine(df, (line, last) => {
            parseDistanceMatrixLine(line, distanceParse);
            if (distanceParse.qualN > 0) {
                qualMax = distanceParse.qualMax;
                qualMin = distanceParse.qualMin;
                qualAvg = distanceParse.qualSum / distanceParse.qualN;
            } else {
                qualMax = 0;
                qualMin = 0;
                qualAvg = 0;
            }
            // Create new tree when file has finished loading
            if (last) {
                // Update quality color scale
                setColorScale();
                // Convert matrix and names into Newick format
                act.innerHTML = 'Showing tree';
                newick = UPGMA(distanceParse.matrix, distanceParse.labels);
                // Create topology only string by removing distances from newick
                topology = newick.replace(/:[-0-9.]+/g, "");
                console.log('newick', newick, 'topology', topology);
                // If there is only one node, skip (phylotree crashes)
                if (newick.includes(",")) {
                    tree = new phylotree.phylotree($("#topology").prop("checked") ? topology : newick);
                    rendered_tree = tree.render(treeOptions);
                    $(rendered_tree.container).html(rendered_tree.show())
                    addLegend();
                }

                file2Idx = 0;
                file1Idx++;
                document.getElementById('stdout').innerHTML = '';
                // Start next comparison (if any)
                setTimeout(function () { compareNext(); }, 0);
            }
        });
    });
}

function getQScale() {
    return $("#qscale").children("option:selected").val();
}

function setColorScale() {
    let qscale = getQScale();
    switch (qscale) {
        case "black":
            color_scale = d3.scaleLinear().domain([0, qualMax]).range(["#000000", "#000000"]);
            break;
        case "gray":
            color_scale = d3.scaleLinear().domain([
                qualMin,
                qualMax]).range(["#C0C0C0", "#000000"]);
            break;
        case "rgb":
            color_scale = d3.scaleLinear().domain([0,
                qualAvg / 2,
                qualAvg,
                qualAvg * 3 / 2, // Add intermediate value for tick point on legend
                qualAvg * 2.01]) // Add 0.01 so tick text shows if value is close to round number
                .range(["#FF0000",
                    "#FF0000",
                    "#00FF00",
                    "#2890FF", /* intermediate color */,
                    "#5050FF"]);
            break;
        case "ylgnbu":
            // from https://colorbrewer2.org/#type=sequential&scheme=YlGnBu&n=3
            color_scale = d3.scaleLinear().domain([0,
                qualAvg / 2,
                qualAvg,
                qualAvg * 3 / 2, // Add intermediate value for tick point on legend
                qualAvg * 2.01]) // Add 0.01 so tick text shows if value is close to round number
                .range(['#edf8b1',
                    '#edf8b1',
                    '#7fcdbb',
                    '#55A6b9' /* intermediate color */,
                    '#2c7fb8']);
            break;
        case "rblkb":
            // red black blue
            color_scale = d3.scaleLinear().domain([0,
                qualAvg / 2,
                qualAvg,
                qualAvg * 3 / 2, // Add intermediate value for tick point on legend
                qualAvg * 2.01]) // Add 0.01 so tick text shows if value is close to round number
                .range(["#FF0000",
                    "#FF0000",
                    "#000000",
                    "#5050FF", /* intermediate color */,
                    "#5050FF"]);
            break;
        default:
            elog("Unknown color scale:", qscale);
            color_scale = d3.scaleLinear().domain([0, qualMax]).range(["#000000", "#000000"]);
    }
}

function addLegend() {
    // FIXME: Awful use of timer, to delay the resize of SVG until phylotree/d3 is done with it.
    clearTimeout(legendTimer);
    legendTimer = setTimeout(function () {
        // Delete old legend if needed
        let svg = d3.select("svg");
        svg.selectAll(".legend-container").remove();
        if (getQScale() != "black") {
            // Make room for legend in svg
            let h = parseInt(svg.attr("height"));
            d3.select("svg").attr("height", h + 70);
            let w = parseInt(svg.attr("width"));
            if (w < legendWidth + 200) {  // + 200 to ensure enough room for tick text
                d3.select("svg").attr("width", legendWidth + 200);
            }

            // Add container for legend, move to desired location
            let y = h + 10;
            let containerSvg = svg.append("g")
                .attr("class", "legend-container")
                .attr("transform", `translate(10,${y})`);
            Legend(containerSvg, color_scale, {
                title: "Quality",
            });
        }
    },
        500);
}

function sortFiles(files, compareOrder) {
    let fsz = []; // Files with sizes
    files.forEach(function (file) {
        fsz.push({ 'fn': file, 's': fs.statSync(file).size });
    });
    // Sort by size
    fsz.sort((a, b) => (a.s > b.s) ? 1 : ((b.s > a.s) ? -1 : 0));
    // Update original array (without sizes)
    fsz.forEach(function (f, i) {
        files[i] = f.fn;
    });
    // Change to requested ordering
    let l = files.length;
    let l2 = Math.floor(l / 2);
    switch (compareOrder) {
        case "smallest-largest":
            for (let i1 = 1; i1 < l2; i1 = i1 + 2) {
                let i2 = l - i1;
                [files[i1], files[i2]] = [files[i2], files[i1]];
            }
            break;
        case "largest":
            for (let i1 = 0; i1 < l2; i1++) {
                let i2 = l - i1 - 1;
                [files[i1], files[i2]] = [files[i2], files[i1]];
            }
            break;
        case "smallest":
            // Already sorted this way, nothing to do
            break;
        default: // also "random"
            // We use Fisher-Yates Shuffle to randomize the order
            let i1 = l;
            while (i1 !== 0) {
                let i2 = Math.floor(Math.random() * i1);
                i1--;
                [files[i1], files[i2]] = [files[i2], files[i1]];
            }
    }
}

function runCompare(params) {
    // TODO: sanitize params
    mgfFilesGlobal = getMgfFiles(params.mgfDir);
    // compareMS2 executables need local filenames, so change default dir
    process.chdir(params.mgfDir);
    llog('Change default dir: "' + params.mgfDir + '"\n');

    // Create directory for compare results
    compareDir = path.join(params.mgfDir, compareDirName);
    if (!fs.existsSync(compareDir)) fs.mkdirSync(compareDir, { recursive: true });

    // Sort files according to setting
    sortFiles(mgfFilesGlobal, params.compareOrder);
    console.log("Ordering after sort:", JSON.stringify(mgfFilesGlobal));
    paramsGlobal = params;
    file1Idx = 1;
    file2Idx = 0;

    // Create empty comparison list file
    compResultListFile = path.join(paramsGlobal.mgfDir, "cmp_list-" + instanceId + ".txt");
    fs.closeSync(fs.openSync(compResultListFile, 'w'))
    compareNext();
}

// ******************************* start of initialization ******************************************** //

if (navigator.platform == 'Linux x86_64') {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
} else if ((navigator.platform == 'Win64') || (navigator.platform == 'Win32')) {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2.exe');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices.exe');
}
else if (process.platform == 'darwin') {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2_darwin');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices_darwin');
}
else {
    document.body.innerHTML = "<H1>This app runs only on 64 bit Windows or 64 bit Linux Intel/AMD</H1>";
}

/////////////////////////
// The main program
/////////////////////////
runCompare(userparams);

$("#layout").on("click", function (e) {
    rendered_tree.radial($(this).prop("checked")).update(true);
    addLegend();
});

$("#topology").on("click", function (e) {
    let topologyOnly = $(this).prop("checked");
    treeOptions['show-scale'] = !topologyOnly; /* Hide scale is topology only */
    tree = new phylotree.phylotree(topologyOnly ? topology : newick);
    rendered_tree = tree.render(treeOptions);
    $(rendered_tree.container).html(rendered_tree.show())
    addLegend();
});

$("#details").on("click", function (e) {
    if ($(this).html() == "Hide details") {
        $(".tvert-details").css("visibility", "hidden");
        $(".info-details").css("height", "1px");
        $(this).html("Show details");
    }
    else {
        $(".tvert-details").css("visibility", "visible");
        $(".info-details").css("height", "150px");
        $(this).html("Hide details");
    }
});

$("#pause").on("click", function (e) {
    alert("Paused");
});

$("#qscale").change(function (e) {
    setColorScale();
    rendered_tree.update(true);
    addLegend();
});

$("#store-svg").on("click", function (e) {
    const v = $('#img-type').val();
    if (v == "svg") {
        const svg = document.querySelector('#main-tree-item svg');
        downloadSvg(svg, "phylotree");
    }
    else if (v == "png") {
        d3ToPng('#main-tree-item svg', 'phylotree', {
            scale: 5
        }
        );
    }

})

// Toggle full screen on F11
document.addEventListener("keydown", event => {
    var key = event.key;
    if (key == "F11") {
        // Ask main process to toggle fullscreen
        ipcRenderer.send('toggle-fullscreen', instanceId);
    }
});


// ************************************************************************************
// create legend, modified from from https://observablehq.com/@d3/color-legend
//
// Copyright 2021, Observable Inc.
// Released under the ISC license.
// https://observablehq.com/@d3/color-legend
function Legend(svg, color, {
    title,
    tickSize = 6,
    width = legendWidth,
    height = 44 + tickSize,
    marginTop = 18,
    marginRight = 0,
    marginBottom = 16 + tickSize,
    marginLeft = 0,
    ticks = width / 64,
    tickFormat,
    tickValues
} = {}) {

    function ramp(color, n = 256) {
        const canvas = document.createElement("canvas");
        canvas.width = n;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        for (let i = 0; i < n; ++i) {
            context.fillStyle = color(i / (n - 1));
            context.fillRect(i, 0, 1, 1);
        }
        return canvas;
    }

    let tickAdjust = g => g.selectAll(".tick line").attr("y1", marginTop + marginBottom - height);
    let x;

    // Continuous
    if (color.interpolate) {
        const n = Math.min(color.domain().length, color.range().length);

        x = color.copy().rangeRound(d3.quantize(d3.interpolate(marginLeft, width - marginRight), n));

        svg.append("image")
            .attr("x", marginLeft)
            .attr("y", marginTop)
            .attr("width", width - marginLeft - marginRight)
            .attr("height", height - marginTop - marginBottom)
            .attr("preserveAspectRatio", "none")
            .attr("xlink:href", ramp(color.copy().domain(d3.quantize(d3.interpolate(0, 1), n))).toDataURL());
    }

    // Sequential
    else if (color.interpolator) {
        x = Object.assign(color.copy()
            .interpolator(d3.interpolateRound(marginLeft, width - marginRight)),
            { range() { return [marginLeft, width - marginRight]; } });

        svg.append("image")
            .attr("x", marginLeft)
            .attr("y", marginTop)
            .attr("width", width - marginLeft - marginRight)
            .attr("height", height - marginTop - marginBottom)
            .attr("preserveAspectRatio", "none")
            .attr("xlink:href", ramp(color.interpolator()).toDataURL());

        // scaleSequentialQuantile doesn’t implement ticks or tickFormat.
        if (!x.ticks) {
            if (tickValues === undefined) {
                const n = Math.round(ticks + 1);
                tickValues = d3.range(n).map(i => d3.quantile(color.domain(), i / (n - 1)));
            }
            if (typeof tickFormat !== "function") {
                tickFormat = d3.format(tickFormat === undefined ? ",f" : tickFormat);
            }
        }
    }

    // Threshold
    else if (color.invertExtent) {
        const thresholds
            = color.thresholds ? color.thresholds() // scaleQuantize
                : color.quantiles ? color.quantiles() // scaleQuantile
                    : color.domain(); // scaleThreshold

        const thresholdFormat
            = tickFormat === undefined ? d => d
                : typeof tickFormat === "string" ? d3.format(tickFormat)
                    : tickFormat;

        x = d3.scaleLinear()
            .domain([-1, color.range().length - 1])
            .rangeRound([marginLeft, width - marginRight]);

        svg.append("g")
            .selectAll("rect")
            .data(color.range())
            .join("rect")
            .attr("x", (d, i) => x(i - 1))
            .attr("y", marginTop)
            .attr("width", (d, i) => x(i) - x(i - 1))
            .attr("height", height - marginTop - marginBottom)
            .attr("fill", d => d);

        tickValues = d3.range(thresholds.length);
        tickFormat = i => thresholdFormat(thresholds[i], i);
    }

    // Ordinal
    else {
        x = d3.scaleBand()
            .domain(color.domain())
            .rangeRound([marginLeft, width - marginRight]);

        svg.append("g")
            .selectAll("rect")
            .data(color.domain())
            .join("rect")
            .attr("x", x)
            .attr("y", marginTop)
            .attr("width", Math.max(0, x.bandwidth() - 1))
            .attr("height", height - marginTop - marginBottom)
            .attr("fill", color);

        tickAdjust = () => { };
    }

    svg.append("g")
        .attr("transform", `translate(0,${height - marginBottom})`)
        .call(d3.axisBottom(x)
            .ticks(ticks, typeof tickFormat === "string" ? tickFormat : undefined)
            .tickFormat(typeof tickFormat === "function" ? tickFormat : undefined)
            .tickSize(tickSize)
            .tickValues(tickValues))
        .call(tickAdjust)
        .call(g => g.select(".domain").remove())
        .call(g => g.append("text")
            .attr("x", marginLeft)
            .attr("y", marginTop + marginBottom - height - 6)
            .attr("fill", "currentColor")
            .attr("text-anchor", "start")
            .attr("font-weight", "bold")
            .attr("class", "title")
            .text(title));

    return svg.node();
}
// end of code copied from from https://observablehq.com/@d3/color-legend
// ********************************************************************************************

// Add zoom control:
// https://observablehq.com/@d3/programmatic-zoom
