const {ipcRenderer} = nodeRequire('electron');
const app = nodeRequire('electron').remote.app;
const path = nodeRequire('path');
const { spawn } = nodeRequire('child_process');
const lineReader = nodeRequire('line-reader');
const log = nodeRequire('electron-log');

let treeOptions = {
    'brush' : false, // We have no use for the brush
    'show-scale' : false,  // Scale is not updated on zoom, so we disable it
    'transitions': false,
    'zoom': true,
    'max-radius': 2000,
};

// Same options, but with transitions
let treeOptionsTransition = Object.assign({}, treeOptions, {'transitions': true});

let tree = d3.layout.phylotree()
  // create a tree layout object
  .svg(d3.select("#tree_display"));
  // render to this SVG element
let svgTree = document.getElementById('tree_display');

const compareDirName = 'compareresult'
let compareDir;

// Temporary output filename of compare ms2
const comparems2tmp = 'comparems2tmp.txt';

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

//tree.size([document.querySelector('.tree-box').offsetHeight,document.querySelector('.tree-box').offsetWidth]);
tree.font_size(15);
tree.options(treeOptions, false);

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

function compareNext() {
    let act=document.getElementById('activity');

    // Update progress bar
    let nMgf = mgfFilesGlobal.length;
    let progress = ((file1Idx * (file1Idx-1)/2)  + file2Idx)/ (nMgf * (nMgf -1)/2);
    document.getElementById('progress').value = progress * 100;

    if (file1Idx >= mgfFilesGlobal.length) {
        act.innerHTML = 'Finished';
    }
    else
    {
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
            ['-1', mgf1,
            '-2', mgf2,
            '-c', paramsGlobal.cutoff,
            '-p', paramsGlobal.precMassDiff,
            '-w', paramsGlobal.chromPeakW,
            ];
        // Create a unique filename based on parameters
        let cmpFile = path.join(compareDir, shortHashObj({cmdArgs}) + ".txt");

        // Append output filename, should now be part of hash
        cmdArgs.push('-o', path.join(compareDir, comparems2tmp));

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
                    fs.rename(path.join(compareDir, comparems2tmp), cmpFile, function (err) {
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
    if (file2Idx<file1Idx) {
        // If row is not finished, schedule next comparison
        setTimeout(function() {compareNext();}, 0);
    }
    else {
        // Finished new row, create tree
        makeTree();
    }
}

function makeTree() {
    let act=document.getElementById('activity');
    act.innerHTML = 'Creating tree';

    let cmdArgs = ['-i', compResultListFile,
            '-o', path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename) ,
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
        let parseState = 'init';
        const reSpecies = /^QC\s+(.+)\s+([0-9\.]+)$/;
        const reMatrix = /^[0-9. \t]+$/;
        const reMatrixCapt = /([0-9\.]+)/g;
        let labels = [];
        let matrix = []; // Will be filled with rows -> 2D matrix
        matrix[0] = []; // First element must be empty
        const df = path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename+'_distance_matrix.meg');
        lineReader.eachLine(df, (line, last) => {
            // Reading line by line
            if ( (parseState == 'init') ||
                    (parseState == 'labels') ) {
                let s = line.match(reSpecies);
                if ( (s) && (s.length != 0) ){
                    parseState = 'labels';
                    labels.push(s[1]);
                    // TODO: use CQ value
                } else if (parseState == 'labels') {
                    parseState = 'matrix';
                }
            }
            if (parseState == 'matrix') {
                if (reMatrix.test(line)) {
                    let row = line.match(reMatrixCapt);
                    // First one contains whole string, remove
                    // row.shift();
                    // Convert strings to numbers
                    row = row.map(x=>+x)
                    matrix.push(row);
                }
            }
            // Create new tree when files has finished loading
            if (last) {
                // Convert matrix and names into Newick format
                act.innerHTML = 'Showing tree';
                newick = UPGMA(matrix, labels);
                // Create topology only string by removing distances from newick
                topology = newick.replace(/:[-0-9.]+/g, "");
                console.log('newick', newick, 'topology', topology);
                d3.select("#tree_display").selectAll("*").remove();
                tree.options(treeOptions, false);
                tree($("#topology").prop("checked") ?  topology: newick).layout();
                file2Idx=0;

                file1Idx++;
                document.getElementById('stdout').innerHTML = '';
                // Start next comparison (if any)
                setTimeout(function() {compareNext();}, 0);
            }
        });
    });
}

function sortFiles(files, compareOrder) {
    let fsz = []; // Files with sizes
    files.forEach(function (file) {
        fsz.push({'fn': file, 's': fs.statSync(file).size});
    });
    // Sort by size
    fsz.sort((a,b) => (a.s > b.s) ? 1 : ((b.s > a.s) ? -1 : 0));
    // Update original array (without sizes)
    fsz.forEach(function (f, i) {
        files[i] = f.fn;
    });
    // Change to requested ordering
    let l=files.length;
    let l2=Math.floor(l/2);
    switch(compareOrder) {
    case "smallest-largest":
        for (let i1=1; i1<l2; i1=i1+2) {
            let i2 = l-i1;
            [files[i1], files[i2]] = [files[i2],files[i1]];
        }
        break;
    case "largest":
        for (let i1=0; i1<l2; i1++) {
            let i2 = l-i1-1;
            [files[i1], files[i2]] = [files[i2],files[i1]];
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
            [files[i1], files[i2]] = [files[i2],files[i1]];
        }
    }
}

function runCompare(params) {
    // TODO: sanitize params
    mgfFilesGlobal = getMgfFiles(params.mgfDir);
    // compareMS2 executables need local filenames, so change default dir
    process.chdir(params.mgfDir);
    llog('Change default dir: "' + params.mgfDir+'"\n');

    // Create directory for compare results
    compareDir=path.join(params.mgfDir, compareDirName);
    if (!fs.existsSync(compareDir)) fs.mkdirSync(compareDir, { recursive: true });

    // Sort files according to setting
    sortFiles(mgfFilesGlobal, params.compareOrder);
    console.log("Ordering after sort:", JSON.stringify(mgfFilesGlobal));
    paramsGlobal = params;
    file1Idx = 1;
    file2Idx = 0;

    // Create empty comparison list file
    compResultListFile = path.join(paramsGlobal.mgfDir,'cmp_list.txt');
    fs.closeSync(fs.openSync(compResultListFile, 'w'))
    compareNext();
}

// ******************************* start of initialization ******************************************** //

if (navigator.platform=='Linux x86_64') {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
} else if ( (navigator.platform=='Win64') || (navigator.platform=='Win32')) {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2.exe');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices.exe');
}
else {
    document.body.innerHTML = "<H1>This app runs only on 64 bit Windows or 64 bit Linux Intel/AMD</H1>";
}

// Receive parameters set in the main window
ipcRenderer.on('userparams', (event, params) => {
    runCompare(params);
})

// Notify main process that we are ready to receive parameters
ipcRenderer.send('get-userparms');

$("#layout").on("click", function(e) {
    tree.options(treeOptionsTransition, false);
    tree.radial($(this).prop("checked")).placenodes().update();
  });

$("#topology").on("click", function(e) {
    d3.select("#tree_display").selectAll("*").remove();
    tree.options(treeOptionsTransition, false);
    tree($(this).prop("checked") ? topology: newick).layout();
});

$("#details").on("click", function(e) {
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

$("#pause").on("click", function(e) {
    alert("Paused");
});

// Add zoom control:
// https://observablehq.com/@d3/programmatic-zoom
