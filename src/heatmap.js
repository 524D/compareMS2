const { ipcRenderer } = nodeRequire('electron');
const path = nodeRequire('path');
const querystring = nodeRequire('querystring');
const { app } = nodeRequire('@electron/remote')
const log = nodeRequire('electron-log');
const { spawn } = nodeRequire('child_process');

const compareDirName = 'compareresult'
var chartDom = document.getElementById('main');
// var myChart = echarts.init(chartDom, null, { renderer: 'svg' }); // SVG is quite a bit slower than canvas
var myChart = echarts.init(chartDom);

// Show the "loading" animation
myChart.showLoading({
    text: 'Working',
    fontSize: 24,
    spinnerRadius: 20,
    lineWidth: 8,
});

const xMin = -1.6;
const xMax = +1.6;
const yMin = 0.0;
const yMax = +100.0;
const myPath = app.getAppPath();

let compareMS2exe;
let query = querystring.parse(global.location.search);
let userparams = JSON.parse(query['?userparams']);
let instanceId = query['instanceId'];

var data, xData, yData, realYMin, maxVal;

var option = {
    title: [
        {
        text: '', // Set in runCompare
        left: 'center',
        top: 2,
        textStyle: {
                fontWeight: 'normal',
                fontSize: 20,
            rich: {
                // (style "a" in text string)
                a: {
                    fontSize: 12,
                    color: '#606060',
                },
            }
            }
        }
    ],
    // NOTE: This plot uses a hack to work around what seems a bug in ECharts
    // The problem is that the heatmap series doesn't work properly with a 'value' axis
    // If used, the boxes in the heatmap have a size of 1 unit, which is not scaled
    // by the axis. This makes them unusable.
    // So we use a hidden 'category' axis to plot the heatmap and a 'value' axis
    // just to show the axis
    tooltip: {},
    xAxis: [
        {
            type: 'value',
            name: 'Precursor {a|m}/{a|z} difference',
            nameLocation: 'middle',
            nameGap: 30,
            nameTextStyle: {
                fontSize: 18,
                rich: {
                    // Italic font for m and z (style "a" in name string)
                    a: {
                        fontSize: 18,
                        fontStyle: 'italic',
                    },
                }
            },
            axisLine: {
                show: true,
            },
            min: xMin,
            max: xMax,
            position: 'bottom',
            offset: 5,
            axisLabel: {
                formatter: '{value}'
            },
            
        },
        {
            show: false,
            type: 'category',
            data: xData
        },
        {
            type: 'category',
            data: function() {
                let data = [];
                const xRange = xMax-xMin;
                const dataLen = 320; // FIXME: Hardcoded
                // Initialize array with null values
                for (let i = 0; i < dataLen; i++) {
                    data[i] = '';
                }
                // Set values for fractions that we want to display
                let fractions = ['-3/2', '-1', '-2/3', '-1/2', '-1/3', '0', '2/3', '1/2', '1/3', '1', '3/2'];
                for (let i = 0; i < fractions.length; i++) {
                    let dataIndex = Math.round(dataLen * ((eval(fractions[i])-xMin)/xRange));
                    data[dataIndex] = fractions[i];
                }
                return data;
            }(),
            alignWithLabel: true,
            position: 'top',
            offset: 2,
            axisTick: {
                length: 5,
                interval: (index, value) => Boolean(value)  // Return true for non-empty values
            },
            axisLabel: {
                interval: 0,
                rotate: 30 //If the label names are too long you can manage this by rotating the label.
            }
        },
    ],
    yAxis: [
        {
            type: 'value',
            name: '', // Set in runCompare
            nameLocation: 'middle',
            nameGap: 30,
            nameTextStyle: {
                fontSize: 18
            },
            min: 0.0,
            max: 1.0,
            position: 'left',
            offset: 1,
            axisLabel: {
                formatter: '{value}'
            },
            axisLine: {
                onZero: false
            }
        },
        {
            show: false,
            type: 'category',
            data: yData
        },
    ],
    visualMap: {
        calculable: true,
        realtime: false,
        min: 0,
        max: maxVal,
        right: 0,
        top: 'center',
        formatter: function (value){ return Math.round(Math.E**value) },
        inRange: {
            color: [
                '#313695',
                '#4575b4',
                '#74add1',
                '#abd9e9',
                '#e0f3f8',
                '#ffffbf',
                '#fee090',
                '#fdae61',
                '#f46d43',
                '#d73027',
                '#a50026'
            ]
        }
    },
    series: [
        {
            tooltip: {
                show: false
            },
            // Make chart silent so that it doesn't respond to mouse events and pointer remains an arrow
            silent: true,

            name: '',
            type: 'heatmap',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: data,

            // Number of items to draw in one "frame" (about 16 ms)
            // Since this also appears to effect the charts rendered to SVG and maybe PNG,
            // we set it to a very high value to avoid the parts of the chart being lost.
            progressive: 1000000,
            animation: false
        }
    ]
};

// ******************************* end of initialization ******************************************** //

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
    // msg = '<span class="warn>' + msg + '</span>';  // Commented out, somehow span doesn't display anything
    document.getElementById('stdout').innerHTML += msg;
}

function showActivity(msg) {
    let act = document.getElementById('activity');
    act.innerHTML = msg;
}

function updateHeatmap(xMin, xMax, data, xData, yData, realYMin, maxVal) {
    option.xAxis[0].min = xMin;
    option.xAxis[0.].max = xMax;

    option.xAxis[1].data = xData;
    option.yAxis[1].data = yData;
    option.series[0].data = data;
    option.visualMap.max = maxVal;
}

function convertResultToHeatmap(cmpFile) {
    // Read cmpFile into tabData
    let tabData = fs.readFileSync(cmpFile, 'utf8');
    [data, xData, yData, realYMin, maxVal] = convertData(tabData)
    updateHeatmap(xMin, xMax, data, xData, yData, realYMin, maxVal) 
    myChart.setOption(option);
}

function hideLoading() {
    myChart.hideLoading();
}

function setTitle(title) {
    option.title[0].text = title;
}

function setYAxisLabel(label) {
    option.yAxis[0].name = label;
}

function getSelectedScale() {
    return $("#qscale").children("option:selected").val();
}

function updateQScale() {
    let cScale = getSelectedScale();
    colorScale = getColorScale(cScale);
    myChart.setOption({
        visualMap: {
            inRange: {
                color: colorScale
            }
        }
    });
}

function getColorScale(cScale) {
    // Set the color scale based on the selected option
    let colorScale=[];
    switch (cScale) {
        case "gray":
            colorScale=['#FFFFFF','#000000'];
            break;
        case "rgb":
            colorScale=[
                    '#0000FF',
                    '#00FF00',
                    '#FF0000'];
            break;
        case "ylgnbu":
            colorScale=[
                    '#2c7fb8',
                    '#7fcdbb',
                    '#edf8b1'
                ];
            break;
        case "rwb":
            // red white (sort-of...) blue
            colorScale=[
                    '#313695',
                    '#4575b4',
                    '#74add1',
                    '#abd9e9',
                    '#e0f3f8',
                    '#ffffbf',
                    '#fee090',
                    '#fdae61',
                    '#f46d43',
                    '#d73027',
                    '#a50026'
            ];
            break;
        default:
            elog("Unknown color scale:", cScale);
            colorScale=[
                    '#313695',
                    '#4575b4',
                    '#74add1',
                    '#abd9e9',
                    '#e0f3f8',
                    '#ffffbf',
                    '#fee090',
                    '#fdae61',
                    '#f46d43',
                    '#d73027',
                    '#a50026'
            ];
    }
    return colorScale;
}


// Convert the TAB delimited data in tabData into the format required by heatmap
function convertData(tabData) {
    let xData = [];
    let yData = [];
    let data = [];
    let lines = tabData.split('\n');
    const yRange=yMax-yMin;
    const xRange=xMax-xMin;
    // Remove empty lines

    lines = lines.filter(function (line) {
        return line.trim() !== '';
    });

    // We ignore lines at the start that are all zeros
    const il = lines.length;
    let i;
    for (i = 0; i < il; i++) {
        let line = lines[i];
        let items = line.split('\t');
        if (!(items.every(item => item == 0))) {
            // Leave the loop when we find the first non-zero line
            break;
        }
    }

    const realYmin = (yRange*i)/il+yMin;
    
    // i is now the index of the first non-zero line
    // We use the first non-zero row to determine the number of columns
    let items = lines[i].split('\t');
    const jl = items.length;
    for (let j = 0; j < jl; j++) {
        const x=(xRange*j)/jl+xMin;
        xData.push(x);
    }

    // Extract the actual data
    let maxVal = 0;
    let y = 0;
    for (; i < il; i++) {
        let line = lines[i];
        let items = line.split('\t');
        const jl = items.length;
        
        // const y = (yRange*i)/il+yMin;
        yData.push(y);

        for (let j = 0; j < jl; j++) {
            let item = items[j];
            item = Math.log(item);
            maxVal = Math.max(maxVal, parseFloat(item));
            const x=j; // x here is just the index, not the actual value
            // const x=(xRange*j)/jl + xMin
            data.push({ value: [x, y, parseFloat(item)]});
        }
        y++;
        
    }
    return [data, xData, yData, realYmin, maxVal ];
}

function runCompare(userparams, onFinishedFunc) {
    let mzFile1 = userparams.mzFile1;
    let mzFile2;

    // If mzFile2 is not specified, use mzFile1 for both (self-comparison)
    if (userparams.mzFile2) {
        mzFile2 = userparams.mzFile2;
    } else {
        mzFile2 = userparams.mzFile1;
    }

    if (mzFile1 == mzFile2) {
        var file1Base = path.basename(mzFile1);
        setTitle("Self comparison {a|(" + file1Base + ")}");
    } else {
        var file1Base = path.basename(mzFile1);
        var file2Base = path.basename(mzFile2);
        setTitle("Two dataset comparison {a|(" + file1Base + " vs " + file2Base + ")}");
    }

    if (userparams.specMetric == "0") {
        setYAxisLabel("MS2 similarity (dot product)");
    } else {
        setYAxisLabel("MS2 similarity (spectral angle)");
    }

    // compareMS2 executables need local filenames, so change default dir
    process.chdir(path.dirname(userparams.mzFile1));
    llog('Change default dir: "' + path.dirname(userparams.mzFile1) + '"\n');
    
    // Create directory for compare results
    compareDir = path.join(path.dirname(userparams.mzFile1), compareDirName);
    if (!fs.existsSync(compareDir)) fs.mkdirSync(compareDir, { recursive: true });

    // The order of input files is not important for the result.
    // We always order alphabetical, so that the check if we
    // already have the result works correctly.
    if (mzFile1 > mzFile2) {
        [mzFile1, mzFile2] = [mzFile2, mzFile1];
    }

    let cmdArgs =
        ['-A', mzFile1,
            '-B', mzFile2,
            '-p', userparams.maxPrecursorDifference,
            '-m', userparams.minBasepeakIntensity + ',' + userparams.minTotalIonCurrent,
            '-w', userparams.maxScanNumberDifference,
            '-W', userparams.startScan + ',' + userparams.endScan,
            '-r', userparams.maxRTDifference,
            '-R', userparams.startRT + ',' + userparams.endRT,
            '-c', userparams.cutoff,
            '-f', userparams.specMetric,
            '-s', userparams.scaling,
            '-n', userparams.noise,
            '-q', userparams.qc,
            '-d', userparams.metric,
            '-N', userparams.topN,
            '-x', '1'  // "Experimental features"=output heatmap data
        ]
    // Create a unique filename based on parameters
    const hashName = shortHashObj({ cmdArgs });
    let cmpFile = path.join(compareDir, hashName + "_exp.txt");

    // Temporary output filename of compare ms2
    // used to avoid stale incomplete output after interrupt
    const comparems2tmp = path.join(compareDir, hashName + "-" + instanceId + ".tmp");
    // "Experimental features"=output heatmap data
    const comparems2tmpX = path.join(compareDir, hashName + "-" + instanceId + "-x.tmp");

    // Append output filename, should not be part of hash
    cmdArgs.push('-o', comparems2tmp);
    cmdArgs.push('-X', comparems2tmpX);

    let cmdStr = compareMS2exe + JSON.stringify(cmdArgs);
    llog('Executing: ' + cmdStr + '\n');

    const cmp_ms2 = spawn(compareMS2exe, cmdArgs);

    cmp_ms2.stdout.on('data', (data) => {
        llog(data.toString());
    });

    cmp_ms2.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
        elog(data.toString());
    });

    cmp_ms2.on('error', (data) => {
        hideLoading();
        elog('Error running compareMS2');
        showActivity('Error running compareMS2');
    });

    cmp_ms2.stderr.on('exit', (code, signal) => {
        hideLoading();
        elog('Error running compareMS2');
        showActivity('Error running compareMS2');
        // act.innerHTML = 'Error running compareMS2';
    });

    cmp_ms2.on('close', (code, signal) => {
        hideLoading();
        if (code == null) {
            elog("Error: comparems2 command line executable crashed (signal 0x" + signal.toString(16) + ")\n")
            showActivity("Error: comparems2 command line executable crashed (signal 0x" + signal.toString(16) + ")\n")
        }
        else {
            if (code != 0) {
                elog("Error: comparems2 command line exited with error code " + code.toString(16), "\n")
                showActivity("Error: comparems2 command line exited with error code " + code.toString(16), "\n")
            } else {
                // Compare finished, rename temporary output file
                // to final filename
                fs.rename(comparems2tmpX, cmpFile, function (err) {
                    if (err) throw err
                    onFinishedFunc(cmpFile);
                });
            }
        }
    });
}

function run() {
    runCompare(userparams, convertResultToHeatmap)
}

// Function renderSVG is renders the chart to an SVG string
// Parameters option contains the chart "option" object as defined by ECharts
function renderSVG(option) {
    // In SSR mode the first container parameter is not required
    const chart = echarts.init(null, null, {
        renderer: 'svg', // must use SVG rendering mode
        ssr: true, // enable SSR
        width: 1200, // need to specify height and width
        height: 1000
    });

    chart.setOption(option);
    const svgStr = chart.renderToSVGString();
    chart.dispose();
    return svgStr;
}

function createCanvas(width, height) {
    return Object.assign(document.createElement('canvas'), { width: width, height: height })
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
// Function saveAsPNG is renders the chart to a PNG buffer and sends it to the main process
// Parameters option contains the chart "option" object as defined by ECharts
function saveAsPNG(option) {
    const canvas = createCanvas(1200, 1000);
    // ECharts can use the Canvas instance created by node-canvas as a container directly
    const chart = echarts.init(canvas);
    
    chart.setOption(option);
     //    chart.on('finished', () => {
     // Sleep is a hack, eCharts doesn't seem to wait for the chart to be rendered
     // before firing the 'finished' event (and before the 'rendered' event either)
     sleep(500).then(() => {
            canvas.toBlob(function(blob) {
                blob.arrayBuffer().then(function(aBuffer) {
                    // Convert to Node.js Buffer
                    const buffer=Buffer.from(aBuffer);
                    ipcRenderer.send('store-image', "png", buffer, 0);
                });
            });
            chart.dispose();
        });
    return;
}

// ******************************* start of initialization ******************************************** //

if (process.platform === 'linux' && process.arch === 'x64') {
    compareMS2exe = path.join(myPath, 'external_binaries', 'compareMS2');
    compToDistExe = path.join(myPath, 'external_binaries', 'compareMS2_to_distance_matrices');
} else if (process.platform === 'win32' && process.arch === 'x64') {
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

// Toggle full screen on F11
document.addEventListener("keydown", event => {
    var key = event.key;
    if (key == "F11") {
        // Ask main process to toggle fullscreen
        ipcRenderer.send('toggle-fullscreen', instanceId);
    }
});

// Set color scale when selection changes
$("#qscale").change(function() {
    updateQScale();
});

$("#store-image").on("click", function (e) {
    const imgFmt = $('#img-type').val();
    var imageData;
    if (imgFmt == "svg") {
        imageData = renderSVG(option);
        ipcRenderer.send('store-image', imgFmt, imageData, instanceId);
    }        
    else if (imgFmt == "png") {
        imageData = saveAsPNG(option);
    }
    // Set message to main process to store the SVG string
    // FIXME: when context isolation is enabled, replace with:
    // window.electronAPI.storeImage(v, imageData, instanceId);
})

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

window.addEventListener('resize', function() {
    myChart.resize();
});

    // Start the comparison
run();
