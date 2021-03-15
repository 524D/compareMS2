/*                                                                                                        */                     
/* compareMS2_to_distance_matrices - collects output from compareMS2 to distance matrices                 */
/*                                                                                                        */
/* Copyright (c) Magnus Palmblad 2010-                                                                    */ 
/*                                                                                                        */ 
/* This program is free software; you can redistribute it and/or modify it under the terms of the         */
/* Creative Commons Attribution-Share Alike 3.0 License (http://creativecommons.org/licenses/by-sa/3.0/)  */
/*                                                                                                        */
/* This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;              */
/* without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.              */
/*                                                                                                        */
/* Contact information: n.m.palmblad@lumc.nl                                                              */
/*                                                                                                        */
/* compile with gcc -o compareMS2_to_distance_matrices compareMS2_to_distance_matrices.c                  */
/* or x86_64-w64-mingw32-gcc.exe compareMS2_to_distance_matrices.c -o compareMS2_to_distance_matrices     */
/*                                                                                                        */

#include <stdio.h>
#include <stdlib.h>  
#include <ctype.h>
#include <string.h>

#define MAX_COMP 14400
#define MAX_SAMPLES 120
#define MAX_SPECIES 120
#define MAX_COMP_BETWEEN_SPECIES 120

/* main starts here */
int main(int argc, char *argv[]) 
{
  FILE *input_file, *output_file;
  char input_filename[256], output_filename_stem[256], output_filename[256], sample_species_mapping_filename[256], format, *p, *q, line[512], **comparison, **X, **Y, **sample_name, **short_sample_name,**species_name, use_mapping=0; 
 
  long i, j, k, x, y, n_comparisons, n_samples, n_species, *gt80, **A_gt80, *gt80_unique, **A_gt80_unique, *n_compared_spectra, *n_compared_precursors, *sample_unique_precursors, **counter;
  double cutoff, *sum_dot_prod, **A_sum_dot_prod, ***S, **mean, **sum;

  long *gt_cutoff, **A_gt_cutoff;
  double *fraction_gt_cutoff, **A_fraction_gt_cutoff, *size_D, *QC;
     

  /* parsing command line parameters */
  
  if( (argc==2) && ( (strcmp(argv[1],"--help")==0) || (strcmp(argv[1],"-help")==0) || (strcmp(argv[1],"-h")==0)) ) /* want help? */
    {
      printf("compareMS2_to_distance_matrices - (c) Magnus Palmblad 2010-\n\nusage: compareMS2_to_distance_matrices -i <list of compareMS2 results files> -o <output file stem> [-x <sample to species mapping> -c <score cutoff> -m]\n");
      return 0;
    }
  

  /* test for correct number of parameters */

  if (argc<3 || argc>11) 
    {
      printf("usage: compareMS2_to_distance_matrices -i <list of compareMS2 results files> -o <output file stem> [-x <sample to species mapping> -c <score cutoff>] (type compareMS2_to_distance_matrices --help for more information)\n");
      return -1;
    }
  
    
  /* read and replace parameter values */
  cutoff=0.80; format=0; /* 0=NEXUS, 1=MEGA, 2=additional formats... */
  for(i=1;i<argc;i++) {
    if( (argv[i][0]=='-') && (argv[i][1]=='i') ) strcpy(input_filename,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='o') ) strcpy(output_filename_stem,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
    if( (argv[i][0]=='-') && (argv[i][1]=='x') ) {strcpy(sample_species_mapping_filename,&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]); use_mapping=1;}
    if( (argv[i][0]=='-') && (argv[i][1]=='n') ) {format=0;} /* NEXUS = default */
    if( (argv[i][0]=='-') && (argv[i][1]=='m') ) {format=1;} /* MEGA */
    // if( (argv[i][0]=='-') && (argv[i][1]=='y') ) {format=2;} /* Add additonal formats here */
    if( (argv[i][0]=='-') && (argv[i][1]=='c') ) cutoff=atof(&argv[strlen(argv[i])>2?i:i+1][strlen(argv[i])>2?2:0]);
  }

  
  /* allocate memory */

  printf("allocating memory..."); fflush(stdout);
 
  comparison=(char**)malloc(MAX_COMP*sizeof(char*)); for(i=0;i<MAX_COMP;i++) comparison[i]=(char*)malloc(256*sizeof(char));
  X=(char**)malloc(MAX_COMP*sizeof(char*)); for(i=0;i<MAX_COMP;i++) X[i]=(char*)malloc(256*sizeof(char));
  Y=(char**)malloc(MAX_COMP*sizeof(char*)); for(i=0;i<MAX_COMP;i++) Y[i]=(char*)malloc(256*sizeof(char));

  sample_name=(char**)malloc(MAX_SAMPLES*sizeof(char*)); for(i=0;i<MAX_SAMPLES;i++) sample_name[i]=(char*)malloc(256*sizeof(char));
  short_sample_name=(char**)malloc(MAX_SAMPLES*sizeof(char*)); for(i=0;i<MAX_SAMPLES;i++) short_sample_name[i]=(char*)malloc(128*sizeof(char));
  species_name=(char**)malloc(MAX_SPECIES*sizeof(char*)); for(i=0;i<MAX_SPECIES;i++) species_name[i]=(char*)malloc(128*sizeof(char));
  counter=(long**)malloc(MAX_SPECIES*sizeof(long*)); for(i=0;i<MAX_SPECIES;i++) counter[i]=(long*)malloc(MAX_SPECIES*sizeof(long));

  gt_cutoff=(long*)malloc(MAX_COMP*sizeof(long));
  A_gt_cutoff=(long**)malloc(MAX_SAMPLES*sizeof(long*)); for(i=0;i<MAX_SAMPLES;i++) A_gt_cutoff[i]=(long*)malloc(MAX_SAMPLES*sizeof(long));
  
  n_compared_spectra=(long*)malloc(MAX_COMP*sizeof(long));
  
  sum_dot_prod=(double*)malloc(MAX_COMP*sizeof(double));
  A_sum_dot_prod=(double**)malloc(MAX_SAMPLES*sizeof(double*)); for(i=0;i<MAX_SAMPLES;i++) A_sum_dot_prod[i]=(double*)malloc(MAX_SAMPLES*sizeof(double));

  fraction_gt_cutoff=(double*)malloc(MAX_COMP*sizeof(double));
  A_fraction_gt_cutoff=(double**)malloc(MAX_SAMPLES*sizeof(double*)); for(i=0;i<MAX_SAMPLES;i++) A_fraction_gt_cutoff[i]=(double*)malloc(MAX_SAMPLES*sizeof(double));

  size_D=(double*)malloc(MAX_COMP*sizeof(double));
  QC=(double*)malloc(MAX_SPECIES*sizeof(double));

  S=(double***)malloc(MAX_SAMPLES*sizeof(double**)); for(i=0;i<MAX_SAMPLES;i++) {S[i]=(double**)malloc(MAX_SAMPLES*sizeof(double*)); for(j=0;j<MAX_SAMPLES;j++) S[i][j]=(double*)malloc(MAX_COMP_BETWEEN_SPECIES*sizeof(double));}

  mean=(double**)malloc(MAX_SPECIES*sizeof(double*)); for(i=0;i<MAX_SPECIES;i++) mean[i]=(double*)malloc(MAX_SPECIES*sizeof(double));
  sum=(double**)malloc(MAX_SPECIES*sizeof(double*)); for(i=0;i<MAX_SPECIES;i++) sum[i]=(double*)malloc(MAX_SPECIES*sizeof(double));

  printf("done\nreading list of compareMS2 results files..."); fflush(stdout);

  /* read in list of compareMS2 results files */
  
  if((input_file=fopen(input_filename,"r"))==NULL) {printf("error opening filename list %s for reading",input_filename); return -1;}
  i=0;
  while (fgets(line, 512, input_file) != NULL)
    {
      if (strcmp(line,"\n")==0) continue;
      strcpy(comparison[i],line);
      comparison[i][strlen(comparison[i])-1]='\0';
      i++;
    }
  n_comparisons=i;
  fclose(input_file); printf("done\nreading sample-to-species mapping file..."); fflush(stdout); 

  
  /* read in sample -> species mapping file */
  
  if(use_mapping)
    {
      if((input_file=fopen(sample_species_mapping_filename,"r"))==NULL) {printf("error opening sample-species mapping file %s for reading",input_filename); return -1;}
      i=0;
      while (fgets(line, 512, input_file) != NULL)
	{
	  if (strcmp(line,"\n")==0) continue;
	  p=strtok(line,"\t");
	  strcpy(sample_name[i],p); printf("\n   sample \"%s\" ",sample_name[i]); fflush(stdout);
	  p=strtok('\0',"\t\n"); 
	  strcpy(short_sample_name[i],p); /* short sample name = species or taxonomical level for averaging etc. */
	  printf("-> species \"%s\"",short_sample_name[i]); fflush(stdout);
	  i++;
	}
      n_samples=i;
      fclose(input_file);  
      printf("\ndone (found species information for %i samples)\nreading pairwise comparisons...\n",n_samples); fflush(stdout);
    }
  

  /* read in compareMS2 results files one by one and store the values */

  for(i=0;i<n_comparisons;i++)
    {
      strcpy(input_filename,comparison[i]);
      if((input_file=fopen(input_filename,"r"))==NULL) {printf("error opening MS2compare results file %s for reading",input_filename); return -1;}
      gt_cutoff[i]=0; n_compared_spectra[i]=0;
      while (fgets(line, 512, input_file) != NULL)
	{
	  if (strcmp(line,"\n")==0) continue;
	  
	  p=strtok(line,"\t"); /* read in field name */
	  
	  if(strcmp(p,"dataset_1")==0) {p=strtok('\0',"\t\n"); strcpy(X[i],p); printf("\nread pairwise comparison %i (%s and ",i+1,X[i]); fflush(stdout);}
	  if(strcmp(p,"dataset_2")==0) {p=strtok('\0',"\t\n"); strcpy(Y[i],p); printf("%s)",Y[i]); fflush(stdout);}
	  if(strcmp(p,"dataset_QC_1")==0) {p=strtok('\0',"\t"); size_D[i]=atof(p);}
	  if(strcmp(p,"gt_cutoff")==0) {p=strtok('\0',"\t"); gt_cutoff[i]=atoi(p);}
	  if(strcmp(p,"fraction_gt_cutoff")==0) {p=strtok('\0',"\t"); fraction_gt_cutoff[i]=atof(p);}
	  if(strcmp(p,"n_compared_spectra")==0) {p=strtok('\0',"\t"); n_compared_spectra[i]=atoi(p);}
          // if(strcmp(p,"histogram")==0) {p=strtok('\0',"\t"); if(atof(p)>=cutoff) {p=strtok('\0',"\t"); p=strtok('\0',"\t"); p=strtok('\0',"\t"); gt_cutoff[i]+=atoi(p);}}
	}
      
      fclose(input_file);
      // if(n_compared_spectra[i]<=0) fraction_gt_cutoff[i]=-1;
      // printf("fraction_gt_cutoff[%i] = %f, n_compared_spectra = %i\n",i,fraction_gt_cutoff[i],n_compared_spectra[i]);
    }
  printf("\ndone (read %i pairwise comparisons)\n",i); fflush(stdout);
  
  
  /* go through pairwise comparisons and put data into similarity/distance matrices */

  printf("parsing sample info..."); fflush(stdout);
  if(!use_mapping) /* create labels based on file names */
    {
      
      k=0;
      for(i=0;i<n_comparisons;i++)
  {
  	  for(j=0;j<k;j++)
  	    {
  	      if(strcmp(Y[i],sample_name[j])==0) break;
  	    }
  	  if(j==k) {strcpy(sample_name[k],Y[i]); printf("%s\n",Y[i]); k++;}
  	}
    n_samples=k;
  }
  
  if(n_samples==0) {printf("done (no sample found)\nnot enough unique samples (exiting)\n"); fflush(stdout); return -1;}
  if(n_samples==1) {printf("done (found 1 sample)\nnot enough unique samples (exiting)\n"); fflush(stdout); return -1;}

  printf("done (found %i unique samples)\ngenerating matrices...\n",n_samples); fflush(stdout);
  
  for(i=0;i<n_comparisons;i++) 
    {
      // printf("%i\n",i); fflush(stdout);
      for(j=0;j<n_samples;j++) if(strcmp(X[i],sample_name[j])==0) {x=j; QC[j]=size_D[i]; break;} /* find x sample name and QC metric */
      for(j=0;j<n_samples;j++) if(strcmp(Y[i],sample_name[j])==0) {y=j; break;} /* find y sample name */
      // printf("%s %s\n",X[x],Y[y]); fflush(stdout); 
      
      A_gt_cutoff[x][y]=gt_cutoff[i];
      A_fraction_gt_cutoff[x][y]=fraction_gt_cutoff[i];

      A_gt_cutoff[y][x]=gt_cutoff[i]; /* mirror data to get symmetric and complete matrix */
      A_fraction_gt_cutoff[y][x]=fraction_gt_cutoff[i];

      // printf("%i, %i\n",x,y); fflush(stdout);
    }
  
  //printf("read information for samples:\n");
  for(i=0;i<n_samples;i++) printf("   %s (%i spectra comparisons)\n",sample_name[i],n_compared_spectra[i]); fflush(stdout);
  
  strcpy(output_filename,output_filename_stem); strcat(output_filename,"_gt_cutoff.txt");
  if((output_file=fopen(output_filename,"w"))==NULL) {printf("error opening output file %s for writing",output_filename); return -1;}
  for(x=0;x<n_samples;x++)
    {
      fprintf(output_file,"%s",short_sample_name[x]);
      for(y=0;y<n_samples;y++) fprintf(output_file,",%i",A_gt_cutoff[x][y]);
      fprintf(output_file,"\n"); fflush(output_file);
    }
  fclose(output_file);

  strcpy(output_filename,output_filename_stem); strcat(output_filename,"_fraction_gt_cutoff.txt");
  if((output_file=fopen(output_filename,"w"))==NULL) {printf("error opening output file %s for writing",output_filename); return -1;}
  for(x=0;x<n_samples;x++)
    {
      fprintf(output_file,"%s",short_sample_name[x]);
      for(y=0;y<n_samples;y++) fprintf(output_file,",%f",A_fraction_gt_cutoff[x][y]);
      fprintf(output_file,"\n"); fflush(output_file);
    }
  fclose(output_file);

  k=0;
  for(i=0;i<n_samples;i++)
    {
      for(j=0;j<k;j++)
  	{
  	  if(strcmp(short_sample_name[i],species_name[j])==0) break;
  	}
     if(j==k) {strcpy(species_name[k],short_sample_name[i]); k++;}
    }
  n_species=k; // printf(" %i species:\n",k); fflush(stdout);
  for(i=0;i<n_species;i++) printf("   species %i -> %s\n",i+1,species_name[i]);
  
  if(format==0) /* NEXUS format (default) */
    {
      printf("writing distance matrix in NEXUS format..."); fflush(stdout);
      
      /* output distance matrix file with inverted means (of fraction_gt_cutoff) in NEXUS format */
      
      for(x=0;x<n_species;x++) for(y=0;y<n_species;y++) {counter[x][y]=0; sum[x][y]=0;}
      for(i=0;i<n_samples;i++) /* i = sample 1 (vertical) */
	{
	  x=0; y=0;
	  for(k=0;k<n_species;k++) if(strcmp(short_sample_name[i],species_name[k])==0) {x=k; break;}
	  for(j=0;j<n_samples;j++) /* j = sample 2 (horizontal) */
	    {
	      for(k=0;k<n_species;k++) if(strcmp(short_sample_name[j],species_name[k])==0) {y=k; break;}
	      if(j!=i) {S[x][y][counter[x][y]]=A_fraction_gt_cutoff[i][j]; counter[x][y]++;}
	    }
	}

      for(x=0;x<n_species;x++) for(y=0;y<n_species;y++) for(k=0;k<counter[x][y];k++) sum[x][y]+=S[x][y][k];
      for(x=0;x<n_species;x++) for(y=0;y<n_species;y++) mean[x][y]=sum[x][y]/counter[x][y]; /* calculate means for NEXUS file */

      strcpy(output_filename,output_filename_stem); strcat(output_filename,"_distance_matrix.nexus");
      if((output_file=fopen(output_filename,"w"))==NULL) {printf("error opening output file %s for writing",output_filename); return -1;}
      
      fprintf(output_file,"#NEXUS\n");
      fprintf(output_file,"[                                                                              ]\n");  
      fprintf(output_file,"[ NEXUS file generated by compareMS2_to_distance_matrices from compareMS2 data ]\n");
      fprintf(output_file,"[ compareMS2 and compareMS2_to_distance_matrices are (c) Magnus Palmblad 2010- ]\n");
      fprintf(output_file,"[                                                                              ]\n");
      fprintf(output_file,"[ note that compareMS2_to_distance_matrices outputs a full matrix and that the ]\n");
      fprintf(output_file,"[ upper (right) and lower (left) triangular matrices can be slightly different ]\n");
      fprintf(output_file,"[                                                                              ]\n");
      fprintf(output_file,"[ distances are 1/(fraction of spectra pairs with dot product > %.4f)        ]\n",cutoff);
      fprintf(output_file,"[                                                                              ]\n");
      fprintf(output_file,"BEGIN taxa;\n");
      fprintf(output_file,"   DIMENSIONS ntax=%i;",n_species);
      fprintf(output_file,"TAXLABELS\n");
      for(i=0;i<n_species;i++) fprintf(output_file,"   %s\n",species_name[i]);
      fprintf(output_file,"\n;\nEND;\n\n");
      fprintf(output_file,"BEGIN distances;\n");
      fprintf(output_file,"   DIMENSIONS ntax=%i;\n",n_species);
      fprintf(output_file,"   FORMAT\n");
      fprintf(output_file,"       triangle=both\n");
      fprintf(output_file,"       labels=left\n");
      fprintf(output_file,"     diagonal\n");
      fprintf(output_file,"     missing=?\n");
      fprintf(output_file,"   ;\n");
      fprintf(output_file,"MATRIX\n");
      for(i=0;i<n_species;i++) {fprintf(output_file,"%s\t",species_name[i]); for(j=0;j<n_species;j++) if(i==j) fprintf(output_file,"%1.5f\t",0); else fprintf(output_file,"%1.5f\t",1/mean[i][j]); fprintf(output_file,"\n");
      }
      fprintf(output_file,";\nEND;\n");
      
      fclose(output_file);
    }

  if(format==1) /* MEGA format */
    {
      printf("writing distance matrix in MEGA format..."); fflush(stdout);
      
      /* output distance matrix file with inverted means (of fraction_gt_cutoff) in MEGA format */
      
      for(x=0;x<n_species;x++) for(y=0;y<n_species;y++) {counter[x][y]=0; sum[x][y]=0;}
      for(i=0;i<n_samples;i++) /* i = sample 1 (vertical) */
	{
      x=0; y=0;
      for(k=0;k<n_species;k++) if(strcmp(short_sample_name[i],species_name[k])==0) {x=k; break;}
      for(j=0;j<n_samples;j++) /* j = sample 2 (horizontal) */
	{
	  for(k=0;k<n_species;k++) if(strcmp(short_sample_name[j],species_name[k])==0) {y=k; break;}
	  if(j!=i) {S[x][y][counter[x][y]]=A_fraction_gt_cutoff[i][j]; counter[x][y]++;}
	}
	}
      
      for(x=0;x<n_species;x++) for(y=0;y<n_species;y++) for(k=0;k<counter[x][y];k++) sum[x][y]+=S[x][y][k];
      for(x=0;x<n_species;x++) for(y=0;y<n_species;y++) mean[x][y]=sum[x][y]/counter[x][y]; /* calculate means for MEGA file */
      
      strcpy(output_filename,output_filename_stem); strcat(output_filename,"_distance_matrix.meg");
      if((output_file=fopen(output_filename,"w"))==NULL) {printf("error opening output file %s for writing",output_filename); return -1;}
      
      fprintf(output_file,"#mega\n");
      fprintf(output_file,"TITLE: %s (lower-left triangular matrix, cutoff=%.4f)\n\n",output_filename, cutoff);
      // fprintf(output_file,"!Format DataType=Distance DataFormat=LowerLeft;\n\n");
  
      for(i=0;i<n_species;i++) fprintf(output_file,"QC\t%s\t%.3f\n",species_name[i],QC[i]);
      fprintf(output_file,"\n"); p=strtok('\0',"\t");

      for(i=0;i<n_species;i++) fprintf(output_file,"#%s\n",species_name[i]);
      fprintf(output_file,"\n");
      for(i=0;i<n_species;i++) {for(j=0;j<i;j++) if(mean[i][j]>0) fprintf(output_file,"%1.5f\t",1/mean[i][j]); fprintf(output_file,"\n");}
      
      fclose(output_file);
    }
    
  
  /* return from main */

  return 0;
}
