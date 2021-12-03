/*                                                                                                                   */
/* compareMS2_to_distance_matrices - collects output from compareMS2 to distance matrices                            */
/*                                                                                                                   */
/* MIT License                                                                                                       */
/*                                                                                                                   */
/* Copyright (c) 2021 Magnus Palmblad                                                                                */
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
/* Compile with gcc -O2 -Wall -o compareMS2_to_distance_matrices compareMS2_to_distance_matrices.c                   */
/*                                                                                                                   */
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_LINE 2048 // Maximum line of a line in input files
#define MAX_PATH ((MAX_LINE)-20) // Maxumum length of path names
#define MAX_SAMPLE_NAME 256
#define MAX_SHORT_SAMPLE_NAME 256
#define MAX_SAMPLES 120
#define MAX_SPECIES 120
#define MAX_COMP_BETWEEN_SPECIES 120

typedef struct {
	char** sample_names; // Array of sample names
	int nr_sample_names; // Number of sample names present
} samples_t;

typedef struct {
	char* species_name;
	char** sample_names; // Sample names mapped to this species
	int nr_sample_names; // Number of sample names present
	int species_used; // Non-zero if any existing sample refers to the species
} sample_to_species_t;

typedef struct {
	sample_to_species_t* s2s; // Array of species
	int nr_species; // Number of species present
} species_t;

// Allocate memory, on fail exit with message
static void* alloc_chk(size_t s)
{
	void* p = calloc(1, s);
	if (p == 0) {
		fprintf(stderr, "Out of memory\n");
		exit(1);
	}
	return p;
}

// Duplicate string, on fail exit with message
static char* strdup_chk(const char* s)
{
	char* p = strdup(s);
	if (p == 0) {
		fprintf(stderr, "Out of memory\n");
		exit(1);
	}
	return p;
}

static void add_species(const char* species_name, species_t* species)
{
	sample_to_species_t* s2s;
	s2s = &species->s2s[species->nr_species];
	s2s->species_name = strdup_chk(species_name);
	species->nr_species++;
}

// Lookup the name of a species and return it's index.
// If not found, add species and return index of new entry
static int species_name_to_idx(const char* species_name, species_t* species)
{
	int i;

	sample_to_species_t* s2s;
	for (i = 0; i < species->nr_species; i++) {
		s2s = &species->s2s[i];
		if (strcmp(s2s->species_name, species_name) == 0) {
			return i;
		}
	}
	add_species(species_name, species);
	return i;
}

// Add a new sample to species entry
// return the index of the species
static int add_sample_species(const char* sample_name,
    const char* species_name, species_t* species)
{
	int i = species_name_to_idx(species_name, species);

	sample_to_species_t* s2s = &species->s2s[i];
	if (s2s->sample_names == 0) {
		s2s->sample_names = alloc_chk(MAX_SAMPLES * sizeof(char*));
	}
	s2s->sample_names[s2s->nr_sample_names++] = strdup_chk(sample_name);
	return i;
}

// Look up the species index for a given sample name
// If the sample name doesn't belong to any species, use
// the sample name as a new species name and add it the the list of species, and
// return the index of the newly created species.
// Register that the species is used (i.e. that sample comparison data
// exists for this species)
static int sample_name_to_species_index(char* sample_name, species_t* species)
{
	int i, j;

	sample_to_species_t* s2s;
	for (i = 0; i < species->nr_species; i++) {
		s2s = &species->s2s[i];
		for (j = 0; j < s2s->nr_sample_names; j++) {
			if (strcmp(s2s->sample_names[j], sample_name) == 0) {
				s2s->species_used = 1;
				return i;
			}
		}
	}
	s2s = &species->s2s[species->nr_species];
	// Not found, make new "species" from sample name
	s2s->species_name = strdup_chk(sample_name);
	// Remove extension from copies sample name
	// Lookup last dot in filename
	i = strlen(s2s->species_name);
	while ((i > 0) && (s2s->species_name[i] != '.'))
		i--;
	// Replace by end-of-string character 0
	s2s->species_name[i] = 0;

	// This species only contains one sample name, allocate array with one element
	s2s->sample_names = alloc_chk(sizeof(char*));
	s2s->sample_names[0] = strdup_chk(sample_name);
	s2s->nr_sample_names = 1;
	s2s->species_used = 1;
	i = species->nr_species;
	species->nr_species++;
	return i;
}

// Fill the species data with the contents of the samples-to-species file
static void read_sample_to_species(char* fn, species_t* species)
{
	FILE* f;
	char line[MAX_LINE];

	if ((f = fopen(fn, "r")) == NULL) {
		printf("error opening sample-species mapping file %s for reading", fn);
		exit(1);
	}
	while (fgets(line, MAX_LINE, f) != NULL) {
		if (strcmp(line, "\n") == 0)
			continue;
		char* sample_name = strtok(line, "\t");
		char* species_name = strtok('\0', "\t\n");
		add_sample_species(sample_name, species_name, species);
	}
	fclose(f);
}

// Read the file that contains the names of the comparison files
// Return array of pointers to strings with filenames, and
// put the length of that array in parameter n_comparisons_p
static char** read_file_list(char* input_filename, long* n_comparisons_p)
{
	char** comparison;
	FILE* input_file;
	char line[MAX_LINE];
	long n_comparisons;
	long i;

	if ((input_file = fopen(input_filename, "r")) == NULL) {
		printf("error opening filename list %s for reading", input_filename);
		return 0;
	}
	// First count the number of input files
	n_comparisons = 0;
	while (fgets(line, MAX_LINE, input_file) != NULL) {
		if (strcmp(line, "\n") == 0)
			continue;
		n_comparisons++;
	}
	// Allocate memory for comparison filenames
	comparison = (char**)alloc_chk(n_comparisons * sizeof(char*));
	for (i = 0; i < n_comparisons; i++)
		comparison[i] = (char*)alloc_chk(MAX_LINE * sizeof(char));

	// Restart at beginning, read actual content
	fseek(input_file, 0, SEEK_SET);
	i = 0;
	while (fgets(line, MAX_LINE, input_file) != NULL) {
		if (strcmp(line, "\n") == 0)
			continue;
		strcpy(comparison[i], line);
		comparison[i][strlen(comparison[i]) - 1] = '\0';
		i++;
	}
	fclose(input_file);
	*n_comparisons_p = n_comparisons;
	return comparison;
}

// Return the number of species for which we have data
static int get_n_species(species_t* species)
{
	int i;
	int n_species = 0;

	for (i = 0; i < species->nr_species; i++) {
		if (species->s2s->species_used != 0) {
			n_species++;
		}
	}

	return n_species;
}

// Return the index into the distance array for element x,y where x<y
long distance_index(long x, long y)
{
	return ((y - 1) * y) / 2 + x;
}

/* output distance matrix file with in NEXUS format */
static int create_nexus(char* output_filename_stem, double* distance, species_t* species, int metric)
{
	long n_species = get_n_species(species); // FIXME: handle similar to MEGA
	long i, j;
	char output_filename[MAX_PATH];
	FILE* output_file;

	printf("writing distance matrix in NEXUS format...");

	strcpy(output_filename, output_filename_stem);
	strcat(output_filename, "_distance_matrix.nexus");
	if ((output_file = fopen(output_filename, "w")) == NULL) {
		printf("error opening output file %s for writing", output_filename);
		return -1;
	}

	fprintf(output_file, "#NEXUS\n");
	fprintf(output_file, "[                                                                              ]\n");
	fprintf(output_file, "[ NEXUS file generated by compareMS2_to_distance_matrices from compareMS2 data ]\n");
	fprintf(output_file, "[ compareMS2 and compareMS2_to_distance_matrices are (c) Magnus Palmblad 2010- ]\n");
	fprintf(output_file, "[                                                                              ]\n");
	fprintf(output_file, "[ note that compareMS2_to_distance_matrices outputs a full matrix and that the ]\n");
	fprintf(output_file, "[ upper (right) and lower (left) triangular matrices can be slightly different ]\n");
	fprintf(output_file, "[                                                                              ]\n");
	fprintf(output_file, "[ distances are based on metric %i                                              ]\n", metric);
	fprintf(output_file, "[                                                                              ]\n");
	fprintf(output_file, "BEGIN taxa;\n");
	fprintf(output_file, "   DIMENSIONS ntax=%li;", n_species);
	fprintf(output_file, "TAXLABELS\n");
	for (i = 0; i < n_species; i++)
		fprintf(output_file, "   %s\n", species[i].s2s->species_name);
	fprintf(output_file, "\n;\nEND;\n\n");
	fprintf(output_file, "BEGIN distances;\n");
	fprintf(output_file, "   DIMENSIONS ntax=%li;\n", n_species);
	fprintf(output_file, "   FORMAT\n");
	fprintf(output_file, "       triangle=both\n");
	fprintf(output_file, "       labels=left\n");
	fprintf(output_file, "     diagonal\n");
	fprintf(output_file, "     missing=?\n");
	fprintf(output_file, "   ;\n");
	fprintf(output_file, "MATRIX\n");

	for (i = 0; i < species->nr_species; i++) {
		if (species->s2s[i].species_used) {
			int any_out = 0;
			for (j = 0; j < species->nr_species; j++) {
				if (species->s2s[j].species_used) {
					if (any_out == 0) {
						fprintf(output_file, "%s\t", species[i].s2s->species_name);
						any_out = 1;
					}
					if (i == j) {
						fprintf(output_file, "%1.5f\t", 0.0);
					} else if (i < j) {
						fprintf(output_file, "%1.5f\t", distance[distance_index(i, j)]);
					} else {
						// We only store the lower half matrix, swap coordinates
						// to get the distance for the upper half
						fprintf(output_file, "%1.5f\t", distance[distance_index(j, i)]);
					}
				}
			}
			if (any_out) {
				fprintf(output_file, "\n");
			}
		}
	}
	fprintf(output_file, ";\nEND;\n");

	fclose(output_file);
	return 0;
}

static int create_mega(char* output_filename_stem, double* distance, species_t* species,
    double cutoff, double* qc_value, int* qc_samples)
{
	long i, x, y;
	char output_filename[MAX_PATH];
	FILE* output_file;

	printf("writing distance matrix in MEGA format...\n");

	/* output distance matrix file with inverted means (of fraction_gt_cutoff) in MEGA format */
	strcpy(output_filename, output_filename_stem);
	strcat(output_filename, "_distance_matrix.meg");
	if ((output_file = fopen(output_filename, "w")) == NULL) {
		printf("error opening output file %s for writing", output_filename);
		return -1;
	}

	fprintf(output_file, "#mega\n");
	fprintf(output_file, "TITLE: %s (lower-left triangular matrix, cutoff=%.4f)\n\n", output_filename, cutoff);
	// fprintf(output_file,"!Format DataType=Distance DataFormat=LowerLeft;\n\n");

	for (i = 0; i < species->nr_species; i++) {
		if (species->s2s[i].species_used) {
			fprintf(output_file, "QC\t%s\t%.3f\n", species->s2s[i].species_name, qc_value[i] / (double)qc_samples[i]);
		}
	}
	fprintf(output_file, "\n");

	for (i = 0; i < species->nr_species; i++) {
		if (species->s2s[i].species_used) {
			fprintf(output_file, "#%s\n", species->s2s[i].species_name);
		}
	}
	fprintf(output_file, "\n\n");

	for (y = 1; y < species->nr_species; y++) {
		if (species->s2s[y].species_used) {
			int any_out = 0;
			for (x = 0; x < y; x++) {
				if (species->s2s[x].species_used) {
					fprintf(output_file, "%1.5f\t", distance[distance_index(x, y)]);
					any_out = 1;
				}
			}
			if (any_out) {
				fprintf(output_file, "\n");
			}
		}
	}
	fclose(output_file);
	return 0;
}

/* main starts here */
int main(int argc, char* argv[])
{
	FILE* input_file;
	char input_filename[MAX_PATH], output_filename_stem[MAX_PATH], sample_species_mapping_filename[MAX_PATH], format, *p, line[MAX_LINE], **comparison, **X, **Y, **sample_name, **short_sample_name, **species_name, use_mapping = 0, metric = 0;
	long i, x, y, n_comparisons;
	double cutoff;

	int rv = 0; // Return value

	// Write standard output without buffering so messages a printed without delay
	setvbuf(stdout, NULL, _IONBF, 0);

	/* parsing command line parameters */
	if ((argc == 2) && ((strcmp(argv[1], "--help") == 0) || (strcmp(argv[1], "-help") == 0) || (strcmp(argv[1], "-h") == 0))) /* want help? */
	{
		printf("compareMS2_to_distance_matrices - (c) Magnus Palmblad 2010-\n\nusage: compareMS2_to_distance_matrices -i <list of compareMS2 results files> -o <output file stem> [-x <sample to species mapping> -c <score cutoff> -m]\n");
		return 0;
	}

	/* test for correct number of parameters */

	if (argc < 3) {
		printf("usage: compareMS2_to_distance_matrices -i <list of compareMS2 results files> -o <output file stem> [-x <sample to species mapping> -c <score cutoff>] (type compareMS2_to_distance_matrices --help for more information)\n");
		return -1;
	}

	/* read and replace parameter values */
	cutoff = 0.80;
	format = 0; /* 0=NEXUS, 1=MEGA */
	for (i = 1; i < argc; i++) {
		if ((argv[i][0] == '-') && (argv[i][1] == 'i'))
			strcpy(input_filename, &argv[strlen(argv[i]) > 2 ? i : i + 1][strlen(argv[i]) > 2 ? 2 : 0]);
		if ((argv[i][0] == '-') && (argv[i][1] == 'o'))
			strcpy(output_filename_stem, &argv[strlen(argv[i]) > 2 ? i : i + 1][strlen(argv[i]) > 2 ? 2 : 0]);
		if ((argv[i][0] == '-') && (argv[i][1] == 'x')) {
			strcpy(sample_species_mapping_filename, &argv[strlen(argv[i]) > 2 ? i : i + 1][strlen(argv[i]) > 2 ? 2 : 0]);
			use_mapping = 1;
		}
		if ((argv[i][0] == '-') && (argv[i][1] == 'n')) {
			format = 0;
		} /* NEXUS = default */
		if ((argv[i][0] == '-') && (argv[i][1] == 'm')) {
			format = 1; /* MEGA */
		}
		if ((argv[i][0] == '-') && (argv[i][1] == 'c'))
			cutoff = atof(&argv[strlen(argv[i]) > 2 ? i : i + 1][strlen(argv[i]) > 2 ? 2 : 0]);
	}

	printf("reading list of compareMS2 results files...");

	/* read in list of compareMS2 results files */
	comparison = read_file_list(input_filename, &n_comparisons);
	if (comparison == 0) {
		return -1;
	}

	species_t species;
	species.nr_species = 0;
	species.s2s = alloc_chk(sizeof(sample_to_species_t) * (MAX_SAMPLES + MAX_SPECIES));

	if (use_mapping) {
		printf("done\nreading sample to species file...");
		read_sample_to_species(sample_species_mapping_filename, &species);
	}

	printf("done\nAllocatin memory...");

	/* allocate memory */
	X = (char**)alloc_chk(n_comparisons * sizeof(char*));
	for (i = 0; i < n_comparisons; i++)
		X[i] = (char*)alloc_chk(MAX_PATH * sizeof(char));
	Y = (char**)alloc_chk(n_comparisons * sizeof(char*));
	for (i = 0; i < n_comparisons; i++)
		Y[i] = (char*)alloc_chk(MAX_PATH * sizeof(char));

	sample_name = (char**)alloc_chk(MAX_SAMPLES * sizeof(char*));
	for (i = 0; i < MAX_SAMPLES; i++)
		sample_name[i] = (char*)alloc_chk(MAX_SAMPLE_NAME * sizeof(char));
	short_sample_name = (char**)alloc_chk(MAX_SAMPLES * sizeof(char*));
	for (i = 0; i < MAX_SAMPLES; i++)
		short_sample_name[i] = (char*)alloc_chk(MAX_SHORT_SAMPLE_NAME * sizeof(char));
	species_name = (char**)alloc_chk(MAX_SPECIES * sizeof(char*));
	for (i = 0; i < MAX_SPECIES; i++)
		species_name[i] = (char*)alloc_chk(MAX_SHORT_SAMPLE_NAME * sizeof(char));

	// Allocate room for the maximum size of the distance matrix elements
	// We don't know the actual needed size yet, because multiple
	// samples can belong to the same species (from the sample-to-species file),
	// also the sample-to-species files may be missing, over-or under complete.
    // allocate data for each element.
	// We will convert the x,y coordinate to a single array index like:
	// index = ((y-1)*y)/2 + x  where y>x.
	// For a lower left half matrix this index is unique and ranges from 0 to then number
	// matrix elements.

    // FIXME: We allocate too much memory, because the implementation uses a
    // "sparse matrix", where only species that have data are filled, but we

	int max_distances = n_comparisons + (species.nr_species * species.nr_species / 2);
	double* distance = (double*)alloc_chk(max_distances * sizeof(double));
	// distance_samples holds the number of samples that contribute to the distance
	int* distance_samples = (int*)alloc_chk(max_distances * sizeof(int));

	double* qc_value = (double*)alloc_chk((n_comparisons + species.nr_species) * sizeof(double));
	int* qc_samples = (int*)alloc_chk((n_comparisons + species.nr_species) * sizeof(int));

	/* read in compareMS2 results files and process contents */
	for (i = 0; i < n_comparisons; i++) {
		strcpy(input_filename, comparison[i]);
		if ((input_file = fopen(input_filename, "r")) == NULL) {
			printf("error opening MS2compare results file %s for reading", input_filename);
			return -1;
		}
		x = 0;
		y = 0;
		while (fgets(line, 512, input_file) != NULL) {
			if (strcmp(line, "\n") == 0)
				continue;

			p = strtok(line, "\t"); /* read in field name */

			if (strcmp(p, "dataset_A") == 0) {
				p = strtok('\0', "\t\n");
				x = sample_name_to_species_index(p, &species);
				printf("\nread pairwise comparison %li (%s and ", i + 1, p);
			} else if (strcmp(p, "dataset_B") == 0) {
				p = strtok('\0', "\t\n");
				y = sample_name_to_species_index(p, &species);
				// The distance matrix is (supposed to be) symmetric and we
				// will only compute the lower left triangle, e.g. y>x
				// Swap coordinates if comparison is for upper right (x>y)
				if (y < x) {
					int tmp = x;
					x = y;
					y = tmp;
				}
				printf("%s)", p);
			} else if (strcmp(p, "set_distance") == 0) {
				p = strtok('\0', "\t");
				double d = atof(p);
				long di = distance_index(x, y);
				distance[di] += d;
				distance_samples[di]++;
				// p=strtok('\0',"\t");
				// fraction_gt_cutoff[i]=atof(p);
			} else if (strcmp(p, "dataset_A_QC") == 0) {
				p = strtok('\0', "\t");
				double qc = atof(p);
				qc_value[x] += qc;
				qc_samples[x]++;
			} else if (strcmp(p, "dataset_B_QC") == 0) {
				p = strtok('\0', "\t");
				double qc = atof(p);
				qc_value[y] += qc;
				qc_samples[y]++;
			}
		}

		fclose(input_file);
		// if(n_compared_spectra[i]<=0) fraction_gt_cutoff[i]=-1;
		// printf("fraction_gt_cutoff[%li] = %f, n_compared_spectra = %li\n",i,fraction_gt_cutoff[i],n_compared_spectra[i]);
	}
	printf("\ndone (read %li pairwise comparisons)\n", i);

	// Compute average of distance for species with multiple samples
	for (i = 0; i < n_comparisons; i++) {
		if (distance_samples[i] > 0) {
			distance[i] /= (double)distance_samples[i];
		}
	}

	if (format == 0) /* NEXUS format (default) */
	{
		rv = create_nexus(output_filename_stem, distance, &species, metric);
	}

	if (format == 1) /* MEGA format */
	{
		rv = create_mega(output_filename_stem, distance, &species, cutoff, qc_value, qc_samples);
	}
	/* return from main */

	return rv;
}
