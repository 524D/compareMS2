# compareMS2
Direct comparison and similarity metric for tandem mass spectrometry datasets

[1. Introduction](#1-Introduction)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[1.1 What is compareMS2?](#11-What-is-compareMS2)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[1.2 How does compareMS2 differ from other tools?](#12-How-does-compareMS2-differ-from-other-tools)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[1.3 What can compareMS2 be used for?](#13-What-can-compareMS2-be-used-for)  
[2. Installing compareMS2](#2-Installing-compareMS2)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[2.1 Running compareMS2 in development mode](#21-Running-compareMS2-in-development-mode)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[2.2 Building compareMS2](#22-Building-compareMS2)  
[3. Using compareMS2](#3-Using-compareMS2)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[3.1 Configuring compareMS2](#31-Configuring-compareMS2)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[3.2 Calculating distance matrices](#32-Calculating-distance-matrices)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[3.3 Running compareMS2](#33-Running-compareMS2)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[3.4 Molecular phylogenetics](#34-Molecular-phylogenetics)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[3.5 Data quality control](#35-Data-quality-control)  
[4. Further reading](#4-Further-reading)  


## 1. Introduction

### 1.1 What is compareMS2?

compareMS2 is a tool for direct comparison of tandem mass spectrometry datasets, defining similarity as a function of shared (similar) spectra and distance as the inverse of this similarity. Data with identical spectral content thus have similarity 1 and distance 0. Data with no similar spectra have similarity 0 and distance +∞. These extremes are unlikely to occur in practise, however.

### 1.2 How does compareMS2 differ from other tools?
Though compareMS2 is not limited to tandem mass spectra of peptides, it has seen most application to this type of data. There are four broad categories of tools for the analysis of peptide tandem mass spectra in mass spectrometry-based proteomics based on what prior information they utilize. compareMS2 belongs to a class of tools that do not use existing sequence data, but compare tandem mass spectra directly with other tandem mass spectra.

|                                     |      | (translated) genome sequences                    |                                                   |
| :---                                | :--- | :---                                             | :---                                              |
|                                     |      | +                                                | -                                                 |
| **prior/other tandem mass spectra** | +    | spectral libraries (BiblioSpec, SpectraST, ...)  | direct comparison (**compareMS2**, DISMS2, ...)  |
|                                     | -    | database search (Mascot, Comet, ...)             | *de novo* sequencing (PepNovo, Lutefisk, ...)     |


### 1.3 What can compareMS2 be used for?

compareMS2 (and similar tools) have extremely broad utility, but have so far seen most utility in data quality control, food/feed species identification and molecular phylogenetics. Molecular phylogenetics is the study of evolution and relatedness of organisms, genes or proteins. The field dates back to [1960](https://doi.org/10.1073/pnas.46.10.1349) using patterns of tryptic peptides separated by paper chromatography. compareMS2 is a 21st-century analogue, comparing patterns of tryptic peptides as analyzed by tandem mass spectrometry, with the difference that it can use thousands of peptides and that the tandem mass spectra are highly peptide-specific.

However, not only the amino acid sequences of the peptides affect the distance metric in compareMS2, but also the abundance (or coverage) of the proteins. compareMS2 can also be used to quantify the similarity of proteomes from different cell lines or tissues from the same species, before and independently of any protein identification by database or spectral library search.


## 2. Installing compareMS2

Install nodejs:

* On Linux, run `apt install nodejs`
* On Windows, download from: <https://nodejs.org/en/download/>

Then run the following on the command line:

```text
npm install -g electron-forge
git clone https://github.com/524D/compareMS2
cd compareMS2
npm install
```

### 2.1 Running compareMS2 in development mode

To run compareMS2 in "development mode", simply issue:

```text
electron-forge start
```

### 2.2 Building compareMS2

To build a distributable package (for the platform on which this command is executed):

```text
electron-forge make
```

For example, the resulting Windows installer can than be found (relative to the compareMS2 main directory) in
`out\make\squirrel.windows\x64\`.


## 3. Using compareMS2

compareMS2 can be used both from the command-line interface (CLI) and through the compareMS2 GUI. Every compareMS2 analysis consists of two phases: (1) pairwise comparison of all LC-MS/MS datasets and (2) calculating a distance matrix from all pairwise comparisons. The compareMS2 GUI provides real-time feedback by continuously updating the distance matrix, and drawing a UPGMA tree at the completion of each row in the (lower triangular) distance matrix. The distance metric is symmetric, i.e. the distance from dataset A to dataset B is identical to the distance from dataset B to dataset A. If the distance A - B has already been calculated, there is no need to calculate B - A. As every dataset is identical to itself, there is also no point in calculating A - A or B - B, as these distances are always zero.

### 3.1 Configuring compareMS2  

The compareMS2 CLI has a very small number of parameters, which are:

-1 *first dataset filename*  
-2 *second dataset filename*   
-R *first scan number*, *last scan number*  
-c *score cutoff*  
-o *output filename*  
-m *minimum base peak signal in MS/MS spectrum for comparison*, *minimum total ion signal in MS/MS spectrum for comparison*  
-a *alignment piecewise linear function filename*  
-w *maximum scan number difference*  
-p *maximum difference in precursor mass*  
-e *maximum precursor mass measurement error*  

The compareMS2 GUI exposes some of these, and determine others automatically, e.g. the dataset filenames from a specified directory.

### 3.2 Calculating distance matrices

Distance matrices are calculated using a separate executable, compareMS2_to_distance_matrices. This can also average the distances for multiple replicates per species for more accurate molecular phylogenetic analysis. For this, a tab-delimited file with filnames and species names are required. If no such file is provided, one is created automatically, using the filenames as sample "species". The distance matrix can currently be saved in the MEGA or Nexus formats. [MEGA](https://www.megasoftware.net/) is recommended for creating phylogenetic trees from compareMS2 results.

### 3.3 Running compareMS2

After specifying the parameters, click on the "Start" button to run compareMS2 on all files in the specified directory. Alternatively, compareMS2 can be run on two specific files using the CLI version.

### 3.4 Molecular phylogenetics

We recommend [MEGA](https://www.megasoftware.net/) creating phylogenetic trees from compareMS2 results. However, most phylogenetic software can take distance matrices as input for UPGMA analysis. This was the original use for which compareMS2 was developed, see [2013 paper by Palmblad and Deelder](https://doi.org/10.1002/rcm.6162).

### 3.5 Data quality control

compareMS2 provides a very quick overview of large number of datasets to see if they cluster as expected or if there are outliers. Data of lower quality can thus be detected *before* running them through a data analysis pipeline and statistical analysis. It is not absolutely necessary to include all spectra in the analysis - major discrepancies should be detectable with ~1,000 spectra, if selected systematically. Similarly, compareMS2 can be used to determine the relative importance of factors in sample preparation and analysis, as show in a [2016 paper](https://doi.org/10.1002/rcm.7494). 

In addition, compareMS2 collects metadata on each dataset (currently only the number of tandem mass spectra) for overlay on the hierarcical clustering or phylogenetic tree as a color.

## 4. Further reading

compareMS2 and its applications have been published in a number of papers:

