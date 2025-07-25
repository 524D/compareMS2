var chartDom = document.getElementById('main-chart');
// var myChart = echarts.init(chartDom, null, { renderer: 'svg' }); // SVG is quite a bit slower than canvas
var myChart = echarts.init(chartDom);

const xMin = -1.6;
const xMax = +1.6;
const yMin = 0.0;
const yMax = +100.0;

// Show the "loading" animation
myChart.showLoading({
    text: 'Working',
    fontSize: 24,
    spinnerRadius: 20,
    lineWidth: 8,
});

var data, xData, yData, realYMin, maxVal;

// ******************************* end of initialization ******************************************** //

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// Handle log messages from the main process
window.heatmapAPI.onLogMessage((message) => {
    message = message.replace(/(?:\r\n|\r|\n)/g, '<br>');
    message = message.replace(/(?: )/g, '&nbsp;');
    // Append new line to the output div
    message += '<br>';
    // Append the message to the output div
    const outputDiv = document.getElementById('stdout');
    if (outputDiv) {
        outputDiv.innerHTML += message;
    }
});

// Handle log error messages from the main process
window.heatmapAPI.onLogError((message) => {
    message = message.replace(/(?:\r\n|\r|\n)/g, '<br>');
    message = message.replace(/(?: )/g, '&nbsp;');
    // Append the message to the output div
    const outputDiv = document.getElementById('stdout');
    if (outputDiv) {
        outputDiv.innerHTML += `<span class="warn">${message}</span><br>`;
    }
});

// Handle activity messages from the main process
window.heatmapAPI.onSetActivity((message) => {
    message = message.replace(/(?:\r\n|\r|\n)/g, '<br>');
    message = message.replace(/(?: )/g, '&nbsp;');
    // Append the message to the output div
    const outputDiv = document.getElementById('activity');
    if (outputDiv) {
        outputDiv.innerHTML = message;
    }
});


// The function updateChart is called by the main process through the preload script
window.heatmapAPI.updateChart((chartContent) => {
    // Hide the "loading" animation
    myChart.hideLoading();
    const option = makeEChartsOption(chartContent);
    myChart.setOption(option);
})

window.heatmapAPI.onHideLoading(() => {
    // Hide the "loading" animation
    myChart.hideLoading();
});

function hideLoading() {
    myChart.hideLoading();
}

function getSelectedScale() {
    return document.getElementById("qscale").value;
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
    let colorScale = [];
    switch (cScale) {
        case "gray":
            colorScale = ['#FFFFFF', '#000000'];
            break;
        case "rgb":
            colorScale = [
                '#0000FF',
                '#00FF00',
                '#FF0000'];
            break;
        case "ylgnbu":
            colorScale = [
                '#2c7fb8',
                '#7fcdbb',
                '#edf8b1'
            ];
            break;
        case "rwb":
            // red white (sort-of...) blue
            colorScale = [
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
            colorScale = [
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


// Function renderSVG is renders the chart to an SVG string
// Parameters option contains the chart "option" object as defined by ECharts
function renderSVG(option) {
    // Get the width and height from the HTML element with id 'main-chart'
    const mainElement = document.getElementById('main-chart');
    const width = mainElement.clientWidth || 1200; // Default to 1200
    const height = mainElement.clientHeight || 1000; // Default to 1000 
    // In SSR mode the first container parameter is not required
    const chart = echarts.init(null, null, {
        renderer: 'svg', // must use SVG rendering mode
        ssr: true, // enable SSR
        width: width,
        height: height
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

// Function save// Function saveAsPNG is renders the chart to a PNG buffer and sends it to the main process
// Parameters option contains the chart "option" object as defined by ECharts
function saveAsPNG(option, defaultName, imgFmt) {
    // Get the width and height from the HTML element with id 'main-chart'
    const mainElement = document.getElementById('main-chart');
    const width = mainElement.clientWidth || 1200;
    const height = mainElement.clientHeight || 1000; // Default to 10000 

    const canvas = createCanvas(width, height);
    // ECharts can use the Canvas instance created by node-canvas as a container directly
    const chart = echarts.init(canvas);

    chart.setOption(option);
    //    chart.on('finished', () => {
    // Sleep is a hack, eCharts doesn't seem to wait for the chart to be rendered
    // before firing the 'finished' event (and before the 'rendered' event either)
    sleep(500).then(() => {
        canvas.toBlob(function (blob) {
            blob.arrayBuffer().then(function (aBuffer) {
                // FIXME: we don't have Node here
                // Convert to Node.js Buffer
                // const abuffer = Buffer.from(aBuffer);
                window.heatmapAPI.storeImage(defaultName, imgFmt, aBuffer);
            });
        });
        chart.dispose();
    });
    return;
}

function makeEChartsOption(chartContent) {
    // Create the ECharts option object based on the chartContent
    const option = {
        title: [
            {
                text: chartContent.title || 'Heatmap',
                left: 'center',
                top: 2,
                textStyle: {
                    fontWeight: 'normal',
                    fontSize: 20,
                    rich: {
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
                min: chartContent.xMin || -1.6,
                max: chartContent.xMax || +1.6,
                position: 'bottom',
                offset: 5,
                axisLabel: {
                    formatter: '{value}'
                },
            },
            {
                show: false,
                type: 'category',
                data: chartContent.xData || []
            },
            {
                type: 'category',
                data: function () {
                    let data = [];
                    const xRange = xMax - xMin;
                    const dataLen = 320; // FIXME: Hardcoded
                    // Initialize array with null values
                    for (let i = 0; i < dataLen; i++) {
                        data[i] = '';
                    }
                    // Set values for fractions that we want to display
                    let fractions = ['-3/2', '-1', '-2/3', '-1/2', '-1/3', '0', '2/3', '1/2', '1/3', '1', '3/2'];
                    for (let i = 0; i < fractions.length; i++) {
                        let dataIndex = Math.round(dataLen * ((eval(fractions[i]) - xMin) / xRange));
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
                name: chartContent.yAxisLabel || '',
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
            },
            {
                show: false,
                type: 'category',
                data: chartContent.yData || []
            }
        ],

        visualMap: {
            calculable: true,
            realtime: false,
            min: 0,
            max: chartContent.maxVal || 1.0,
            right: 0,
            top: 'center',
            formatter: function (value) { return Math.round(Math.E ** value) },
            inRange: {
                color: []
            }
        },
        series: [
            {
                tooltip: {
                    show: false
                },
                // Make chart silent so that it doesn't respond to mouse events and pointer remains an arrow
                silent: true,
                name: chartContent.seriesName || '',
                type: 'heatmap',
                coordinateSystem: 'cartesian2d',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: chartContent.data || [],
                // Number of items to draw in one "frame" (about 16 ms)
                // Since this also appears to effect the charts rendered to SVG and maybe PNG,
                // we set it to a very high value to avoid the parts of the chart being lost.
                progressive: 1000000,
                animation: false
            }
        ]
    };

    // Set the color scale based on the selected option
    const cScale = getSelectedScale();
    option.visualMap.inRange.color = getColorScale(cScale);
    return option;
}

// ******************************* start of initialization ******************************************** //

// Toggle full screen on F11
document.addEventListener("keydown", event => {
    var key = event.key;
    if (key == "F11") {
        window.heatmapAPI.toggleFullscreen();
    }
});

// Set color scale when selection changes
document.getElementById("qscale").addEventListener("change", function () {
    updateQScale();
});

document.getElementById("store-image").addEventListener("click", function (e) {
    const imgFmt = document.getElementById('img-type').value;
    const defaultName = "spectra2species";
    const option = myChart.getOption(); // Get the current chart option
    if (imgFmt == "svg") {
        const imageData = renderSVG(option);
        window.heatmapAPI.storeImage(defaultName, imgFmt, imageData);
    }
    else if (imgFmt == "png") {
        saveAsPNG(option, defaultName, imgFmt);
    }
})

document.getElementById("details").addEventListener("click", function (e) {
    if (this.innerHTML == "Hide details") {
        const tvertDetails = document.querySelectorAll(".tvert-details");
        const infoDetails = document.querySelectorAll(".info-details");

        tvertDetails.forEach(element => {
            element.style.visibility = "hidden";
        });
        infoDetails.forEach(element => {
            element.style.height = "1px";
        });
        this.innerHTML = "Show details";
    }
    else {
        const tvertDetails = document.querySelectorAll(".tvert-details");
        const infoDetails = document.querySelectorAll(".info-details");

        tvertDetails.forEach(element => {
            element.style.visibility = "visible";
        });
        infoDetails.forEach(element => {
            element.style.height = "150px";
        });
        this.innerHTML = "Hide details";
    }
});

window.addEventListener('resize', function () {
    myChart.resize();
});

