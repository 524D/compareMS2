// SPDX-License-Identifier: MIT
// Pure JavaScript Fisher's Exact Test, BH-FDR, and library enrichment helpers for spectra2species.

const LOG_FACTORIAL_CACHE_LIMIT = 200000;
const logFactCache = [0.0, 0.0];

// Lanczos approximation for ln(Gamma(z)) when n exceeds the precomputed cache limit.
function logGamma(z) {
    const g = 7;
    const p = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7,
    ];
    if (z < 0.5) {
        return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    const z1 = z - 1;
    let x = p[0];
    for (let i = 1; i < p.length; i++) {
        x += p[i] / (z1 + i);
    }
    const t = z1 + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function logFactorial(n) {
    const k = Math.max(0, Math.floor(n));
    if (k <= LOG_FACTORIAL_CACHE_LIMIT) {
        for (let i = logFactCache.length; i <= k; i++) {
            logFactCache[i] = logFactCache[i - 1] + Math.log(i);
        }
        return logFactCache[k];
    }
    return logGamma(k + 1);
}

function logChoose(n, k) {
    if (k < 0 || k > n) {
        return -Infinity;
    }
    if (k === 0 || k === n) {
        return 0.0;
    }
    return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function hypergeometricPMF(k, row1, row2, col1) {
    const total = row1 + row2;
    if (k < 0 || k > row1 || col1 - k < 0 || col1 - k > row2) {
        return 0.0;
    }
    return Math.exp(logChoose(row1, k) + logChoose(row2, col1 - k) - logChoose(total, col1));
}

function clamp01(val) {
    if (!Number.isFinite(val) || val < 0) {
        return 0.0;
    }
    return val > 1.0 ? 1.0 : val;
}

function toNonNegInt(val) {
    if (!Number.isFinite(val)) {
        return 0;
    }
    return Math.max(0, Math.round(val));
}

/**
 * Computes Fisher's Exact Test statistics for a 2x2 contingency table:
 *
 *               Matched   Unmatched
 *   Category  |   a     |     b     |  row1 = a + b
 *   Other     |   c     |     d     |  row2 = c + d
 *
 * Returns pPoint, pLess ("less"), pGreater ("greater" / enrichment),
 * pTwoSided, oddsRatio, and foldEnrichment.
 */
function fisherExactTest(aRaw, bRaw, cRaw, dRaw) {
    const a = toNonNegInt(aRaw);
    const b = toNonNegInt(bRaw);
    const c = toNonNegInt(cRaw);
    const d = toNonNegInt(dRaw);

    const row1 = a + b;
    const row2 = c + d;
    const col1 = a + c;
    const total = row1 + row2;

    if (total === 0 || row1 === 0 || row2 === 0) {
        return {
            pPoint: 1.0,
            pLess: 1.0,
            pGreater: 1.0,
            pTwoSided: 1.0,
            oddsRatio: 1.0,
            oddsRatioHA: 1.0,
            foldEnrichment: 1.0,
        };
    }

    const kMin = Math.max(0, col1 - row2);
    const kMax = Math.min(row1, col1);
    const pPoint = clamp01(hypergeometricPMF(a, row1, row2, col1));

    let pLess = 0.0;
    let pGreater = 0.0;
    let pTwoSided = 0.0;
    const twoSidedThreshold = pPoint * (1.0 + 1e-7);

    for (let k = kMin; k <= kMax; k++) {
        const pmf = hypergeometricPMF(k, row1, row2, col1);
        if (k <= a) {
            pLess += pmf;
        }
        if (k >= a) {
            pGreater += pmf;
        }
        if (pmf <= twoSidedThreshold) {
            pTwoSided += pmf;
        }
    }

    const oddsRatio = b * c === 0 ? (a * d > 0 ? Infinity : 1.0) : (a * d) / (b * c);
    const hasZeroCell = a === 0 || b === 0 || c === 0 || d === 0;
    const oddsRatioHA = hasZeroCell ? ((a + 0.5) * (d + 0.5)) / ((b + 0.5) * (c + 0.5)) : oddsRatio;
    const foldEnrichment = col1 === 0 ? 0.0 : (a / row1) / (col1 / total);

    return {
        pPoint,
        pLess: clamp01(pLess),
        pGreater: clamp01(pGreater),
        pTwoSided: clamp01(pTwoSided),
        oddsRatio,
        oddsRatioHA,
        foldEnrichment,
    };
}

/**
 * Benjamini-Hochberg step-up FDR adjustment preserving original index order.
 */
function benjaminiHochberg(pValues) {
    const m = pValues.length;
    if (m === 0) {
        return [];
    }
    const indexed = pValues.map((p, idx) => ({
        idx,
        p: clamp01(Number.isFinite(p) ? p : 1.0),
    }));
    indexed.sort((x, y) => x.p - y.p);

    const adjusted = new Array(m);
    let minRunning = 1.0;
    for (let rankIdx = m - 1; rankIdx >= 0; rankIdx--) {
        const raw = Math.min(1.0, (indexed[rankIdx].p * m) / (rankIdx + 1));
        minRunning = Math.min(minRunning, raw);
        adjusted[indexed[rankIdx].idx] = clamp01(minRunning);
    }
    return adjusted;
}

/**
 * Annotates each species/category item with Fisher's Exact Test enrichment statistics
 * comparing that category's matched spectra against all other categories in the library.
 */
function computeLibraryEnrichment(speciesItems) {
    if (!Array.isArray(speciesItems) || speciesItems.length === 0) {
        return [];
    }

    const normalized = speciesItems.map((item) => {
        const matched = toNonNegInt(item.matched);
        const total = Math.max(matched, toNonNegInt(item.total));
        const unmatched = Math.max(0, total - matched);
        return { item, matched, total, unmatched };
    });

    const totalMatched = normalized.reduce((acc, row) => acc + row.matched, 0);
    const totalUnmatched = normalized.reduce((acc, row) => acc + row.unmatched, 0);

    const rawTests = normalized.map((row) => {
        const a = row.matched;
        const b = row.unmatched;
        const c = Math.max(0, totalMatched - a);
        const d = Math.max(0, totalUnmatched - b);
        const test = fisherExactTest(a, b, c, d);
        return { row, a, b, c, d, test };
    });

    const fdrGreater = benjaminiHochberg(rawTests.map((entry) => entry.test.pGreater));
    const fdrTwoSided = benjaminiHochberg(rawTests.map((entry) => entry.test.pTwoSided));

    return rawTests.map((entry, idx) => {
        const pGreater = entry.test.pGreater;
        const negLog10P = Math.round(-Math.log10(Math.max(pGreater, 1e-300)) * 10000) / 10000;
        return {
            ...entry.row.item,
            enrichment: {
                a: entry.a,
                b: entry.b,
                c: entry.c,
                d: entry.d,
                matched: entry.a,
                total: entry.row.total,
                foldEnrichment: entry.test.foldEnrichment,
                oddsRatio: entry.test.oddsRatio,
                oddsRatioHA: entry.test.oddsRatioHA,
                pPoint: entry.test.pPoint,
                pGreater,
                pLess: entry.test.pLess,
                pTwoSided: entry.test.pTwoSided,
                fdrGreater: fdrGreater[idx],
                fdrTwoSided: fdrTwoSided[idx],
                negLog10P,
            },
        };
    });
}

function formatNumberForTSV(val) {
    if (val === Infinity) {
        return 'Inf';
    }
    if (val === -Infinity) {
        return '-Inf';
    }
    if (!Number.isFinite(val)) {
        return 'NA';
    }
    return String(val);
}

/**
 * Serializes distanceMap (with enrichment metadata) to a tab-separated table.
 */
function enrichmentToTSV(distanceMap) {
    const header = [
        'species',
        'samples',
        'distance',
        'similarity',
        'matched_a',
        'unmatched_b',
        'bg_matched_c',
        'bg_unmatched_d',
        'fold_enrichment',
        'odds_ratio',
        'odds_ratio_ha',
        'p_enrich_greater',
        'fdr_enrich',
        'p_deplete_less',
        'p_two_sided',
    ].join('\t');

    if (!Array.isArray(distanceMap) || distanceMap.length === 0) {
        return header + '\n';
    }

    const lines = distanceMap.map((item) => {
        const enr = item.enrichment || {};
        return [
            item.species || '',
            item.sampleCount || 1,
            formatNumberForTSV(item.distance),
            formatNumberForTSV(item.similarity),
            enr.a ?? 0,
            enr.b ?? 0,
            enr.c ?? 0,
            enr.d ?? 0,
            formatNumberForTSV(enr.foldEnrichment),
            formatNumberForTSV(enr.oddsRatio),
            formatNumberForTSV(enr.oddsRatioHA),
            formatNumberForTSV(enr.pGreater),
            formatNumberForTSV(enr.fdrGreater),
            formatNumberForTSV(enr.pLess),
            formatNumberForTSV(enr.pTwoSided),
        ].join('\t');
    });

    return [header, ...lines].join('\n') + '\n';
}

module.exports = {
    logFactorial,
    logChoose,
    hypergeometricPMF,
    fisherExactTest,
    benjaminiHochberg,
    computeLibraryEnrichment,
    enrichmentToTSV,
};
