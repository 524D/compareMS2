// SPDX-License-Identifier: MIT
// Pure JavaScript helpers for reading sample-to-species mapping files.

const fs = require('fs');
const path = require('path');

/**
 * Returns the filename segment for either POSIX ('/') or Windows ('\') paths.
 * @param {string} name
 * @returns {string}
 */
function sampleBaseName(name) {
    const parts = String(name).split(/[\\/]/);
    return parts[parts.length - 1];
}

/**
 * Parses tab-separated sample-to-species mapping text into exact and
 * case-insensitive lookup maps keyed by sample basename.
 * @param {string} rawContent
 * @returns {{ exactMap: Map<string, string>, lowerMap: Map<string, string> }}
 */
function parseSample2SpeciesContent(rawContent) {
    const exactMap = new Map();
    const lowerMap = new Map();
    if (typeof rawContent !== 'string' || rawContent.length === 0) {
        return { exactMap, lowerMap };
    }

    const normalized = rawContent.replace(/^\uFEFF/, '');
    const lines = normalized.split(/\r?\n|\r/);
    for (const line of lines) {
        if (line.trim() === '') {
            continue;
        }
        const parts = line.split('\t').map(p => p.trim()).filter(p => p !== '');
        if (parts.length >= 2) {
            const sample = sampleBaseName(parts[0]);
            const species = parts[1];
            if (sample !== '' && species !== '') {
                exactMap.set(sample, species);
                lowerMap.set(sample.toLowerCase(), species);
            }
        }
    }

    return { exactMap, lowerMap };
}

/**
 * Reads a sample-to-species TSV file and returns a mapping object covering
 * every basename in sampleFiles (falling back to the basename when unmapped).
 * @param {string|null|undefined} fn
 * @param {string[]} sampleFiles
 * @returns {Record<string, string>}
 */
function readSample2Species(fn, sampleFiles) {
    const sample2Species = {};
    const sampleFilesBaseNames = sampleFiles.map(file => path.basename(file));
    let exactMap = new Map();
    let lowerMap = new Map();

    if (typeof fn === 'string' && fn.trim() !== '' && fs.existsSync(fn)) {
        const sample2SpeciesRaw = fs.readFileSync(fn, 'utf8');
        ({ exactMap, lowerMap } = parseSample2SpeciesContent(sample2SpeciesRaw));
    }

    for (const sampleFn of sampleFilesBaseNames) {
        if (exactMap.has(sampleFn)) {
            sample2Species[sampleFn] = exactMap.get(sampleFn);
        } else if (lowerMap.has(sampleFn.toLowerCase())) {
            sample2Species[sampleFn] = lowerMap.get(sampleFn.toLowerCase());
        } else {
            sample2Species[sampleFn] = sampleFn;
        }
    }

    return sample2Species;
}

module.exports = {
    sampleBaseName,
    parseSample2SpeciesContent,
    readSample2Species,
};
