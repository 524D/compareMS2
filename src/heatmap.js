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

var option;
const xMin = -1.6;
const xMax = +1.6;
const yMin = 0.0;
const yMax = +100.0;
const myPath = app.getAppPath();

let compareMS2exe;
let query = querystring.parse(global.location.search);
let userparams = JSON.parse(query['?userparams']);
let instanceId = query['instanceId'];


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
        console.error('Error running compareMS2');
        // act.innerHTML = 'Error running compareMS2';
    });

    cmp_ms2.stderr.on('exit', (code, signal) => {
        console.error('Error running compareMS2');
        // act.innerHTML = 'Error running compareMS2';
    });

    cmp_ms2.on('close', (code, signal) => {
        if (code == null) {
            elog("Error: comparems2 command line executable crashed.\n")
        }
        else {
            // Compare finished, rename temporary output file
            // to final filename
            fs.rename(comparems2tmpX, cmpFile, function (err) {
                if (err) throw err
                onFinishedFunc(cmpFile);
            });
        }
    });
}

// Output logging
function llog(msg) {
    log.info(msg);
}

function elog(msg) {
    log.error(msg);
}

function run() {
    runCompare(userparams, convertResultToHeatmap)
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

// Start the comparison
run();
var data, xData, yData, realYMin, maxVal;

option = {
    title: [
        {
        text: 'two−dataset comparison',
        left: 'center',
        top: 10,
        textStyle: {
                fontWeight: 'normal',
                fontSize: 20
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
            name: 'MS2 similarity (dot product)',
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

            name: 'Two dataset comparison',
            type: 'heatmap',
            coordinateSystem: 'cartesian2d',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: data,

            // Number of items to draw in one "frame" (about 16 ms)
            progressive: 2000,
            animation: false
        }
    ]
};

function updateOption(xMin, xMax, data, xData, yData, realYMin, maxVal) {
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
    myChart.hideLoading();
    updateOption(xMin, xMax, data, xData, yData, realYMin, maxVal) 
    myChart.setOption(option);
}


// option && myChart.setOption(option);

