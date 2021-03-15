/*                                                                                                                   */                     
/* compareMS2 - comparison of tandem mass spectra from LC-MS/MS data (NIFES MGF-only version for easy compilation)   */
/*                                                                                                                   */
/* Copyright (c) Magnus Palmblad 2010-2020                                                                           */ 
/*                                                                                                                   */ 
/* This program is free software; you can redistribute it and/or modify it under the terms of the                    */
/* Creative Commons Attribution-Share Alike 3.0 License (http://creativecommons.org/licenses/by-sa/3.0/)             */
/*                                                                                                                   */
/* This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;                         */
/* without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.                         */
/*                                                                                                                   */
/* Contact information: n.m.palmblad@lumc.nl                                                                         */
/*                                                                                                                   */
/* compile with gcc -o compareMS2 compareMS2.c                                                                       */
/* or x86_64-w64-mingw32-gcc.exe compareMS2.c -o compareMS2                                                          */
/*                                                                                                                   */
							 
#include <stdio.h>
#include <stdlib.h>  
#include <ctype.h>
#include <string.h>
#include <math.h>

#define MIN_PEAKS 20 /* minimum number of peaks for spectrum to be compared - filters out some noise spectra */
#define MAX_PEAKS 5000
#define NOISE 10 /* subtract all peaks below this level */
#define MIN_MZ 109 /* binned spectra start here */
#define MAX_MZ 2000 /* binned spectra end here */
#define BIN_SIZE 0.2 /* bin size in Th */
#define N_BINS 9455 /* number of bins */



/* main starts here */

int main(int argc, char *argv[]) 
{
  FILE *dataset_1, *dataset_2, *output;
  char dataset_1_filename[8192], dataset_2_filename[8192], output_filename[8192], temp[8192], line[8192], *p;
  long i, j, k, l, m, size_D1, size_D2, start_scan, end_scan, n_comparisons;
  double min_basepeak_intensity, min_total_intensity, max_scan_number_difference, max_precursor_difference, cutoff;
  double dot_prod, max_dot_prod, sum_dot_prod, ssum, rssum, intensity_below_500, intensity_above_500, sum;
  long histogram[200], gt_cutoff;
    
  typedef struct {
    long scan;                   /* scan number */
    double *mz;                  /* measured m/z */
    double *intensity;           /* measured intensities */
    char charge;                 /* deconvoluted charge (e.g. in MGF file) */
    double bin[N_BINS];          /* binned spectra */
    double precursorMz;          /* precursor m/z */
    int n_peaks;                 /* number of peaks in spectrum */
    double basePeakIntensity;    /* basepeak intensity */
    double totIonCurrent;        /* total ion current for spectrum */
  } dataset_type;

  dataset_type *D1, *D2;

  
  /* parsing command line parameters */
  
  if( (argc==2) && ( (strcmp(argv[1],"--help")==0) || (strcmp(argv[1],"-help")==0) || (strcmp(argv[1],"-h")==0)) ) /* want help? */
    {
      printf("compareMS2 - (c) Magnus Palmblad 2010-\n\ncompareMS2 is developed to compare, globally, all MS/MS spectra between two datasets in MGF acquired under similar conditions, or aligned so that they are comparable. This may be useful for molecular phylogenetics based on shared peptide sequences quantified by the share of highly similar tandem mass spectra. The similarity between a pair of tandem mass spectra is calculated essentially as in SpectraST [see Lam et al. Proteomics 2007, 7, 655-667 (2007)].\n\nusage: compareMS2 -1 <first dataset filename> -2 <second dataset filename> [-R <first scan number>,<last scan number> -c <score cutoff, default=0.8> -o <output filename> -m<minimum base peak signal in MS/MS spectrum for comparison>,<minimum total ion signal in MS/MS spectrum for comparison> -a <alignment piecewise linear function filename> -w <maximum scan number difference> -p <maximum difference in precursor mass> -e <maximum mass measurement error in MS/MS>]\n");
      return 0;
    }
  
  
  /* test for correct number of parameters */
  
  if (argc<3 || argc>17) 
    {
      printf("usage: compareMS2 -1 <first dataset filename> -2 <second dataset filename> -R <first scan number>,<last scan number> [-c <score cutoff> -o <output filename> -m <minimum base peak signal in MS/MS spectrum for comparison>,<minimum total ion signal in MS/MS spectrum for comparison> -a <alignment piecewise linear function filename> -w <maximum scan number difference> -p <maximum difference in precursor mass> -e <maximum mass measurement error>] (type compareMS2 --help for more information)\n");
      return -1;
    }
  
  
  /* assign default values */
  
  strcpy(output_filename,"output.txt"); min_basepeak_intensity=10000; max_scan_number_difference=1500; max_precursor_difference=2.05;
  start_scan=1; end_scan=1000000; cutoff=0.8;
  printf("spectrum bin size %1.3f Th -> %i bins in [%i,%i]\n",BIN_SIZE,N_BINS,MIN_MZ,MAX_MZ); fflush(stdout);
  
  
  /* read and replace parameter values */
  
  for(i=1;i<argc;i++) {
    if( (argv[i][0]=='-') && (argv[i][1]=='1') ) strcpy(dataset_1_filename,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='2') ) strcpy(dataset_2_filename,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='R') ) 
      {
	strcpy(temp,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]); p=strtok(temp,","); 
	start_scan=atol(p); p=strtok('\0',","); end_scan=atol(p);
      }
    if( (argv[i][0]=='-') && (argv[i][1]=='o') ) strcpy(output_filename,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='p') ) max_precursor_difference=atof(&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='m') ) {
	strcpy(temp,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]); p=strtok(temp,","); 
	min_basepeak_intensity=atof(p); p=strtok('\0',","); min_total_intensity=atof(p);
      }
    if( (argv[i][0]=='-') && (argv[i][1]=='w') ) max_scan_number_difference=atof(&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='c') ) cutoff=atof(&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
  }
  printf("scan range=[%i,%i], max scan difference=%.2f, max m/z difference=%.4f\n",start_scan, end_scan, max_scan_number_difference,max_precursor_difference); fflush(stdout);
  
  /* check MGF dataset D1 for number of MS/MS spectra */
  
  printf("entering MGF mode...done\n"); fflush(stdout);
  if((dataset_1=fopen(dataset_1_filename,"r"))==NULL) {printf("error opening dataset 1 MGF file %s for reading",dataset_1_filename); return -1;}
  printf("checking MGF dataset 1 (\"%s\")...",dataset_1_filename); fflush(stdout); 
  size_D1=0;
  while (fgets(line, 8192, dataset_1) != NULL)
    {
      if (strcmp(line,"\n")==0) continue;
      p=strtok(line,"=");
      if(strcmp("TITLE",p)==0) size_D1++;
    }
  printf("done (contains %i MS/MS spectra)\n",size_D1); fflush(stdout); fclose(dataset_1);
    
  if((dataset_2=fopen(dataset_2_filename,"r"))==NULL) {printf("error opening dataset 2 MGF file %s for reading",dataset_2_filename); return -1;}
  printf("checking MGF dataset 2 (\"%s\")...",dataset_2_filename); fflush(stdout); 
  size_D2=0;
  while (fgets(line, 8192, dataset_2) != NULL)
    {
      if (strcmp(line,"\n")==0) continue;
      p=strtok(line,"=");
      if(strcmp("TITLE",p)==0) size_D2++;
    }
  printf("done (contains %i MS/MS spectra)\n",size_D2); fflush(stdout); fclose(dataset_2);
  
  
  /* allocate memory */
  printf("done\nallocating memory..."); fflush(stdout);
  D1=(dataset_type*)malloc(size_D1*sizeof(dataset_type));
  D2=(dataset_type*)malloc(size_D2*sizeof(dataset_type));
  
  
  /* read in tandem mass spectra from MGF files */
  
  printf("done\nreading %i MS/MS spectra from %s...",size_D1,dataset_1_filename); fflush(stdout);
  if((dataset_1=fopen(dataset_1_filename,"r"))==NULL) {printf("error opening dataset 1 MGF file %s for reading",dataset_1_filename); return -1;}
  i=0; j=0;
  while (fgets(line, 8192, dataset_1) != NULL)
    {  
      if (strcmp(line,"\n")==0) continue;
      p=strtok(line," \t");
      if(strspn("PEPMASS",p)>6) {
	D1[i].precursorMz=atof(strpbrk(p,"0123456789"));
	D1[i].mz=(double*)malloc(MAX_PEAKS*sizeof(double)); 
	D1[i].intensity=(double*)malloc(MAX_PEAKS*sizeof(double));
      }
      if(strspn("CHARGE",p)>5) D1[i].charge=(char)atoi(strpbrk(p,"0123456789"));
      if(isdigit(p[0])) {D1[i].mz[j]=atof(p); p=strtok('\0'," \t"); if(j<MAX_PEAKS) {D1[i].intensity[j]=atof(p); j++;}}
      if(strspn("SCANS",p)>4) {D1[i].scan=(long)atol(strpbrk(p,"0123456789")); continue;}
      if(strcmp("END",p)==0) {D1[i].n_peaks=j; i++; j=0;}
    }
  
  printf("done\nreading %i MS/MS spectra from %s...",size_D2,dataset_2_filename); fflush(stdout);
  if((dataset_2=fopen(dataset_2_filename,"r"))==NULL) {printf("error opening dataset 2 MGF file %s for reading",dataset_2_filename); return -1;}
  i=0; j=0;
  while (fgets(line, 8192, dataset_2) != NULL)
    {
      if (strcmp(line,"\n")==0) continue;
      p=strtok(line," \t");
      if(strspn("PEPMASS",p)>6) {
	D2[i].precursorMz=atof(strpbrk(p,"0123456789")); 
	D2[i].mz=(double*)malloc(MAX_PEAKS*sizeof(double)); 
	D2[i].intensity=(double*)malloc(MAX_PEAKS*sizeof(double));
      }
      if(strspn("CHARGE",p)>5) D2[i].charge=(char)atoi(strpbrk(p,"0123456789"));
      if(isdigit(p[0])) {D2[i].mz[j]=atof(p); p=strtok('\0'," \t"); if(j<MAX_PEAKS) {D2[i].intensity[j]=atof(p); j++;}}
      if(strspn("SCANS",p)>4) {D2[i].scan=(long)atol(strpbrk(p,"0123456789")); continue;} // for Ben's MGFs from Lumos
      if(strcmp("END",p)==0) {D2[i].n_peaks=j; i++; j=0;}
    }
  printf("done\n"); fflush(stdout);

  printf("scaling, normalizing and binning %i MS/MS spectra from %s...",size_D1,dataset_1_filename); fflush(stdout);
  for(j=0;j<size_D1;j++)
    {
      for(k=0;k<D1[j].n_peaks;k++) D1[j].intensity[k]=D1[j].intensity[k]>NOISE?sqrt(D1[j].intensity[k]):0; /* square root scaling and NOISE removal */
      ssum=0; for(k=0;k<D1[j].n_peaks;k++) ssum+=D1[j].intensity[k]*D1[j].intensity[k]; rssum=sqrt(ssum); /* normalization against spectral vector magnitude */
      for(k=0;k<N_BINS;k++) D1[j].bin[k]=0; /* set all bins to zero */
      for(k=0;k<D1[j].n_peaks;k++) {D1[j].intensity[k]=D1[j].intensity[k]/rssum; if((D1[j].mz[k]>=MIN_MZ)&&(D1[j].mz[k]<MAX_MZ)) D1[j].bin[(long)floor(BIN_SIZE*(D1[j].mz[k]-MIN_MZ)+BIN_SIZE/2)]+=D1[j].intensity[k];}
      ssum=0; for(k=0;k<N_BINS;k++) ssum+=D1[j].bin[k]*D1[j].bin[k]; rssum=sqrt(ssum);
      for(k=0;k<N_BINS;k++) D1[j].bin[k]=D1[j].bin[k]/rssum; /* normalize binned spectra to binned vector magnitude */
    }

  printf("done\nscaling, normalizing and binning %i MS/MS spectra from %s...",size_D2,dataset_2_filename); fflush(stdout);
  for(j=0;j<size_D2;j++)
    {
      for(k=0;k<D2[j].n_peaks;k++) D2[j].intensity[k]=D2[j].intensity[k]>NOISE?sqrt(D2[j].intensity[k]):0; /* square root scaling and NOISE removal */
      ssum=0; for(k=0;k<D2[j].n_peaks;k++) ssum+=D2[j].intensity[k]*D2[j].intensity[k]; rssum=sqrt(ssum); /* normalization against spectral vector magnitude */
      for(k=0;k<N_BINS;k++) D2[j].bin[k]=0; /* set all bins to zero */
      for(k=0;k<D2[j].n_peaks;k++) {if((D2[j].mz[k]>=MIN_MZ)&&(D2[j].mz[k]<MAX_MZ)) D2[j].bin[(long)floor(BIN_SIZE*(D2[j].mz[k]-MIN_MZ)+BIN_SIZE/2)]+=D2[j].intensity[k];} /* populate bins */
      ssum=0; for(k=0;k<N_BINS;k++) ssum+=D2[j].bin[k]*D2[j].bin[k]; rssum=sqrt(ssum);
      for(k=0;k<N_BINS;k++) D2[j].bin[k]=D2[j].bin[k]/rssum; /* normalize binned spectra to binned vector magnitude */
    }

  
  /* go through spectra (entries) in MGF file 1 and compare with those in MGF file 2 and vice versa */
  printf("done\nmatching spectra..."); fflush(stdout);
  sum_dot_prod=0.0; n_comparisons=0; gt_cutoff=0;
  for(i=0;i<200;i++) histogram[i]=0;
  
  for(i=0;i<size_D1;i++)
    {
      // if(D1[i].scan<start_scan) continue;
      // if(D1[i].scan>end_scan) continue;
      max_dot_prod=0.0;
      
      for(j=0;j<size_D2;j++) {
	if((D1[i].scan-D2[j].scan)>max_scan_number_difference) continue;
	if((D2[j].scan-D1[i].scan)>max_scan_number_difference) break;
	if(fabs(D2[j].precursorMz-D1[i].precursorMz)<max_precursor_difference) {
	  dot_prod=0;
	  for(k=0;k<N_BINS;k++) dot_prod+=D1[i].bin[k]*D2[j].bin[k];
	  if(fabs(dot_prod)<=1.00) histogram[100+(int)floor(dot_prod*99.999999999999)]++;
	  n_comparisons++;
	  if(dot_prod>max_dot_prod) {max_dot_prod=dot_prod;}
	}
      }
      if(max_dot_prod>cutoff) gt_cutoff++;
    }
  for(i=0;i<size_D2;i++)
    {
      // if(D2[i].scan<start_scan) continue;
      // if(D2[i].scan>end_scan) continue;
      max_dot_prod=0.0;
      
      for(j=0;j<size_D1;j++) {
	if((D2[i].scan-D1[j].scan)>max_scan_number_difference) continue;
	if((D1[j].scan-D2[i].scan)>max_scan_number_difference) break;
	if(fabs(D1[j].precursorMz-D2[i].precursorMz)<max_precursor_difference) {
	  dot_prod=0;
	  for(k=0;k<N_BINS;k++) dot_prod+=D2[i].bin[k]*D1[j].bin[k];
	   if(fabs(dot_prod)<=1.00) histogram[100+(int)floor(dot_prod*99.999999999999)]++;
	  n_comparisons++;
	  if(dot_prod>max_dot_prod) {max_dot_prod=dot_prod;}
	}
      }
      if(max_dot_prod>cutoff) gt_cutoff++; /* counting shared spectra from both datasets */
    }
 
  printf("done\n");
  
  
  /* print output to file */
  
  if((output=fopen(output_filename,"w"))==NULL) {printf("error opening output file %s for writing",output_filename); return -1;}
  fprintf(output,"dataset_1\t%s\n",dataset_1_filename);
  fprintf(output,"dataset_2\t%s\n",dataset_2_filename);
  fprintf(output,"dataset_QC_1\t%.4f\n",(float)size_D1);
  fprintf(output,"dataset_QC_2\t%.4f\n",(float)size_D2);
  fprintf(output,"gt_cutoff\t%i\n",gt_cutoff);
  fprintf(output,"fraction_gt_cutoff\t%1.10f\n",(double)gt_cutoff/(size_D1+size_D2)); // make symmetric
  fprintf(output,"n_compared_spectra\t%i\n",n_comparisons);
  fprintf(output,"histogram (interval, midpoint, comparisons)\n");
  for(i=0;i<200;i++) fprintf(output,"histogram\t%1.3f\t%1.3f\t%1.3f\t%i\n",(double)(i-100)/100,(double)(i+1-100)/100,(double)(i+0.5-100)/100,histogram[i]);
  fflush(output);
  
  
  /* close files and free memory */
  
  fclose(output);
  printf("freeing memory..."); fflush(stdout);
  free(D1); free(D2);
  printf("done\n"); fflush(stdout);
  

  /* return from main */
  
  return 0; 
}

