const {ipcRenderer} = nodeRequire('electron');
const app = nodeRequire('electron').remote.app;
const path = nodeRequire('path');
const { spawn } = nodeRequire('child_process');
const lineReader = nodeRequire('line-reader');

// var example_tree = "(((EELA:0.150276,CONGERA:0.213019):0.230956,(EELB:0.263487,CONGERB:0.202633):0.246917):0.094785,((CAVEFISH:0.451027,(GOLDFISH:0.340495,ZEBRAFISH:0.390163):0.220565):0.067778,((((((NSAM:0.008113,NARG:0.014065):0.052991,SPUN:0.061003,(SMIC:0.027806,SDIA:0.015298,SXAN:0.046873):0.046977):0.009822,(NAUR:0.081298,(SSPI:0.023876,STIE:0.013652):0.058179):0.091775):0.073346,(MVIO:0.012271,MBER:0.039798):0.178835):0.147992,((BFNKILLIFISH:0.317455,(ONIL:0.029217,XCAU:0.084388):0.201166):0.055908,THORNYHEAD:0.252481):0.061905):0.157214,LAMPFISH:0.717196,((SCABBARDA:0.189684,SCABBARDB:0.362015):0.282263,((VIPERFISH:0.318217,BLACKDRAGON:0.109912):0.123642,LOOSEJAW:0.397100):0.287152):0.140663):0.206729):0.222485,(COELACANTH:0.558103,((CLAWEDFROG:0.441842,SALAMANDER:0.299607):0.135307,((CHAMELEON:0.771665,((PIGEON:0.150909,CHICKEN:0.172733):0.082163,ZEBRAFINCH:0.099172):0.272338):0.014055,((BOVINE:0.167569,DOLPHIN:0.157450):0.104783,ELEPHANT:0.166557):0.367205):0.050892):0.114731):0.295021)"
// tree from Yokoyama et al http://www.ncbi.nlm.nih.gov/pubmed/18768804
// var example_tree = "(((A,B),E),(C,D))";
// "((Homo_sapiens:0.2,Pan_troglodytes:0.3):0.6,(Macaca_fascicularis:0.7,Macaca_mulatta:0.4):0.75)"

var tree = d3.layout.phylotree()
  // create a tree layout object
  .svg(d3.select("#tree_display"));
// render to this SVG element

//tree(example_tree)
  // parse the Newick into a d3 hierarchy object with additional fields
//  .layout();
// layout and render the tree

$("#layout").on("click", function(e) {
    tree.radial($(this).prop("checked")).placenodes().update();
  });

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

var file1_idx;
var file2_idx;
var paramsGlobal;  // To save memory in recursive call, we store these in global variables
var mgfFilesGlobal;
var compareMS2exe;
var compToDistExe;
var compResultListFile;
const myPath = app.getAppPath();

if (navigator.platform=='Linux x86_64') {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
} else if (navigator.platform=='Win64') {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2.exe');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices.exe');
}
else {
    document.body.innerHTML = "<H1>This app runs only on 64 bit Windows or 64 bit Linux Intel/AMD</H1>";
}

function compareNext() {
    var act=document.getElementById('activity');

    if (file1_idx >= mgfFilesGlobal.length) {
        act.innerHTML = 'Finished';
    }
    else
    {
        act.innerHTML = 'Comparing<br/>' + escapeHtml(mgfFilesGlobal[file1_idx]) + '<br/>' + mgfFilesGlobal[file2_idx];
        var cmpFile = path.join(paramsGlobal.mgfDir, "cmp_"+file1_idx+"_"+file2_idx+".txt");
        const cmp_ms2 = spawn(compareMS2exe,
        ['-1', mgfFilesGlobal[file1_idx],
        '-2', mgfFilesGlobal[file2_idx],
        '-c', paramsGlobal.cutoff,
        '-p', paramsGlobal.precMassDiff,
        '-w', paramsGlobal.chromPeakW,
        '-o', cmpFile,
        ]);
    
        cmp_ms2.stdout.on('data', (data) => {
            data = escapeHtml(data.toString());
            data = data.replace(/(?:\r\n|\r|\n)/g, '<br>');
            data = data.replace(/(?: )/g, '&nbsp;');
            document.getElementById('stdout').innerHTML += data;
            });
            
        cmp_ms2.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });
            
        cmp_ms2.on('error', (data) => {
            console.error('Error running compareMS2');
            act.innerHTML = 'Error running compareMS2';
        });
            
        cmp_ms2.stderr.on('exit', (code, signal) => {
            console.error('Error running compareMS2');
            act.innerHTML = 'Error running compareMS2';
        });
            
        cmp_ms2.on('close', (code) => {
            fs.appendFileSync(compResultListFile, cmpFile + "\n");
            file2_idx++;
            if (file2_idx>=file1_idx) {
            //     if (file2_idx==file1_idx) {
            //     file2_idx++;
            // }
            // if (file2_idx >= mgfFilesGlobal.length) {
                // Finished new row, create tree
                act.innerHTML = 'Creating tree';
// usage: compareMS2_to_distance_matrices -i <list of compareMS2 results files>
//   -o <output file stem> 
// -x sample to species mapping
// -c score cutoff


                var cmdArgs = ['-i', compResultListFile,
                '-o', path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename) ,
                '-c', paramsGlobal.cutoff,
                '-m'  // Generate MEGA format
                ]
                var s2s = paramsGlobal.s2sFile;
                // If the file to species mapping file exists, use it
                if (fs.existsSync(s2s) && fs.lstatSync(s2s).isFile()) {
                    cmdArgs.push('-x', s2s)
                }
                else
                {
                // FIXME: compareMS2_to_distance_matrices doesn't work without sample2species file,
                // so assume it is in the data dir if not specified
                    cmdArgs.push('-x', path.join(paramsGlobal.mgfDir, 'sample_to_species.txt'));
                }
//                const c2d = spawn('echo', cmdArgs);
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
                    var parseState = 'init';
                    const reSpecies = /^QC\s+(.+)\s+([0-9\.]+)$/;
                    const reMatrix = /^[0-9. \t]+$/;
                    const reMatrixCapt = /([0-9\.]+)/g;
                    var labels = [];
                    var matrix = []; // Will be filled with rows -> 2D matrix
                    matrix[0] = []; // First element must be empty
                    const df = path.join(paramsGlobal.mgfDir, paramsGlobal.outBasename+'_distance_matrix.meg');
                    lineReader.eachLine(df, (line, last) => {
                        // Reading line by line
                        if ( (parseState == 'init') ||
                                (parseState == 'labels') ) {
                            var s = line.match(reSpecies);
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
                                var row = line.match(reMatrixCapt);
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
                            var newick = UPGMA(matrix, labels);
                            console.log('newick', newick);
                            d3.select("#tree_display").selectAll("*").remove();
                            tree(newick)
                                .layout();
                            file2_idx=0;

                            file1_idx++;
                            document.getElementById('stdout').innerHTML = '';
                        }
                    });
                });
            }
            setTimeout(function() {compareNext();}, 1000);
        });
    }
}

function runCompare(params) {
    // TODO: sanitize params
    mgfFilesGlobal = getMgfFiles(params.mgfDir);
    // compareMS2 executables need local filenames, so change default dir
    process.chdir(params.mgfDir);
    // TODO: Sort files according to setting
    paramsGlobal = params;
    // file1_idx = 0;
    // file2_idx = 1;
    file1_idx = 1;
    file2_idx = 0;

    // Create empty comparison list file
    compResultListFile = path.join(paramsGlobal.mgfDir,'cmp_list.txt');
    fs.closeSync(fs.openSync(compResultListFile, 'w'))
    compareNext();
}




    // 
    // precMassDiff
    // chromPeakW
    // captureLog
    // richOutput
    // s2sFile
    // outBasename
    // cutoff
    // avgSpecie
    // outNexus
    // outMega
    // outNeely
    // impMissing

// usage: compareMS2 -1 <first dataset filename> -2 <second dataset filename>
// [-c <score cutoff> -o <output filename>
// -m <minimum base peak signal in MS/MS spectrum for comparison>,<minimum total ion signal in MS/MS spectrum for comparison>
// -a <alignment piecewise linear function filename>
// -w <maximum scan number difference>
// -p <maximum difference in precursor mass>
// -e <maximum mass measurement error>]

// Receive parameters set in the main window
ipcRenderer.on('userparams', (event, params) => {
    runCompare(params);
})
  

