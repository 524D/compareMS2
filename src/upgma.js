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

    return [row, col];
}

// join_labels:
//   Combines two labels in a list of labels
function joinLabels(labels, a, b) {
    // Swap if the indices are not ordered
    if (b < a) {
        [a, b] = [b, a];
    }
    // Join the labels in the first index
    labels[a] = "(" + labels[a] + "," + labels[b] + ")";

    // Remove the (now redundant) label in the second index
    labels.splice(b, 1);
}

// join_table:
//   Joins the entries of a table on the cell (a, b) by averaging their data entries
function joinTable(table, a, b) {
    // Swap if the indices are not ordered
    if (b < a) {
        [a, b] = [b, a];
    }
    // For the lower index, reconstruct the entire row (A, i), where i < A
    var row = [];
    console.log("2 Table: ", JSON.stringify(table), " a=", a, " b=", b);
    for (var i = 0; i < a; i++) {
        row.push((table[a][i] + table[b][i]) / 2);
    }
    console.log("Row: ", JSON.stringify(row));

    table[a] = row;
    console.log("3 Table: ", JSON.stringify(table));

    // Then, reconstruct the entire column (i, A), where i > A
    //   Note: Since the matrix is lower triangular, row b only contains values for indices < b
    for (var i = a + 1; i < b; i++) {
        table[i][a] = (table[i][a] + table[b][i]) / 2;
    }
    console.log("4 Table: ", JSON.stringify(table));
    //   We get the rest of the values from row i
    for (var i = b + 1; i < table.length; i++) {
        console.log("4.1 Table: ", JSON.stringify(table), " i=", i, " a=", a);
        table[i][a] = (table[i][a] + table[i][b]) / 2;
        console.log("4.2 Table: ", JSON.stringify(table), " i=", i, " a=", a);
        // Remove the (now redundant) second index column entry
        table[i].splice(b, 1);
    }
    console.log("5 Table: ", JSON.stringify(table));

    // Remove the (now redundant) second index row
    table.splice(b, 1);
    console.log("6 Table: ", JSON.stringify(table));
}

// UPGMA:
//   Runs the UPGMA algorithm on a labelled table
function UPGMA(table, labels) {
    // Until all labels have been joined...
    while (labels.length > 1) {
        // Locate lowest cell in the table
        var [r, c] = lowestCell(table);
        // Join the table on the cell co-ordinates
        console.log("1 Table: ", JSON.stringify(table), " r:", r, "c:", c);
        joinTable(table, r, c);
        // Update the labels accordingly
        joinLabels(labels, r, c);
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