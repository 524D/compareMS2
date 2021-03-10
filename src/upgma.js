// Convert a distance matrix into a phylogenetic tree
// The tree is represented in Newick format

function lowestCell(table) {
    // Set default to infinity
    var minCell = Number.MAX_VALUE;
    var row = -1;
    var col = -1;

    // Go through every cell, looking for the lowest
    for (var i=0; i<table.length; i++) {
        for (var j=0; j<table[i].length; j++) {
            if (table[i][j] < minCell) {
                minCell = table[i][j];
                row = i; col = j;
            }
        }
    }

    return [row, col, minCell];
}

// join_labels:
//   Combines two labels in a list of labels
function joinLabels(labels, dist, leafDist, a, b) {
    // Swap if the indices are not ordered
    if (b < a) {
        [a, b] = [b, a];
    }
    // Join the labels in the first index
    labels[a] = "(" + labels[a] + ":" + (dist/2 - leafDist[a]) + "," +
      labels[b] +  ":" + (dist/2 - leafDist[b])+ ")";

    leafDist[a] = dist/2;
    // Remove the (now redundant) label in the second index
    labels.splice(b, 1);
    leafDist.splice(b, 1);
}

// join_table:
//   Joins the entries of a table on the cell (r, c) by averaging their data entries
function joinTable(table, weight, r, c) {
    // Note: since we only process the lower part of the matrix,
    // for all cells coordinates (row,column) the following is true: row>column

    // For the lower (column) index, reconstruct the entire row (A, i), where i < A
    var row = [];
    var rowweight = [];
    console.log("2 Table: ", JSON.stringify(table));
    console.log("2 weight: ", JSON.stringify(weight));
    for (var i = 0; i < c; i++) {
        row.push(((table[c][i]*weight[c][i]) + table[r][i]*weight[r][i]) / (weight[c][i]+weight[r][i]));
        rowweight.push(weight[c][i]+weight[r][i]);
    }
    console.log("Row: ", JSON.stringify(row));

    table[c] = row;
    weight[c] = rowweight;
 //   console.log("3 Table: ", JSON.stringify(table));

    // Then, reconstruct the entire column (i, A), where i > A
    //   Note: Since the matrix is lower triangular, row r only contains values for indices < r
    for (var i = c + 1; i < r; i++) {
        table[i][c] = ((table[i][c]*weight[i][c]) + (table[r][i]*weight[r][i])) / (weight[i][c]+weight[r][i]);
        weight[i][c] = weight[i][c]+weight[r][i];
    }
//    console.log("4 Table: ", JSON.stringify(table));
    //   We get the rest of the values from row i
    for (var i = r + 1; i < table.length; i++) {
        table[i][c] = ((table[i][c]*weight[i][c]) + (table[i][r]*weight[i][r])) / (weight[i][c]+weight[i][r]);
        weight[i][c]=(weight[i][c]+weight[i][r]);
        // Remove the (now redundant) second index column entry
        table[i].splice(r, 1);
        weight[i].splice(r, 1);
    }

    // Remove the (now redundant) second index row
    table.splice(r, 1);
    weight.splice(r, 1);
    console.log("6 Table: ", JSON.stringify(table));
    console.log("6 weight: ", JSON.stringify(weight));

}

// UPGMA:
//   Runs the UPGMA algorithm on a labelled table
function UPGMA(table, labels) {
    // Weight of each cell in distance matrix
    var weight = [];
    for (var i=0; i<table.length; i++) {
        weight[i] = [];
        for (var j=0; j<table[i].length; j++) {
            weight[i][j] = 1;
        }
    }

    // Distance of each cluster to the leafs
    var leafDist = [];
    for (var i = 0; i < labels.length; i++) {
        leafDist.push(0);
    }
    // Until all labels have been joined...
    while (labels.length > 1) {
        // Locate lowest cell in the table
        var [r, c, dist] = lowestCell(table);
        // Update the labels accordingly
        joinLabels(labels, dist, leafDist, r, c);
        // Join the table on the cell co-ordinates
        console.log("1 Table: ", JSON.stringify(table), " r:", r, "c:", c);
        joinTable(table, weight, r, c);
        console.log("Labels: ", JSON.stringify(labels));
    }
    // Return the final label
    return labels[0];
}

function testUPGMA() {
    var table= [[],[5.6],[1.2, 3.4],[6.1,2.5,8]];
    var labels=['A', 'B', 'C', 'D'];
    console.log("UPGMA output: " + UPGMA(table, labels));

    // Example from: http://www.nmsr.org/upgma.htm
    var table= [
        [],                         //A
        [19],                       //B
        [27, 31],                   //C
        [8, 18, 26],                //D
        [33, 36, 41, 31],           //E
        [18, 1, 32, 17, 35],        //F
        [13, 13, 29, 14, 28, 12]    //G
        ];
    var labels=['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    console.log("UPGMA output: " + UPGMA(table, labels));

    // Example from: https://en.wikipedia.org/wiki/UPGMA
    var table= [
        [],                         //A
        [17],                       //B
        [21, 30],                   //C
        [31, 34, 28],               //D
        [23, 21, 39, 43],           //E
        ];
    var labels=['A', 'B', 'C', 'D', 'E'];
    console.log("UPGMA output: " + UPGMA(table, labels));
}

testUPGMA();