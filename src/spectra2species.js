var chartDom = document.getElementById('main-chart');
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
        calculable: true,
        realtime: true,
        min: 0,
        max: 1,
        precision: 3,
        right: 0,
        top: 'center',
        itemHeight: 300
    },
    series: [
        {
            data: [],
            type: 'bar'
        }
    ]
};

option && myChart.setOption(option);
updateQScale();
// Show the "loading" animation
myChart.showLoading({
    text: 'Working',
    fontSize: 24,
    spinnerRadius: 20,
    lineWidth: 8,
});

var latestPayload = null;

// The function updateChart is called by the main process through the preload script
window.s2sAPI.updateChart((distanceMap, compareDir, mzFile1, s2sFile) => {
    // Hide the "loading" animation
    myChart.hideLoading();
    latestPayload = { distanceMap, compareDir, mzFile1, s2sFile };
    const exportBtn = document.getElementById('export-enrichment');
    if (exportBtn) {
        exportBtn.disabled = !Array.isArray(distanceMap) || distanceMap.length === 0;
    }
    renderCurrentView();
})

// Handle log messages from the main process
window.s2sAPI.onLogMessage((message) => {
    message = message.replace(/(?:\r\n|\r|\n)/g, '<br>');
    message = message.replace(/(?: )/g, '&nbsp;');
    appendToStdout(message + '<br>');
});

// Handle log error messages from the main process
window.s2sAPI.onLogError((message) => {
    message = message.replace(/(?:\r\n|\r|\n)/g, '<br>');
    message = message.replace(/(?: )/g, '&nbsp;');
    appendToStdout(`<span class="warn">${message}</span><br>`);
});

window.s2sAPI.onSetLogPath((logPath) => {
    setLogPath(logPath);
});

// Handle activity messages from the main process
window.s2sAPI.onSetActivity((message) => {
    message = message.replace(/(?:\r\n|\r|\n)/g, '<br>');
    message = message.replace(/(?: )/g, '&nbsp;');
    // Append the message to the output div
    const outputDiv = document.getElementById('activity');
    if (outputDiv) {
        outputDiv.innerHTML = message;
    }
});

// Handle error messages from the main process
window.s2sAPI.onError((message) => {
    alert(message);
});

// Handle progress updates from the main process
window.s2sAPI.onProgressUpdate((progress) => {
    const progressBar = document.getElementById('progress');
    if (progressBar) {
        progressBar.value = progress;
    }
});

function getSelectedScale() {
    const selectElement = document.getElementById("qscale");
    return selectElement.value;
}

function updateQScale() {
    let cScale = getSelectedScale();
    const { colorScale, highlightColor } = getColorScale(cScale);
    myChart.setOption({
        visualMap: {
            inRange: {
                color: colorScale
            }
        },
        series: [{
            emphasis: {
                itemStyle: {
                    color: highlightColor // Change color on hover
                }
            }
        }]
    });
}

function getColorScale(cScale) {
    // Set the color scale based on the selected option
    let colorScale = [];
    let highlightColor = '#FF00FF'; // Default highlight color
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
    return { colorScale, highlightColor };
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

// Function saveAsPNG is renders the chart to a PNG buffer and sends it to the main process
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
                window.s2sAPI.storeImage(defaultName, imgFmt, aBuffer);
            });
        });
        chart.dispose();
    });
    return;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatPValue(val) {
    if (!Number.isFinite(val)) {
        return val === Infinity ? 'Inf' : 'NA';
    }
    if (val < 0.0001 && val > 0) {
        return val.toExponential(2);
    }
    return val.toFixed(4);
}

function formatRatio(val) {
    if (val === Infinity) {
        return 'Inf';
    }
    if (!Number.isFinite(val)) {
        return 'NA';
    }
    return val.toFixed(2);
}

function getSelectedChartMetric() {
    const el = document.getElementById('chart-metric');
    return el ? el.value : 'similarity';
}

function getMetricValue(item, metric) {
    const enr = item.enrichment || {};
    if (metric === 'enrichment_neglog10p') {
        return Number.isFinite(enr.negLog10P) ? enr.negLog10P : 0;
    }
    if (metric === 'fold_enrichment') {
        return Number.isFinite(enr.foldEnrichment) ? Math.round(enr.foldEnrichment * 10000) / 10000 : 0;
    }
    return Number.isFinite(item.similarity) ? item.similarity : 0;
}

function renderCurrentView() {
    if (!latestPayload) {
        return;
    }
    const { distanceMap, compareDir, mzFile1, s2sFile } = latestPayload;
    const metric = getSelectedChartMetric();
    const chartOpt = makeEChartsOption(distanceMap, compareDir, mzFile1, s2sFile, metric);
    myChart.setOption(chartOpt, true);
    updateQScale();
    renderEnrichmentTable(distanceMap);
}

function renderEnrichmentTable(distanceMap) {
    const tbody = document.getElementById('enrichment-tbody');
    if (!tbody) {
        return;
    }
    tbody.replaceChildren();
    if (!Array.isArray(distanceMap)) {
        return;
    }

    for (const item of distanceMap) {
        const enr = item.enrichment || {};
        const tr = document.createElement('tr');
        if (Number.isFinite(enr.pGreater) && enr.pGreater < 0.05) {
            tr.className = 'enriched-row';
        }

        const catTotal = (enr.a || 0) + (enr.b || 0);
        const bgTotal = (enr.c || 0) + (enr.d || 0);
        const cells = [
            item.species || '',
            String(item.sampleCount || 1),
            Number.isFinite(item.similarity) ? item.similarity.toFixed(4) : 'NA',
            `${enr.a ?? 0} / ${catTotal}`,
            `${enr.c ?? 0} / ${bgTotal}`,
            formatRatio(enr.foldEnrichment),
            formatRatio(enr.oddsRatio),
            formatRatio(enr.oddsRatioHA),
            formatPValue(enr.pGreater),
            formatPValue(enr.fdrGreater),
            formatPValue(enr.pTwoSided),
        ];

        for (const text of cells) {
            const td = document.createElement('td');
            td.textContent = text;
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
}

// Create the echartData object for the eCharts bar chart
function makeEChartsOption(distanceMap, dirName, mzFile1, s2sFile, metric = 'similarity') {
    const values = distanceMap.map(item => getMetricValue(item, metric));
    const rawMax = values.length > 0 ? Math.max(...values) : 0;
    const maxVal = rawMax > 0 ? rawMax : 1;

    let yAxisName = 'Similarity';
    let seriesName = 'Similarity';
    let markLine = undefined;
    if (metric === 'enrichment_neglog10p') {
        yAxisName = 'Fisher -log10(p)';
        seriesName = 'Fisher -log10(p)';
        if (distanceMap.length > 0) {
            markLine = {
                silent: true,
                symbol: 'none',
                lineStyle: { type: 'dashed', color: '#444' },
                data: [{ yAxis: 1.301, name: 'p = 0.05' }]
            };
        }
    } else if (metric === 'fold_enrichment') {
        yAxisName = 'Fold Enrichment';
        seriesName = 'Fold Enrichment';
        if (distanceMap.length > 0) {
            markLine = {
                silent: true,
                symbol: 'none',
                lineStyle: { type: 'dashed', color: '#444' },
                data: [{ yAxis: 1.0, name: 'Fold = 1.0' }]
            };
        }
    }

    // Adjust the font size according to the number of items in the distanceMap
    const fontSize = Math.max(10, 12 - Math.floor(distanceMap.length / 10)); // Decrease font size as the number of items increases, but not below 10
    var subText = 'comparing to directory: ' + dirName;
    if (s2sFile) {
        subText += ' using mapping file ' + s2sFile;
    }

    return {
        title: {
            text: 'spectra2species comparison for ' + mzFile1,
            subtext: subText,
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'shadow' // Use shadow pointer for bar chart
            },
            formatter: (params) => {
                if (!Array.isArray(params) || params.length === 0 || !params[0].data) {
                    return '';
                }
                const item = params[0].data.item;
                if (!item) {
                    return '';
                }
                const enr = item.enrichment || {};
                const catTotal = (enr.a || 0) + (enr.b || 0);
                return [
                    `<strong>${escapeHtml(item.species)}</strong>`,
                    `Similarity: ${Number.isFinite(item.similarity) ? item.similarity.toFixed(4) : 'NA'} (distance: ${Number.isFinite(item.distance) ? item.distance.toFixed(4) : 'NA'})`,
                    `Matched (a / a+b): ${enr.a ?? 0} / ${catTotal}`,
                    `Fold Enrichment: ${formatRatio(enr.foldEnrichment)} | Odds Ratio: ${formatRatio(enr.oddsRatio)} (HA: ${formatRatio(enr.oddsRatioHA)})`,
                    `Fisher p (enrich): ${formatPValue(enr.pGreater)} | BH FDR: ${formatPValue(enr.fdrGreater)}`,
                    `Fisher p (deplete): ${formatPValue(enr.pLess)} | Two-sided: ${formatPValue(enr.pTwoSided)}`
                ].join('<br>');
            }
        },
        grid: {
            left: '13%',
            right: '10%',
            bottom: '2%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: distanceMap.map(item => item.species), // Use species names as x-axis
            axisLabel: {
                interval: 0, // Show all labels
                rotate: 45, // Rotate labels for better readability
                overflow: 'truncate', // Truncate labels that are too long
                textStyle: {
                    fontSize: fontSize
                }
            }
        },
        yAxis: {
            type: 'value',
            name: yAxisName,
            nameLocation: 'middle',
            nameGap: 50, // Space between the axis name and the axis line
            nameTextStyle: {
                fontSize: 17,
            },
            axisLabel: {
                formatter: '{value}' // Format the y-axis labels
            }
        },
        visualMap: {
            calculable: true,
            realtime: true,
            min: 0,
            max: maxVal,
            precision: 3,
            right: 0,
            top: 'center',
            itemHeight: 300
        },

        series: [{
            name: seriesName,
            type: 'bar',
            markLine,
            data: distanceMap.map((item, idx) => ({
                value: values[idx],
                item
            }))
        }]
    };
}

// Toggle full screen on F11
document.addEventListener("keydown", event => {
    var key = event.key;
    if (key == "F11") {
        window.s2sAPI.toggleFullscreen();
    }
});

// Switch chart metric when selection changes
document.getElementById("chart-metric").addEventListener("change", function () {
    renderCurrentView();
});

// Toggle Fisher's exact enrichment table visibility
document.getElementById("toggle-enrichment-table").addEventListener("change", function () {
    const panel = document.getElementById("enrichment-panel");
    if (panel) {
        panel.style.display = this.checked ? "block" : "none";
        myChart.resize();
    }
});

// Export enrichment results to TSV
document.getElementById("export-enrichment").addEventListener("click", function () {
    if (!latestPayload) {
        return;
    }
    const baseName = "spectra2species_enrichment_" + latestPayload.mzFile1.replace(/\.[^.]+$/, "");
    window.s2sAPI.exportEnrichment(baseName, latestPayload.distanceMap);
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
        window.s2sAPI.storeImage(defaultName, imgFmt, imageData);
    }
    else if (imgFmt == "png") {
        saveAsPNG(option, defaultName, imgFmt);
    }
})

document.getElementById("details").addEventListener("click", function (e) {
    const tvertDetails = document.querySelectorAll(".tvert-details");
    const expanded = this.getAttribute("aria-expanded") === "true";

    tvertDetails.forEach(element => { element.style.display = expanded ? "none" : "block"; });
    this.setAttribute("aria-expanded", String(!expanded));
    this.textContent = expanded ? "Show details" : "Hide details";
});

window.addEventListener('resize', function () {
    myChart.resize();
});
