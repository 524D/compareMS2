// import * as echarts from './assets/echarts.5.6.0.min.js';

var chartDom = document.getElementById('main');
var myChart = echarts.init(chartDom);
var option;

option = {
    title: {
        text: '',
        subtext: '',
        left: 'center'
    },

    tooltip: {
        trigger: 'axis',
        axisPointer: {
            type: 'shadow' // Use shadow pointer for bar chart
        }
    },

    xAxis: {
        type: 'category',
        data: []
    },
    yAxis: {
        type: 'value'
    },
    visualMap: {
        calculable: false,
        realtime: false,
        min: 0,
        max: 1,
        right: 0,
        top: 'center',
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
            data: [],
            type: 'bar'
        }
    ]
};

option && myChart.setOption(option);

// The function updateEchartJSON is called by the main process through the preload script
window.s2sAPI.updateEchartJSON((option) => {
    option && myChart.setOption(option);
})


function elog(...args) {
    // Log to the console if debug mode is enabled
    if (window.s2sAPI.isDebugMode()) {
        console.log(...args);
    }
}

function getSelectedScale() {
    const selectElement = document.getElementById("qscale");
    return selectElement.value;
}

function updateQScale() {
    let cScale = getSelectedScale();
    const colorScale = getColorScale(cScale);
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
            elog("Unknown color scale:", cScale);
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
        canvas.toBlob(function (blob) {
            blob.arrayBuffer().then(function (aBuffer) {
                // Convert to Node.js Buffer
                const buffer = Buffer.from(aBuffer);
                ipcRenderer.send('store-image', "png", buffer, 0);
            });
        });
        chart.dispose();
    });
    return;
}

// Set color scale when selection changes
document.getElementById("qscale").addEventListener("change", function () {
    updateQScale();
});

document.getElementById("store-image").addEventListener("click", function (e) {
    const imgFmt = document.getElementById('img-type').value;
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
