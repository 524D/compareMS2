// SPDX-License-Identifier: MIT
// Copyright 2022 Rob Marissen.

// Convert a distance matrix into a phylogenetic tree
// The tree is represented in Newick format

function lowestCell(table) {
    // Set default to infinity
    var minCell = Number.MAX_VALUE;
    var row = -1;
    var col = -1;

    // Go through every cell, looking for the lowest
    for (var i = 0; i < table.length; i++) {
        for (var j = 0; j < table[i].length; j++) {
            if (table[i][j] < minCell) {
                minCell = table[i][j];
                row = i; col = j;
            }
        }
    }

    return [row, col, minCell];
}

// Debug function: Check if any of the cells has an invalid value
let prevm;
let failed = 0;

function anycellNull(m, id, r, c, ii) {
    if (failed === 0) {
        for (let i = 1; i < m.length; i++) {
            if (m[i].length !== i) {
                console.log(">>>>>>>>>>>>>>>>>>>>> length error: i=", i, " length=", m[i].length);
            }
            for (let j = 0; j < m[i].length; j++) {
                if (isNaN(m[i][j]) || (!(m[i][j] > 0))) {
                    console.log(">>>>>>>>>>>>>>>>>>>>> element [" + i + "][" + j + "]");
                    console.log(" of [" + m.length - 1 + "]");
                    console.log("[" + m[i].length - 1 + "] err id: " +
                        id + " r " + r + " c " + c + " i " + ii);
                    console.log("previous ", JSON.stringify(prevm));
                    console.log("current ", JSON.stringify(m));
                    failed = 1;
                    return
                }
            }
        }
        prevm = [];
        for (let i = 0; i < m.length; i++) {
            prevm[i] = m[i].slice();
        }
    }
}

// join_labels:
//   Combines two labels in a list of labels
function joinLabels(labels, dist, leafDist, a, b) {
    // Swap if the indices are not ordered
    if (b < a) {
        [a, b] = [b, a];
    }
    // Join the labels in the first index
    labels[a] = "(" + labels[a] + ":" + (dist / 2 - leafDist[a]) + "," +
        labels[b] + ":" + (dist / 2 - leafDist[b]) + ")";

    leafDist[a] = dist / 2;
    // Remove the (now redundant) label in the second index
    labels.splice(b, 1);
    leafDist.splice(b, 1);
}

// join_table:
//   Joins the entries of a table on the cell (r, c) by averaging their data entries
function joinTable(table, weight, r, c) {
    // Note: since we only process the lower part of the matrix,
    // for all cells coordinates (row,column) the following is true: row>column

    if (r <= c) {
        console.log("ERROR: upgma joinTable r<c:" + r + " " + c)
    }

    // For the lower (column) index, compute row (A, i), where i < A
    var row = [];
    var rowweight = [];

    for (var i = 0; i < c; i++) {
        row.push(((table[c][i] * weight[c][i]) + table[r][i] * weight[r][i]) / (weight[c][i] + weight[r][i]));
        rowweight.push(weight[c][i] + weight[r][i]);
    }

    table[c] = row;
    weight[c] = rowweight;

    // Compute column (i, A), where i > A
    //   Note: Since the matrix is lower triangular, row r only contains values for indices < r
    for (var i = c + 1; i < r; i++) {
        table[i][c] = ((table[i][c] * weight[i][c]) + (table[r][i] * weight[r][i])) / (weight[i][c] + weight[r][i]);
        weight[i][c] = weight[i][c] + weight[r][i];
    }
    //   We get the rest of the values from row i
    for (var i = r + 1; i < table.length; i++) {
        table[i][c] = ((table[i][c] * weight[i][c]) + (table[i][r] * weight[i][r])) / (weight[i][c] + weight[i][r]);
        weight[i][c] = (weight[i][c] + weight[i][r]);
    }
    // Remove the second index column entry
    for (var i = r + 1; i < table.length; i++) {
        table[i].splice(r, 1);
        weight[i].splice(r, 1);
    }

    // Remove the second index row
    table.splice(r, 1);
    weight.splice(r, 1);
}

// UPGMA:
//   Runs the UPGMA algorithm
//   Input:
//     table: lower left part of distance matrix
//     labelsIn: labels that correspond to columns
//   Output:
//     newick: distance tree in newick format
//   Note:
//     Some characters in labels interfere with newick format.
//     These characters are replaced by underscore    
function UPGMA(table, labelsIn) {
    // Replace invalid label characters
    const labels = labelsIn.map(l => l.replace(/[ :;,()\[\]]/g, "_"));

    // Check if table format is correct (lower triangular). If not, skip processing
    for (let i = 1; i < table.length; i++) {
        if (table[i].length !== i) {
            console.log("UPGMA ERROR: table not lower-left triangle: i=", i, " length=", table[i].length);
            return ("")
        }
    }
    // Weight of each cell in distance matrix
    var weight = [];
    for (var i = 0; i < table.length; i++) {
        weight[i] = [];
        for (var j = 0; j < table[i].length; j++) {
            weight[i][j] = 1;
        }
    }

    // Distance of each cluster to the leafs
    var leafDist = [];
    for (var i = 0; i < labels.length; i++) {
        leafDist.push(0);
    }
    // Until all labels have been joined...
    while ((labels.length > 1) && (table.length >= 1)) {
        // Locate lowest cell in the table
        var [r, c, dist] = lowestCell(table);
        // Update the labels accordingly
        joinLabels(labels, dist, leafDist, r, c);
        // Join the table on the cell co-ordinates
        joinTable(table, weight, r, c);
    }

    let newick = labels[0];
    // Avoid returning 'undefined'
    if (typeof newick === 'undefined') {
        newick = "";
    }
    return newick;
}

function testExpectUPGMA(table, labels, expect) {
    let comp = JSON.stringify(UPGMA(table, labels));
    if (comp !== expect) {
        console.error("UPGMA output: " + comp);
        console.error("    Expected: " + expect);
    }
}


function testUPGMA() {
    let table, labels, expect;
    // Example from: http://www.slimsuite.unsw.edu.au/teaching/upgma/
    // Same matrix also on: http://www.nmsr.org/upgma.htm but with incorrect results!
    table = [
        [],                         //A
        [19],                       //B
        [27, 31],                   //C
        [8, 18, 26],                //D
        [33, 36, 41, 31],           //E
        [18, 1, 32, 17, 35],        //F
        [13, 13, 29, 14, 28, 12]    //G
    ];
    labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect = '"((((A:4,D:4):4.25,((B:0.5,F:0.5):5.75,G:6.25):2):6.25,C:14.5):2.5,E:17)"';
    testExpectUPGMA(table, labels, expect);

    // Example from: https://en.wikipedia.org/wiki/UPGMA
    table = [
        [],                         //A
        [17],                       //B
        [21, 30],                   //C
        [31, 34, 28],               //D
        [23, 21, 39, 43],           //E
    ];
    labels = ['A', 'B', 'C', 'D', 'E'];
    expect = '"(((A:8.5,B:8.5):2.5,E:11):5.5,(C:14,D:14):2.5)"';
    testExpectUPGMA(table, labels, expect);
}

testUPGMA();