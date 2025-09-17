// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// Wait for libraries to be available before initializing
(function () {
    function initializeTree() {
        // Libraries are now loaded via RequireJS and available as global variables
        // d3, phylotree, and d3ToPng are available as global variables

        const legendWidth = 320;

        let qualMap = new Map();
        let qualMax = 0;
        let qualMin = 0;
        let qualAvg = 0;
        let color_scale = d3.scaleLinear().domain([0, 5, 9]).range(["#FF0000", "#0000FF", "#00FF00"]);
        let tree;
        let rendered_tree;
        let newick = '';
        let topology = '';
        let legendTimer;

        const treeOptions = {
            'container': "#main-chart",
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

        // Initialize with test tree
        const test_string = "(((EELA:0.150276,CONGERA:0.213019):0.230956,(EELB:0.263487,CONGERB:0.202633):0.246917):0.094785,((CAVEFISH:0.451027,(GOLDFISH:0.340495,ZEBRAFISH:0.390163):0.220565):0.067778,((((((NSAM:0.008113,NARG:0.014065):0.052991,SPUN:0.061003,(SMIC:0.027806,SDIA:0.015298,SXAN:0.046873):0.046977):0.009822,(NAUR:0.081298,(SSPI:0.023876,STIE:0.013652):0.058179):0.091775):0.073346,(MVIO:0.012271,MBER:0.039798):0.178835):0.147992,((BFNKILLIFISH:0.317455,(ONIL:0.029217,XCAU:0.084388):0.201166):0.055908,THORNYHEAD:0.252481):0.061905):0.157214,LAMPFISH:0.717196,((SCABBARDA:0.189684,SCABBARDB:0.362015):0.282263,((VIPERFISH:0.318217,BLACKDRAGON:0.109912):0.123642,LOOSEJAW:0.397100):0.287152):0.140663):0.206729):0.222485,(COELACANTH:0.558103,((CLAWEDFROG:0.441842,SALAMANDER:0.299607):0.135307,((CHAMELEON:0.771665,((PIGEON:0.150909,CHICKEN:0.172733):0.082163,ZEBRAFINCH:0.099172):0.272338):0.014055,((BOVINE:0.167569,DOLPHIN:0.157450):0.104783,ELEPHANT:0.166557):0.367205):0.050892):0.114731):0.295021)myroot";
        tree = new phylotree.phylotree(test_string);
        rendered_tree = tree.render(treeOptions);

        // ******************************* Display Functions ******************************************** //

        function colorNodesByName(element, data) {
            let specie = data.data.name;
            let q = qualMap.get(specie);
            if (q) {
                let s = color_scale(q);
                element.style("fill", s);
            }
        }

        function escapeHtml(unsafe) {
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function llog(msg) {
            msg = msg.replace(/(?:\r\n|\r|\n)/g, '<br>');
            msg = msg.replace(/(?: )/g, '&nbsp;');
            document.getElementById('stdout').innerHTML += msg;
        }

        function elog(msg) {
            msg = msg.replace(/(?:\r\n|\r|\n)/g, '<br>');
            msg = msg.replace(/(?: )/g, '&nbsp;');
            msg = '<span class="warn">' + msg + '</span>';
            document.getElementById('stdout').innerHTML += msg;
        }

        function updateTree(treeData) {
            newick = treeData.newick;
            topology = treeData.topology;

            // Update quality data
            qualMap = new Map(Object.entries(treeData.qualMap));
            qualMax = treeData.qualMax;
            qualMin = treeData.qualMin;
            qualAvg = treeData.qualAvg;

            // Update color scale and render tree
            getColorScale();

            if (newick.includes(",")) {
                const useTopology = document.getElementById("topology").checked;
                tree = new phylotree.phylotree(useTopology ? topology : newick);
                rendered_tree = tree.render(treeOptions);

                // FIXME: Get rid of jQuery below. However, the plain HTML in comment doesn't work
                // sh = rendered_tree.show();
                // document.querySelector(rendered_tree.container).innerHTML = sh.innerHTML;
                $(rendered_tree.container).html(rendered_tree.show())

                addLegend();
            }
        }

        function displayTree(useTopology, radial) {
            tree = new phylotree.phylotree(useTopology ? topology : newick);
            rendered_tree = tree.render(treeOptions);
            rendered_tree.radial(radial).update(true);

            // FIXME: Get rid of jQuery below. However, the plain HTML in comment doesn't work
            // sh = rendered_tree.show();
            // document.querySelector(rendered_tree.container).innerHTML = sh.innerHTML;
            $(rendered_tree.container).html(rendered_tree.show())
        }

        function getSelectedScale() {
            return document.getElementById("qscale").value;
        }

        function getColorScale() {
            let qscale = getSelectedScale();
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
                    color_scale = d3.scaleLinear().domain([0, qualMax]).range(["#000000", "#000000"]);
            }
        }

        function addLegend() {
            // FIXME: Awful use of timer, to delay the resize of SVG until phylotree/d3 is done with it.
            clearTimeout(legendTimer);
            legendTimer = setTimeout(function () {
                let svg = d3.select("svg");
                svg.selectAll(".legend-container").remove();

                if (getSelectedScale() != "black") {
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

        // ******************************* Event Handlers ******************************************** //

        // Set up event listeners
        window.treeAPI.onProgressUpdate((event, progress) => {
            document.getElementById('progress').value = progress;
        });

        window.treeAPI.onActivityUpdate((event, activity) => {
            document.getElementById('activity').innerHTML = escapeHtml(activity);
        });

        window.treeAPI.onLogMessage((event, message) => {
            llog(message);
        });

        window.treeAPI.onLogError((event, message) => {
            elog(message);
        });

        window.treeAPI.onTreeData((event, treeData) => {
            updateTree(treeData);
        });

        window.treeAPI.onComputationFinished((event) => {
            document.getElementById('pause').disabled = true;
            document.getElementById('details').disabled = true;
            document.querySelector(".tvert-details").style.visibility = "hidden";
            document.querySelector(".info-details").style.height = "1px";
        });

        // UI Event Handlers
        document.getElementById("layout").addEventListener("change", function (e) {
            rendered_tree.radial(e.target.checked).update(true);
            addLegend();
        });

        document.getElementById("topology").addEventListener("change", function (e) {
            let topologyOnly = e.target.checked;
            treeOptions['show-scale'] = !topologyOnly;
            tree = new phylotree.phylotree(topologyOnly ? topology : newick);
            rendered_tree = tree.render(treeOptions);

            // FIXME: Get rid of jQuery below
            $(rendered_tree.container).html(rendered_tree.show())
            addLegend();
        });

        document.getElementById("details").addEventListener("click", function (e) {
            const detailsDiv = document.querySelector(".tvert-details");
            const infoDiv = document.querySelector(".info-details");

            if (this.innerHTML == "Hide details") {
                detailsDiv.style.visibility = "hidden";
                infoDiv.style.height = "1px";
                this.innerHTML = "Show details";
            } else {
                detailsDiv.style.visibility = "visible";
                infoDiv.style.height = "150px";
                this.innerHTML = "Hide details";
            }
        });

        document.getElementById("qscale").addEventListener("change", function (e) {
            getColorScale();
            rendered_tree.update(true);
            addLegend();
        });

        document.getElementById("store-image").addEventListener("click", function (e) {
            const imageType = document.getElementById('img-type').value;
            if (imageType == "svg") {
                const svg = document.querySelector('#main-chart svg');
                const svgData = new XMLSerializer().serializeToString(svg);
                window.treeAPI.downloadImage('svg', svgData, 'phylotree.svg');
            } else if (imageType == "png") {
                d3ToPng('#main-chart svg', 'phylotree', { scale: 5 });
            }
        });

        // Toggle full screen on F11
        document.addEventListener("keydown", event => {
            if (event.key === "F11") {
                window.heatmapAPI.toggleFullscreen();
            }
        });

        // ******************************* Legend Function ******************************************** //

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
    }

    // Check if libraries are already loaded or wait for them
    if (window.librariesLoaded) {
        initializeTree();
    } else {
        document.addEventListener('librariesReady', initializeTree);
    }
})();
