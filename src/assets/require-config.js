// RequireJS configuration for tree.js dependencies
requirejs.config({
    baseUrl: './assets',
    waitSeconds: 60, // Avoid timeout
    paths: {
        'd3': 'd3.min',
        'phylotree': 'phylotree.min',
        'd3ToPng': 'd3-svg-to-png-modified',
        'lodash': 'lodash',
        'underscore': 'underscore-min'
    },
    shim: {
        'phylotree': {
            deps: ['d3'],
            exports: 'phylotree'
        },
        'd3ToPng': {
            deps: ['d3'],
            exports: 'd3ToPng'
        }
    }
});

// Load the required modules and make them globally available
require(['d3', 'phylotree', 'd3ToPng'], function (d3, phylotree, d3ToPng) {
    // Make libraries globally available for tree.js
    window.d3 = d3;
    window.phylotree = phylotree;
    window.d3ToPng = d3ToPng;

    // Signal that libraries are loaded
    window.librariesLoaded = true;

    // Dispatch a custom event to notify tree.js that libraries are ready
    const event = new CustomEvent('librariesReady');
    document.dispatchEvent(event);

    // Load tree.js after libraries are ready
    const script = document.createElement('script');
    script.src = './tree.js';
    document.head.appendChild(script);
});

