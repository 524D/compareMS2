/*                                                                                                                   */
/* compareMS2 - comparison of tandem mass spectra datasets, e.g. from LC-MS/MS                                       */
/*                                                                                                                   */
/* MIT License                                                                                                       */
/*                                                                                                                   */
/* Copyright (c) 2022 Magnus Palmblad                                                                                */
/*                                                                                                                   */
/* Permission is hereby granted, free of charge, to any person obtaining a copy                                      */
/* of this software and associated documentation files (the "Software"), to deal                                     */
/* in the Software without restriction, including without limitation the rights                                      */
/* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell                                         */
/* copies of the Software, and to permit persons to whom the Software is                                             */
/* furnished to do so, subject to the following conditions:                                                          */
/*                                                                                                                   */
/* The above copyright notice and this permission notice shall be included in all                                    */
/* copies or substantial portions of the Software.                                                                   */
/*                                                                                                                   */
/* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR                                        */
/* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,                                          */
/* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE                                       */
/* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER                                            */
/* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,                                     */
/* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE                                     */
/* SOFTWARE.                                                                                                         */
/*                                                                                                                   */
/* Contact information: n.m.palmblad@lumc.nl                                                                         */
/*                                                                                                                   */
/* Compile with gcc -o compareMS2 compareMS2.c or x86_64-w64-mingw32-gcc compareMS2.c -o compareMS2                  */
/*                                                                                                                   */

#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <string.h>
#include <math.h>

#define MAX_LEN 8192
#define DOTPROD_HISTOGRAM_BINS 200
#define MASSDIFF_HISTOGRAM_BINS 320
#define USAGE_STRING "usage: compareMS2 -A <first dataset filename> -B <second dataset filename> [-W <first scan number>,<last scan number> -R <first retention time>,<last retention time> -c <score cutoff> -o <output filename> -m <minimum base peak signal in MS/MS spectrum for comparison>,<minimum total ion signal in MS/MS spectrum for comparison> -w <maximum scan number difference> -r <maximum retention time difference> -p <maximum difference in precursor mass> -e <maximum mass measurement error> -s <scaling power> -n <noise threshold> -d <distance metric (0, 1 or 2)> -q <QC measure (0)>]"

#define	DEFAULT_MIN_BASEPEAK_INTENSITY 0
#define	DEFAULT_MIN_TOTAL_ION_CURRENT 0
#define	DEFAULT_MAX_SCAN_NUMBER_DIFFERENCE 10000
#define	DEFAULT_MAX_RT_DIFFERENCE 60
#define	DEFAULT_MAX_PRECURSOR_DIFFERENCE 2.05
#define	DEFAULT_START_SCAN 1
#define	DEFAULT_END_SCAN 1000000
#define	DEFAULT_START_RT 0
#define	DEFAULT_END_RT 100000
#define	DEFAULT_CUTOFF 0.8
#define	DEFAULT_SCALING 0.5
#define	DEFAULT_NOISE 0
#define DEFAULT_SPECTRUM_METRIC 0
#define	DEFAULT_METRIC 2
#define	DEFAULT_QC 0
#define	DEFAULT_BIN_SIZE 0.2
#define	DEFAULT_MIN_PEAKS 20
#define	DEFAULT_PEAKS_COUNT 0
#define	DEFAULT_MIN_MZ 109
#define	DEFAULT_MAX_MZ 2000
#define	DEFAULT_N_BINS 9455
#define	DEFAULT_TOP_N -1
#define DEFAULT_EXPERIMENTAL_FEATURES 0
#define DEFAULT_SCAN_NUMBERS_COULD_BE_READ 0
#define DEFAULT_RTS_COULD_BE_READ 0

typedef struct {
	long scan; /* scan number */
	double rt; /* retention time in seconds */
	double *mz; /* measured m/z */
	double *intensity; /* measured intensities */
	char charge; /* deconvoluted charge (in MGF file) */
	double *bin; /* binned spectra */
	double precursorMz; /* precursor m/z */
	int nPeaks; /* number of peaks in spectrum */
	double basepeakIntensity; /* basepeak intensity */
	double totalIonCurrent; /* total ion current for spectrum */
} SpecType;

typedef struct {
	char id; /* dataset reference (A of B) */
	char Filename[MAX_LEN];
	char ScanNumbersCouldBeRead;
	char RTsCouldBeRead;
	long Size;
	double *Intensities;
	double Cutoff;
} DatasetType;

typedef struct {
	char outputFilename[MAX_LEN];
	char experimentalOutputFilename[MAX_LEN];
	double minBasepeakIntensity;
	double minTotalIonCurrent;
	double maxScanNumberDifference;
	double maxRTDifference;
	double maxPrecursorDifference;
	long startScan;
	long endScan;
	double startRT;
	double endRT;
	double cutoff;
	double scaling;
	double noise;
	char metric;
	char spectrum_metric;
	char qc;
	double binSize;
	long minPeaks;
	long peakCount;
	double minMz;
	double maxMz;
	long nBins;
	long topN;
	char experimentalFeatures;
} ParametersType;

/* atol0 acts the same as atol, but handles a null pointer without crashing */
static long atol0(const char *p) {
	if (p == 0) {
		return 0;
	}
	return atol(p);
}

/* atof0 acts the same as atof, but handles a null pointer without crashing */
static double atof0(const char *p) {
	if (p == 0) {
		return 0;
	}
	return atof(p);
}

/* an implementation of quickselect for finding the intensity of the k:th most intense spectra (for filtering) */
#define SWAP(x,y) {double temp=x; x=y; y=temp;}

long partition(double a[], long left, long right, long pIndex) {
	double pivot = a[pIndex];
	SWAP(a[pIndex], a[right]);
	pIndex = left;
	for (long i = left; i < right; i++)
		if (a[i] >= pivot) {
			SWAP(a[i], a[pIndex]);
			pIndex++;
		}
	SWAP(a[pIndex], a[right]);
	return pIndex;
}

double quickSelect(double A[], long left, long right, long k) {
	if (left == right)
		return A[left];
	long pIndex = left + rand() % (right - left + 1);
	pIndex = partition(A, left, right, pIndex);
	if (k == pIndex)
		return A[k];
	else if (k < pIndex)
		return quickSelect(A, left, pIndex - 1, k);
	else
		return quickSelect(A, pIndex + 1, right, k);
}

static void initPar(ParametersType *par) {
	strcpy(par->outputFilename, "output.txt");
	par->minBasepeakIntensity = DEFAULT_MIN_BASEPEAK_INTENSITY;
	par->minTotalIonCurrent = DEFAULT_MIN_TOTAL_ION_CURRENT;
	par->maxScanNumberDifference = DEFAULT_MAX_SCAN_NUMBER_DIFFERENCE;
	par->maxRTDifference = DEFAULT_MAX_RT_DIFFERENCE;
	par->maxPrecursorDifference = DEFAULT_MAX_PRECURSOR_DIFFERENCE;
	par->startScan = DEFAULT_START_SCAN;
	par->endScan = DEFAULT_END_SCAN;
	par->startRT = DEFAULT_START_RT;
	par->endRT = DEFAULT_END_RT;
	par->cutoff = DEFAULT_CUTOFF;
	par->scaling = DEFAULT_SCALING;
	par->noise = DEFAULT_NOISE;
	par->metric = DEFAULT_METRIC;
	par->spectrum_metric = DEFAULT_SPECTRUM_METRIC;
	par->qc = DEFAULT_QC;
	par->binSize = DEFAULT_BIN_SIZE;
	par->minPeaks = DEFAULT_MIN_PEAKS;
	par->peakCount = DEFAULT_PEAKS_COUNT;
	par->minMz = DEFAULT_MIN_MZ;
	par->maxMz = DEFAULT_MAX_MZ;
	par->nBins = DEFAULT_N_BINS;
	par->topN = DEFAULT_TOP_N;
	par->experimentalFeatures = DEFAULT_EXPERIMENTAL_FEATURES;
	strcpy(par->experimentalOutputFilename, "experimental_output.txt");
}

static const char *realArg(int argc, char *argv[], int *i) {
	if (strlen(argv[*i]) > 2) return &argv[*i][2];
	(*i)++;
	if (*i >= argc) return NULL;
	return argv[*i];
}

static double parseDouble(int argc, char *argv[], int *i) {
	return atof0(realArg(argc, argv, i));
}

static int parseInt(int argc, char *argv[], int *i) {
	return atoi(realArg(argc, argv, i));
}

/*
 * parseArgs parses command line arguments.
 * Returns 0 if successful, 1 if not. If 1 is returned, err is set to the error code to be returned by the program.
*/
static int parseArgs(int argc, char *argv[], ParametersType *par,
		DatasetType *datasetA, DatasetType *datasetB, int *err) {
	char temp[MAX_LEN], *p;
	int i;

	if ((argc == 2)
			&& ((strcmp(argv[1], "--help") == 0)
					|| (strcmp(argv[1], "-help") == 0)
					|| (strcmp(argv[1], "-h") == 0))) /* want help? */
			{
		printf(
				"compareMS2 - (c) Magnus Palmblad 2010-2021\n\ncompareMS2 is a tool for direct comparison of tandem mass spectrometry datasets, typically from liquid chromatography-tandem mass spectrometry (LC-MS/MS), defining similarity as a function of shared (similar) spectra and distance as the inverse of this similarity. Data with identical spectral content thus have similarity 1 and distance 0. The similarity of datasets with no similar spectra tend to 0 (distance positive infinity) as the size of the sets go to infinity.\n\n");
		printf("%s\n", USAGE_STRING);
		*err=0;
		return 1;
	}

	/* test for correct number of parameters */
	if (argc < 3) {
		printf("%s (type compareMS2 --help for more information)\n",
				USAGE_STRING);
		*err = -1;
		return 1;
	}

	for (i = 1; i < argc; i++) {
		if (argv[i][0] == '-') {
			switch (argv[i][1]) {
				case 'A': strcpy(datasetA->Filename, realArg(argc, argv, &i)); break;
				case 'B': strcpy(datasetB->Filename, realArg(argc, argv, &i)); break;
				case 'W': strcpy(temp, realArg(argc, argv, &i));
						  p = strtok(temp, ",");
						  par->startScan = atol0(p);
						  p = strtok('\0', ",");
						  par->endScan = atol0(p);
						  break;
				case 'R': strcpy(temp, realArg(argc, argv, &i));
							p = strtok(temp, ",");
							par->startRT = atof0(p);
							p = strtok('\0', ",");
							par->endRT = atof0(p);
							break;
				case 'o': strcpy(par->outputFilename, realArg(argc, argv, &i)); break;
				case 'p': par->maxPrecursorDifference = parseDouble(argc, argv, &i); break;
				case 'm': /* minimum basepeak and total intensity */
				 strcpy(temp, realArg(argc, argv, &i));
							p = strtok(temp, ",");
							par->minBasepeakIntensity = atof0(p);
							p = strtok('\0', ",");
							par->minTotalIonCurrent = atof0(p);
							break;

				case 'w': par->maxScanNumberDifference = parseDouble(argc, argv, &i); break;
				case 'r': par->maxRTDifference = parseDouble(argc, argv, &i); break;
				case 'c': par->cutoff = parseDouble(argc, argv, &i); break;
				case 's': par->scaling = parseDouble(argc, argv, &i); break;
				case 'n': par->noise = parseDouble(argc, argv, &i); break;
				case 'd': par->metric = parseInt(argc, argv, &i); break;
				case 'f': par->spectrum_metric = parseInt(argc, argv, &i); break;
				case 'q': par->qc = parseInt(argc, argv, &i); break;
				case 'N': par->topN = parseInt(argc, argv, &i); break;
				case 'b': par->binSize = parseDouble(argc, argv, &i); break;
				case 'I': par->minPeaks = parseInt(argc, argv, &i); break;
				case 'L': par->minMz = parseDouble(argc, argv, &i); break;
				case 'U': par->maxMz = parseDouble(argc, argv, &i); break;
				case 'x': par->experimentalFeatures = parseInt(argc, argv, &i); break;
   				case 'X': strcpy(par->experimentalOutputFilename, realArg(argc, argv, &i)); break;
				default:
					printf("Unknown option: %c\n%s", argv[i][1], USAGE_STRING);
					*err = -1;
					return 1;
			}
			if (i >= argc) {
				printf("Missing argument for option: %c\n%s", argv[i-1][1], USAGE_STRING);
				*err = -1;
				return 1;
			}
		}
		else {
			printf("Unknown option: %s\n%s", argv[i], USAGE_STRING);
			*err = -1;
			return 1;
		}
	}
	return 0;
}

enum { NOT_IN_RANGE, IN_RANGE, IN_RANGE_AND_FIRST_PEAK };

static int preCheckMGF(ParametersType *par, DatasetType *dataset) {
	FILE *fd;
	long nPeaks;
	char line[MAX_LEN];
	char *p;
	double rt;
	long scan;
	int specStatus = IN_RANGE_AND_FIRST_PEAK;

	dataset->ScanNumbersCouldBeRead = DEFAULT_SCAN_NUMBERS_COULD_BE_READ;
	dataset->RTsCouldBeRead = DEFAULT_RTS_COULD_BE_READ;

	/* check MGF dataset A for number of MS/MS spectra */
	if ((fd = fopen(dataset->Filename, "r")) == NULL) {
		printf("error opening dataset %c %s for reading", dataset->id, dataset->Filename);
		return -1;
	}
	printf("checking dataset %c (\"%s\")...", dataset->id, dataset->Filename);
	fflush(stdout);
	dataset->Size = 0;
	nPeaks = 0;
	while (fgets(line, MAX_LEN, fd) != NULL) {
		// For efficiency, we first check if the line contains peak info
		// This is the most common case, and we can skip the rest of the checks
		if (isdigit(line[0])) {
			nPeaks++;
			continue;
		}
		if (strcmp(line, "\n") == 0)
			continue;
		p = strtok(line, "=");
		if (strcmp("TITLE", p) == 0) {
			dataset->Size++;
			if (nPeaks > par->peakCount)
				par->peakCount = nPeaks;
			nPeaks = 0;
		}
	}
	if (nPeaks > par->peakCount) { // In case the last spectrum contained the highest peak count
		par->peakCount = nPeaks;
	}
	printf("done (contains %ld MS2 spectra)\n", dataset->Size);
	fclose(fd);

	if ((par->topN > -1) && (par->topN < dataset->Size)) {
		printf("filtering top-%ld spectra...", par->topN);
		dataset->Intensities = malloc(dataset->Size * sizeof(double));
		if ((fd = fopen(dataset->Filename, "r")) == NULL) {
			printf("error opening dataset %c %s for reading", dataset->id, dataset->Filename);
			return -1;
		}
		int i = -1;
		while (fgets(line, MAX_LEN, fd) != NULL) {
			if (strcmp(line, "\n") == 0)
				continue;
			p = strtok(line, " \t");
			// For efficiency, we first check if the line contains peak info
			// This is the most common case, and we can skip the rest of the checks
			if (isdigit(p[0])) {
				if (specStatus == NOT_IN_RANGE) {
					continue;
				}
				/*
				 * At the first peak of a spectrum that is in selected rt range and scan range,
				 * init new total intensity
				 */
				if (specStatus == IN_RANGE_AND_FIRST_PEAK) {
					specStatus = IN_RANGE;
	   				i++;
					dataset->Intensities[i] = 0.0;
				}
				double mz = atof(p);
				if (mz < par->minMz || mz > par->maxMz) {
					continue;
				}
				p = strtok('\0', " \t");
				double intensity = atof0(p);
				dataset->Intensities[i] += intensity;
			} else if (strcmp("BEGIN", p) == 0) {
				/*
				 * Default: unless spectrum is out of RT range or scan range,
				 * the next peak is in range and is the first peak
				 */
				specStatus = IN_RANGE_AND_FIRST_PEAK;
			}
			// Check if scan number and RT are in range
			else if (strspn("SCANS", p) > 4) { /* MGFs with SCANS attributes */
				p = strtok('\0', " \t");
				scan = (long) atol0(strpbrk(p, "0123456789"));
				if (scan < par->startScan || scan > par->endScan) {
					specStatus = NOT_IN_RANGE;
				}
			}
			else if (strncmp("###MSMS:", p, 8) == 0) { /* Bruker-style MGFs */
				p = strtok('\0', " \t");
				scan = (long) atol0(strpbrk(p, "0123456789"));
				if (scan < par->startScan || scan > par->endScan) {
					specStatus = NOT_IN_RANGE;
				}
			}
			else if (strspn("TITLE", p) > 4) { /* msconvert-style MGFs with NativeID and scan= */
				while (p != NULL) {
					if (strstr(p, "scan=") != NULL) {
						scan = (long) atol0(strpbrk(p, "0123456789"));
						if (scan < par->startScan || scan > par->endScan) {
							specStatus = NOT_IN_RANGE;
						}
					}
					p = strtok('\0', " \t");
				}
			}
			else if (strspn("RTINSECONDS", p) > 10) { /* MGFs with RTINSECONDS attributes */
				rt = atof0(strpbrk(p, "0123456789"));
				if (rt < par->startRT || rt > par->endRT) {
					specStatus = NOT_IN_RANGE;
				}
			}
		}
		if (i<0) {
			dataset->Cutoff = 1e30; /* no spectra in range */
		} else {
			if (i<par->topN) {
				dataset->Cutoff = 0.0; /* all spectra in range */
			}
			else {
				dataset->Cutoff = quickSelect(dataset->Intensities, 0, i, par->topN); /* quickselect top-Nth intensity */
			}
		}
		printf("done (ion intensity threshold %.3f)\n", dataset->Cutoff);
		fclose(fd);
	}
	return 0;
}

static int readMGF(ParametersType *par, DatasetType *dataset, SpecType *spec) {
	FILE *fd;
	char line[MAX_LEN];
	char *p;

	printf("reading %ld MS2 spectra from %s...", dataset->Size,
			dataset->Filename);
	if ((fd = fopen(dataset->Filename, "r")) == NULL) {
		printf("error opening dataset %c %s for reading", dataset->id, dataset->Filename);
		return -1;
	}
	int i = 0;
	int j = 0;
	spec[i].rt = par->startRT; /* default if no scan information is available */
	spec[i].scan = par->startScan; /* default if no scan information is available */
	while (fgets(line, MAX_LEN, fd) != NULL) {
		if (strcmp(line, "\n") == 0)
			continue;
		p = strtok(line, " \t");
		// For efficiency, we first check if the line contains peak info
		// This is the most common case, and we can skip the rest of the checks
		if (isdigit(p[0])) {
			if (j < par->peakCount) {
				double mz = atof(p);
				spec[i].mz[j] = mz;
				p = strtok('\0', " \t");
				double intensity = atof0(p);
				spec[i].intensity[j] = intensity;
				j++;
			}
			continue;
		}
		if (strspn("PEPMASS", p) > 6) {
			spec[i].precursorMz = atof(strpbrk(p, "0123456789"));
			spec[i].mz = (double*) malloc(par->peakCount * sizeof(double));
			spec[i].intensity = (double*) malloc(par->peakCount * sizeof(double));
			spec[i].bin = (double*) malloc(par->nBins * sizeof(double));
			continue;
		}
		if (strspn("CHARGE", p) > 5) {
			spec[i].charge = (char) atoi(strpbrk(p, "0123456789"));
			continue;
		}
		if (strspn("SCANS", p) > 4) { /* MGFs with SCANS attributes */
			p = strtok('\0', " \t");
			long scan = atol0(strpbrk(p, "0123456789"));
			spec[i].scan = scan;
			// printf("%c[%ld].scan = %ld\n", dataset->id, i, spec[i]->scan)
			dataset->ScanNumbersCouldBeRead = 1;
			continue;
		}
		if (strncmp("###MSMS:", p, 8) == 0) { /* Bruker-style MGFs */
			p = strtok('\0', " \t");
			long scan = atol0(strpbrk(p, "0123456789"));
			spec[i].scan = scan;
			// printf("A[%ld].scan = %ld\n", i, spec[i]->scan)
			dataset->ScanNumbersCouldBeRead = 1;
			continue;
		}
		if (strspn("TITLE", p) > 4) { /* msconvert-style MGFs with NativeID and scan= */
			while (p != NULL) {
				if (strstr(p, "scan=") != NULL) {
					long scan = atol0(strpbrk(p, "0123456789"));
					spec[i].scan = scan;
					// printf("%c[%ld].scan = %ld\n", dataset->id, i, spec[i]->scan);
					dataset->ScanNumbersCouldBeRead = 1;
				}
				p = strtok('\0', " \t");
			}
			continue;
		}
		if (strspn("RTINSECONDS", p) > 10) { /* MGFs with RTINSECONDS attributes */
			double rt = atof0(strpbrk(p, "0123456789"));
			spec[i].rt = rt;
			// printf("%c[%ld].rt = %ld\n", dataset->id, i, spec[i]->scan);
			dataset->RTsCouldBeRead = 1;
			continue;
		}
		if (strcmp("END", p) == 0) {
			spec[i].nPeaks = j;
			spec[i].basepeakIntensity = 0;
			spec[i].totalIonCurrent = 0;
			for (int k = 1; k <= j; k++) {
				if (spec[i].basepeakIntensity < spec[i].intensity[k])
					spec[i].basepeakIntensity = spec[i].intensity[k];
				spec[i].totalIonCurrent = spec[i].totalIonCurrent + spec[i].intensity[k];
			}
			i++;
			if (i>=dataset->Size) {
				break; // Exit while loop if we have read all spectra
			}
	   		spec[i].rt = par->startRT; /* default if no scan information is available */
	   		spec[i].scan = par->startScan; /* default if no scan information is available */
			j = 0;
		}
	}

	printf("done\n");
	return 0;
}

static void ScaleNormalizeBin(ParametersType *par, DatasetType *dataset, SpecType *spec) {
	long j, k;
	double squareSum, rootSquareSum;

	printf("scaling, normalizing and binning %ld MS2 spectra from %s..",
			dataset->Size, dataset->Filename);
	for (j = 0; j < dataset->Size; j++) {
		for (k = 0; k < spec[j].nPeaks; k++)
			spec[j].intensity[k] =
					spec[j].intensity[k] > par->noise ?
							pow(spec[j].intensity[k], par->scaling) : 0; /* nth root scaling and noise removal */
		squareSum = 0;
		for (k = 0; k < spec[j].nPeaks; k++)
			squareSum += spec[j].intensity[k] * spec[j].intensity[k];
		rootSquareSum = sqrt(squareSum); /* normalization against spectral vector magnitude */
		for (k = 0; k < par->nBins; k++)
			spec[j].bin[k] = 0; /* set all bins to zero */
		for (k = 0; k < spec[j].nPeaks; k++) {
			spec[j].intensity[k] = spec[j].intensity[k] / rootSquareSum;
			if ((spec[j].mz[k] >= par->minMz) && (spec[j].mz[k] < par->maxMz)) {
				int binIdx = (long) round((spec[j].mz[k] - par->minMz)/par->binSize);
				if ( (binIdx>=0) && (binIdx<par->nBins) ) {
					spec[j].bin[binIdx] += spec[j].intensity[k];
				}
			}
		}
		squareSum = 0;
		for (k = 0; k < par->nBins; k++)
			squareSum += spec[j].bin[k] * spec[j].bin[k];
		rootSquareSum = sqrt(squareSum);
		for (k = 0; k < par->nBins; k++)
			spec[j].bin[k] = spec[j].bin[k] / rootSquareSum; /* normalize binned spectra to binned vector magnitude */
	}
}

static void computeDotProdHistogram(ParametersType *par, DatasetType *datasetA, DatasetType *datasetB,
	 SpecType *A, SpecType *B, long *dotprodHistogram, long **massDiffDotProductHistogram,
	 long *nComparisons, long *greaterThanCutoff, long *sAB, long *actualCompared) {
	long i, j, k;
	double maxDotProd;
	double dotProd;

	for (i = 0; i < datasetA->Size; i++) {
		if (par->topN > -1)
			if (par->topN < datasetA->Size)
				if (datasetA->Intensities[i] <= datasetA->Cutoff)
					continue; /* compare only top-N spectra (including spectra of same intensity as Nth spectrum) */
		if(A[i].scan<par->startScan) continue;
		if(A[i].scan>par->endScan) break;
		if(A[i].nPeaks<par->minPeaks) continue;
		if (A[i].basepeakIntensity < par->minBasepeakIntensity)
			continue;
		if (A[i].totalIonCurrent < par->minTotalIonCurrent)
			continue;

		maxDotProd = 0.0;
		(*actualCompared)++;

		for (j = 0; j < datasetB->Size; j++) {
			if (par->topN > -1)
				if (par->topN < datasetB->Size)
					if (datasetB->Intensities[j] <= datasetB->Cutoff)
						continue;
			if(B[j].scan<par->startScan) continue;
			if(B[j].scan>par->endScan) break;
			if(B[j].nPeaks<par->minPeaks) continue;
			if (B[j].basepeakIntensity < par->minBasepeakIntensity)
				continue;
			if (B[j].totalIonCurrent < par->minTotalIonCurrent)
				continue;
			if ((A[i].scan - B[j].scan) > par->maxScanNumberDifference)
				continue;
			if ((B[j].scan - A[i].scan) > par->maxScanNumberDifference)
				break;
			if ((A[i].rt - B[j].rt) > par->maxRTDifference)
				continue;
			if ((B[j].rt - A[i].rt) > par->maxRTDifference)
				break;
			if (fabs(B[j].precursorMz - A[i].precursorMz)
					< par->maxPrecursorDifference) {
				dotProd = 0;
				for (k = 0; k < par->nBins; k++)
					dotProd += A[i].bin[k] * B[j].bin[k];
				if (fabs(dotProd) <= 1.00) {
					if(par->spectrum_metric == 1) dotProd = 1-2*(acos(dotProd)/3.141593); /* use spectral angle (SA) instead */
					/* Round up pi to ensure the abs result is <= 1.0 */

					dotprodHistogram[(int) (DOTPROD_HISTOGRAM_BINS / 2)
							+ (int) floor(dotProd * (DOTPROD_HISTOGRAM_BINS / 2 - 1E-9))]++;
					if (par->experimentalFeatures == 1) {
						int massDiffBin = (int) (MASSDIFF_HISTOGRAM_BINS / 2) +
							 (int) floor((B[j].precursorMz - A[i].precursorMz) * 999.999999999999);
						if ((massDiffBin>=0) && (massDiffBin<MASSDIFF_HISTOGRAM_BINS)) {
							int dotProdBin = (int) (DOTPROD_HISTOGRAM_BINS / 2) +
							 (int) floor(dotProd * (DOTPROD_HISTOGRAM_BINS / 2 - 1E-9));
							if ((dotProdBin>=0) && (dotProdBin<DOTPROD_HISTOGRAM_BINS)) {
								massDiffDotProductHistogram[massDiffBin][dotProdBin]++;
							}
						}
					}
				}
				(*nComparisons)++;

				if (dotProd > maxDotProd) {
					maxDotProd = dotProd;
				}
			}
		}
		if (maxDotProd > par->cutoff)
			(*greaterThanCutoff)++; /* counting shared spectra from both datasets */
		if (maxDotProd > par->cutoff)
			(*sAB)++;
	}
}

/* compareMS2 main function */

int main(int argc, char *argv[]) {
	FILE *output;
	int err;
	long i, j, nComparisons,
			dotprodHistogram[DOTPROD_HISTOGRAM_BINS],
			massDiffHistogram[DOTPROD_HISTOGRAM_BINS], **massDiffDotProductHistogram=0,
			greaterThanCutoff, sAB, sBA, datasetAActualCompared,
			datasetBActualCompared;

	SpecType *A, *B;

	DatasetType datasetA, datasetB;

	/* Command line and other parameters */
	ParametersType par;

	datasetA.id = 'A';
	datasetB.id = 'B';

	/* Don't buffer standard output */
	setvbuf(stdout, NULL, _IONBF, 0);

	/* assign default values */
	initPar(&par);

	/* read and replace parameter values */
	if (parseArgs(argc, argv, &par, &datasetA, &datasetB, &err) != 0) {
		return err;
	}

	if (((par.maxMz - par.minMz) / par.binSize) == floor((par.maxMz - par.minMz) / par.binSize))
		par.nBins = (int) ((par.maxMz - par.minMz) / par.binSize);
	else
		par.nBins = (int) ((par.maxMz - par.minMz) / par.binSize) + 1;
	printf("spectrum bin size %1.3f Th -> %ld bins in [%.3f,%.3f]\n", par.binSize,
			par.nBins, par.minMz, par.maxMz);

	printf(
			"scan range=[%ld,%ld]\nmax scan difference=%.2f\nmax m/z difference=%.4f\nscaling=^%.2f\nnoise=%.1f\nmin basepeak intensity=%.2f\nmin total ion current=%.2f\n",
			par.startScan, par.endScan, par.maxScanNumberDifference, par.maxPrecursorDifference,
			par.scaling, par.noise, par.minBasepeakIntensity, par.minTotalIonCurrent);

	par.peakCount = 0; // peakCount is the highest number of peaks in any spectrum in a dataset
	int rv = preCheckMGF(&par, &datasetA);
	if (rv != 0) {
		return rv;
	}
	
	rv = preCheckMGF(&par, &datasetB);
	if (rv != 0) {
		return rv;
	}
	/* allocate memory */

	printf("allocating memory...");
	A = (SpecType*) malloc(datasetA.Size * sizeof(SpecType));
	B = (SpecType*) malloc(datasetB.Size * sizeof(SpecType));
	if (par.experimentalFeatures == 1) {
		massDiffDotProductHistogram = (long**) malloc(
		MASSDIFF_HISTOGRAM_BINS * sizeof(long*));
		for (i = 0; i < MASSDIFF_HISTOGRAM_BINS; i++)
			massDiffDotProductHistogram[i] = malloc(
			DOTPROD_HISTOGRAM_BINS * sizeof(long));
	}

	/* read in tandem mass spectra from MGF files */
	printf("done\n");

	rv = readMGF(&par, &datasetA, A);
	if (rv != 0) {
		return rv;
	}
	rv = readMGF(&par, &datasetB, B);
	if (rv != 0) {
		return rv;
	}

	if (datasetA.ScanNumbersCouldBeRead == 0) {
		printf("warning: scan numbers could not be read from dataset A (%s)\n",
				datasetA.Filename);
	}
	if (datasetB.ScanNumbersCouldBeRead == 0) {
		printf("warning: scan numbers could not be read from dataset B (%s)\n",
				datasetB.Filename);
	}
	if ((datasetA.ScanNumbersCouldBeRead == 0)
			|| (datasetB.ScanNumbersCouldBeRead == 0)) {
		par.maxScanNumberDifference = DEFAULT_MAX_SCAN_NUMBER_DIFFERENCE;
		printf("scan filters will be ignored\n");
	}

	if (datasetA.RTsCouldBeRead == 0) {
		printf(
				"warning: retention times could not be read from dataset A (%s)\n",
				datasetA.Filename);
	}
	if (datasetB.RTsCouldBeRead == 0) {
		printf(
				"warning: retention times could not be read from dataset B (%s)\n",
				datasetB.Filename);
	}
	if ((datasetA.RTsCouldBeRead == 0) || (datasetB.RTsCouldBeRead == 0)) {
		par.maxRTDifference = DEFAULT_MAX_RT_DIFFERENCE;
		printf("retention time filters will be ignored\n");
	}

	ScaleNormalizeBin(&par, &datasetA, A);
	ScaleNormalizeBin(&par, &datasetB, B);

	/* go through spectra (entries) in dataset A and compare with those in dataset B and vice versa */
	printf(".done\nmatching spectra and computing set distance.");
	nComparisons = 0;
	greaterThanCutoff = 0;
	sAB = 0;
	sBA = 0;
	datasetAActualCompared = 0;
	datasetBActualCompared = 0;
	for (i = 0; i < DOTPROD_HISTOGRAM_BINS; i++) {
		dotprodHistogram[i] = 0;
		massDiffHistogram[i] = 0;
	}
	if (par.experimentalFeatures == 1) {
		for (i = 0; i < DOTPROD_HISTOGRAM_BINS; i++)
			for (j = 0; j < MASSDIFF_HISTOGRAM_BINS; j++)
				massDiffDotProductHistogram[j][i] = 0;
	}

	computeDotProdHistogram(&par, &datasetA, &datasetB, A, B,
							&dotprodHistogram[0], massDiffDotProductHistogram,
	 						&nComparisons, &greaterThanCutoff, &sAB, &datasetAActualCompared);
	printf(".");

	/* Same as above, with A and B swapped */
	computeDotProdHistogram(&par, &datasetB, &datasetA, B, A,
							&dotprodHistogram[0], massDiffDotProductHistogram,
	 						&nComparisons, &greaterThanCutoff, &sBA, &datasetBActualCompared);

	printf(
			".done (compared %ld (|S_AB|=%ld) spectra from dataset A with %ld (|S_BA|=%ld) spectra from dataset B)\nwriting results to file...",
			datasetAActualCompared, sAB, datasetBActualCompared, sBA);

	/* print output to file */

	if ((output = fopen(par.outputFilename, "w")) == NULL) {
		printf("error opening output file %s for writing", par.outputFilename);
		return -1;
	}
	fprintf(output, "dataset_A\t%s\n", datasetA.Filename);
	fprintf(output, "dataset_B\t%s\n", datasetB.Filename);
	if (par.metric == 0) /* original metric */
	{
		if (greaterThanCutoff > 0)
			fprintf(output, "set_distance\t%1.10f\n",
					(double) nComparisons / 2.0 / greaterThanCutoff);
		if (greaterThanCutoff == 0)
			fprintf(output, "set_distance\tINF\n");
	}
	if (par.metric == 1) /* symmetric metric */
	{
		if (greaterThanCutoff > 0)
			fprintf(output, "set_distance\t%1.10f\n",
					(double) (datasetA.Size + datasetB.Size) / greaterThanCutoff);
		if (greaterThanCutoff == 0)
			fprintf(output, "set_distance\tINF\n");
	}
	if (par.metric == 2) { /* compareMS2 2.0 symmetric metric */
		if ((sAB + sBA) > 0) {
			fprintf(output, "set_distance\t%1.10f\n",
					1.0
							/ ((double) sAB / (2 * datasetA.Size)
									+ (double) sBA / (2 * datasetB.Size)) - 1.0);
		}
		if ((sAB + sBA) == 0) { /* distance between sets with no similar spectra */
			fprintf(output, "set_distance\t%1.10f\n",
					(4.0 * (double) datasetA.Size * datasetB.Size)
							/ (datasetA.Size + datasetB.Size) - 1.0);
		}
	}
	fprintf(output, "set_metric\t%i\n", par.metric);
	fprintf(output,
			"scan_range\t%ld\t%ld\nmax_scan_diff\t%.5f\nmax_m/z_diff\t%.5f\nscaling_power\t%.5f\nnoise_threshold\t%.5f\nmin_basepeak_intensity\t%.2f\nmin_total_ion_current\t%.2f\n",
			par.startScan, par.endScan, par.maxScanNumberDifference, par.maxPrecursorDifference,
			par.scaling, par.noise, par.minBasepeakIntensity, par.minTotalIonCurrent);
	if (par.qc == 0)
		fprintf(output, "dataset_A_QC\t%.4f\n", (float) datasetA.Size);
	if (par.qc == 0)
		fprintf(output, "dataset_B_QC\t%.4f\n", (float) datasetB.Size);
	fprintf(output, "n_gt_cutoff\t%ld\n", greaterThanCutoff);
	fprintf(output, "n_comparisons\t%ld\n", nComparisons);
	fprintf(output, "min_peaks\t%ld\n", par.minPeaks);
	fprintf(output, "max_peaks\t%ld\n", par.peakCount);
	fprintf(output, "m/z_range\t%.4f\t%.4f\n", par.minMz, par.maxMz);
	fprintf(output, "m/z_bin_size\t%.4f\n", par.binSize);
	fprintf(output, "n_m/z_bins\t%ld\n", par.nBins);
	/* fprintf(output,"histogram (interval, midpoint, comparisons)\n"); */
	for (i = 0; i < DOTPROD_HISTOGRAM_BINS; i++)
		fprintf(output, "histogram\t%1.3f\t%1.3f\t%1.3f\t%ld\t%ld\n",
				(double) (i - 100) / 100, (double) (i + 1 - 100) / 100,
				(double) (i + 0.5 - 100) / 100, dotprodHistogram[i],
				massDiffHistogram[i]);
	fclose(output);

	if (par.experimentalFeatures == 1) {
		if ((output = fopen(par.experimentalOutputFilename, "w")) == NULL) {
			printf("error opening experimental output file %s for writing",
					par.experimentalOutputFilename);
			return -1;
		}
		for (i = 0; i < DOTPROD_HISTOGRAM_BINS; i++) {
			for (j = 0; j < MASSDIFF_HISTOGRAM_BINS - 1; j++)
				fprintf(output, "%ld\t", massDiffDotProductHistogram[j][i]);
			fprintf(output, "%ld\n",
					massDiffDotProductHistogram[MASSDIFF_HISTOGRAM_BINS - 1][i]);
		}
		fclose(output);
	}

	/* free memory */
	printf("done\nfreeing memory...");
	free(A);
	free(B);
	printf("done\n");

	/* return from main */

	return 0;
}