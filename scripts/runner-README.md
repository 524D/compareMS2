# Serial all-pairs runner

`run-comparems2-all-pairs.ps1` is a Windows PowerShell 5.1-compatible batch runner for the compareMS2 command-line executables. It runs every unique pair of MGF files serially, resumes valid cached results after interruption, validates outputs, logs failures, shows progress and ETA, and can optionally invoke `compareMS2_to_distance_matrices`.

Serial execution is intentional. A single process avoids oversubscribing memory on large datasets and provides a conservative option for unattended runs. The script commits results atomically: each comparison is written to a `.partial` path and moved to its final path only after compareMS2 returns exit code 0 and the output contains `dataset_A`, `dataset_B`, and `set_distance` fields.

## Requirements

- Windows PowerShell 5.1 or PowerShell 7+
- `compareMS2.exe`
- `compareMS2_to_distance_matrices.exe` only when matrix generation is requested
- At least two `.mgf` files with unique basenames

## Pairwise run

From the compareMS2 repository root:

```powershell
.\scripts\run-comparems2-all-pairs.ps1 `
    -MGFDirectory 'C:\data\mgfs' `
    -OutputDirectory 'C:\data\compareMS2-run' `
    -CompareMS2Path '.\external_binaries\compareMS2.exe'
```

## Pairwise run and matrix

```powershell
.\scripts\run-comparems2-all-pairs.ps1 `
    -MGFDirectory 'C:\data\mgfs' `
    -OutputDirectory 'C:\data\compareMS2-run' `
    -CompareMS2Path '.\external_binaries\compareMS2.exe' `
    -DistanceMatrixPath '.\external_binaries\compareMS2_to_distance_matrices.exe' `
    -MappingFile 'C:\data\sample-to-species.txt' `
    -MatrixFormat Mega12
```

The optional mapping file is tab-delimited, with the MGF filename in column one and the species or group name in column two.

## Resume behavior

Run the same command again after an interruption. Existing nonempty result files are reused only if they contain all required fields. Empty, partial, and malformed files are recomputed. Use `-Force` to recompute all comparisons.

By default, the first failed pair stops the run. Use `-KeepGoing` to collect all failures in `failures.tsv`; matrix generation remains blocked until every expected pair has a valid result.

## Parameters

The runner defaults match the compareMS2 CLI defaults. Analysis flags can be overridden with PowerShell parameters such as `-Cutoff`, `-MaxPrecursorDifference`, `-MinBasepeakIntensity`, `-Scaling`, `-Noise`, and `-Metric`. Run the following for complete help:

```powershell
Get-Help .\scripts\run-comparems2-all-pairs.ps1 -Full
```
