# compareMS2
Direct comparison and similarity metric for tandem mass spectrometry datasets

[1. Introduction](#1-Introduction)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[1.1 What is compareMS2?](#11-What-is-compareMS2)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[1.2 How does compareMS2 differ from other tools?](#12-How-does-compareMS2-differ-from-other-tools)  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;[1.3 What can compareMS2 be used for?](#13-What-can-compareMS2-be-used-for)  
[2. Installing compareMS2](#2-Installing-compareMS2)  

## 1. Introduction

### 1.1 What is compareMS2?

compareMS2 is a tool for direct comparison of tandem mass spectrometry datasets, defining similarity as a function of shared (similar) spectra and distance as the inverse of this similarity. Data with identical spectral content thus have similarity 1 and distance 0. Data with no similar spectra have similarity 0 and distance +∞. These extremes are unlikely to occur in practise, however.

### 1.2 How does compareMS2 differ from other tools?
Though compareMS2 is not limited to tandem mass spectra of peptides, it has seen most application to this type of data. There are four broad categories of tools for the analysis of peptide tandem mass spectra in mass spectrometry-based proteomics based on what prior information they utilize. compareMS2 belongs to a class of tools that do not use existing sequence data, but compare tandem mass spectra directly with other tandem mass spectra.

| Syntax    |   | (translated) genome sequences    |      |
| :---        |    :---     |          :---   |    :---   |
|    |   | + | - |
| prior/other tandem mass spectra     | +      | spectral libraries  | compareMS2 |
|   | -       | database search      | de novo sequencing|

### 1.3 What can compareMS2 be used for?

compareMS2 (and similar tools) have extremely broad utility, but have so far seen most utility in data quality control, food/feed species identification and molecular phylogenetics. Molecular phylogenetics is the study of evolution and relatedness of organisms, genes or proteins. The field dates back to 1960 using patterns of tryptic peptides separated by paper chromatography. compareMS2 is a 21st-century analogue, comparing patterns of tryptic peptides as analyzed by tandem mass spectrometry, with the difference that it can use thousands of peptides and that the tandem mass spectra are highly peptide-specific.

However, not only the amino acid sequences of the peptides affect the distance metric in compareMS2, but also the abundance (or coverage) of the proteins. compareMS2 can also be used to quantify the similarity of proteomes from different cell lines or tissues from the same species, before and independently of any protein identification by database or spectral library search.


## 2. Installing compareMS2

Install nodejs:

* On Linux `apt install nodejs`
* On windows download from: <https://nodejs.org/en/download/>

From the command prompt:

```text
npm install -g electron-forge
git clone https://github.com/524D/compareMS2
cd compareMS2
npm install
```

## Run in development mode

```text
electron-forge start
```

## Building

To build a distributable package (for the platform where this command is executed from):

```text
electron-forge make
```

The resulting installer can than be found (relative to the compareMS2 main directory) in:
`out\make\squirrel.windows\x64\compareMS2-x.y.z Setup.exe` for windows.
