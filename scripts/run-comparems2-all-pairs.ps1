# SPDX-License-Identifier: MIT

<#
.SYNOPSIS
    Runs all unique pairwise compareMS2 comparisons in an MGF directory.

.DESCRIPTION
    Executes compareMS2 serially by default, validates every result, supports
    safe resume after interruption, and optionally builds a distance matrix.

    A result is committed atomically: compareMS2 writes to a temporary file,
    which is renamed only after a zero exit code and successful validation.

.PARAMETER MGFDirectory
    Directory containing input .mgf files.

.PARAMETER OutputDirectory
    Directory for pairwise results, logs, and distance-matrix outputs.

.PARAMETER CompareMS2Path
    Path to compareMS2 or compareMS2.exe.

.PARAMETER DistanceMatrixPath
    Optional path to compareMS2_to_distance_matrices executable. When supplied,
    the runner builds a distance matrix after all pairwise comparisons succeed.

.PARAMETER MappingFile
    Optional tab-delimited sample-to-species mapping file.

.PARAMETER OutputStem
    Distance-matrix output stem. Defaults to distance_matrix in OutputDirectory.

.PARAMETER MatrixFormat
    Distance-matrix format: Nexus, Mega, Mega12, or JSON.

.PARAMETER Force
    Recompute valid existing pairwise results instead of resuming them.

.PARAMETER KeepGoing
    Continue after failed pairwise comparisons. The matrix stage is still
    skipped unless every expected comparison has a valid result.

.EXAMPLE
    .\run-comparems2-all-pairs.ps1 `
        -MGFDirectory 'C:\data\mgfs' `
        -OutputDirectory 'C:\data\compareMS2-run' `
        -CompareMS2Path '.\external_binaries\compareMS2.exe'

.EXAMPLE
    .\run-comparems2-all-pairs.ps1 `
        -MGFDirectory 'C:\data\mgfs' `
        -OutputDirectory 'C:\data\compareMS2-run' `
        -CompareMS2Path '.\external_binaries\compareMS2.exe' `
        -DistanceMatrixPath '.\external_binaries\compareMS2_to_distance_matrices.exe' `
        -MappingFile 'C:\data\sample-to-species.txt' `
        -MatrixFormat Mega12
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$MGFDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$CompareMS2Path,

    [ValidateScript({ -not $_ -or (Test-Path -LiteralPath $_ -PathType Leaf) })]
    [string]$DistanceMatrixPath,

    [ValidateScript({ -not $_ -or (Test-Path -LiteralPath $_ -PathType Leaf) })]
    [string]$MappingFile,

    [string]$OutputStem,

    [ValidateSet('Nexus', 'Mega', 'Mega12', 'JSON')]
    [string]$MatrixFormat = 'Nexus',

    [ValidateRange(0.0, 1.0)]
    [double]$Cutoff = 0.8,

    [double]$MaxPrecursorDifference = 2.05,
    [double]$MinBasepeakIntensity = 0,
    [double]$MinTotalIonCurrent = 0,
    [double]$MaxScanNumberDifference = 10000,
    [double]$MaxRTDifference = 60,
    [double]$Scaling = 0.5,
    [double]$Noise = 0,

    [ValidateSet(0, 1, 2)]
    [int]$Metric = 2,

    [int]$SpectrumMetric = 0,
    [int]$QC = 0,

    [switch]$Force,
    [switch]$KeepGoing
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Get-PairId {
    param([Parameter(Mandatory = $true)][string]$CacheKey)
    $payload = [System.Text.Encoding]::UTF8.GetBytes($CacheKey)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [System.BitConverter]::ToString($sha.ComputeHash($payload)).Replace('-', '').ToLowerInvariant()
        return $hash.Substring(0, 16)
    }
    finally {
        $sha.Dispose()
    }
}

function Test-ComparisonResult {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -le 0) { return $false }

    $required = @('dataset_A', 'dataset_B', 'set_distance')
    $seen = @{}
    foreach ($line in (Get-Content -LiteralPath $Path)) {
        $field = ($line -split "`t", 2)[0]
        if ($required -contains $field) { $seen[$field] = $true }
    }
    $missing = @(
        $required |
            Where-Object { -not $seen.ContainsKey($_) }
    )

    return ($missing.Count -eq 0)
}

function Write-RunLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $record = '{0:u} | {1}' -f (Get-Date), $Message
    Add-Content -LiteralPath $script:LogFile -Value $record -Encoding UTF8
    Write-Host $record
}

$MGFDirectory = Get-FullPath $MGFDirectory
$OutputDirectory = Get-FullPath $OutputDirectory
$CompareMS2Path = Get-FullPath $CompareMS2Path
if ($DistanceMatrixPath) { $DistanceMatrixPath = Get-FullPath $DistanceMatrixPath }
if ($MappingFile) { $MappingFile = Get-FullPath $MappingFile }

$PairwiseDirectory = Join-Path $OutputDirectory 'pairwise'
$LogFile = Join-Path $OutputDirectory 'run.log'
$FailureLog = Join-Path $OutputDirectory 'failures.tsv'
$FileList = Join-Path $OutputDirectory 'pairwise-files.txt'
if (-not $OutputStem) { $OutputStem = Join-Path $OutputDirectory 'distance_matrix' }
else { $OutputStem = Get-FullPath $OutputStem }

New-Item -ItemType Directory -Force -Path $OutputDirectory, $PairwiseDirectory | Out-Null
if (-not (Test-Path -LiteralPath $LogFile)) {
    New-Item -ItemType File -Path $LogFile | Out-Null
}
if (-not (Test-Path -LiteralPath $FailureLog)) {
    "time`tfile_a`tfile_b`texit_code`terror" | Out-File -LiteralPath $FailureLog -Encoding UTF8
}

$mgfs = @(Get-ChildItem -LiteralPath $MGFDirectory -Filter '*.mgf' -File | Sort-Object Name)
if ($mgfs.Count -lt 2) { throw "At least two MGF files are required; found $($mgfs.Count)." }

$duplicateBaseNames = @($mgfs | Group-Object BaseName | Where-Object Count -gt 1)
if ($duplicateBaseNames.Count -gt 0) {
    throw "MGF basenames must be unique: $($duplicateBaseNames.Name -join ', ')"
}

$expected = [int64]$mgfs.Count * [int64]($mgfs.Count - 1) / 2
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$exeInfo = Get-Item -LiteralPath $CompareMS2Path
$runSignature = @(
    $CompareMS2Path, $exeInfo.Length, $exeInfo.LastWriteTimeUtc.Ticks,
    $Cutoff.ToString($inv), $MaxPrecursorDifference.ToString($inv),
    $MinBasepeakIntensity.ToString($inv), $MinTotalIonCurrent.ToString($inv),
    $MaxScanNumberDifference.ToString($inv), $MaxRTDifference.ToString($inv),
    $Scaling.ToString($inv), $Noise.ToString($inv), $Metric,
    $SpectrumMetric, $QC
) -join "`n"
$expectedResultFiles = New-Object System.Collections.Generic.List[string]
$started = Get-Date
$processed = [int64]0
$valid = [int64]0
$skipped = [int64]0
$failed = [int64]0

Write-RunLog "Starting serial run: MGFs=$($mgfs.Count), expected_pairs=$expected"

for ($i = 0; $i -lt $mgfs.Count; $i++) {
    for ($j = $i + 1; $j -lt $mgfs.Count; $j++) {
        $fileA = $mgfs[$i]
        $fileB = $mgfs[$j]
        $cacheKey = @(
            $runSignature,
            $fileA.FullName, $fileA.Length, $fileA.LastWriteTimeUtc.Ticks,
            $fileB.FullName, $fileB.Length, $fileB.LastWriteTimeUtc.Ticks
        ) -join "`n"
        $pairId = Get-PairId -CacheKey $cacheKey
        $outFile = Join-Path $PairwiseDirectory ("{0}.txt" -f $pairId)
        $expectedResultFiles.Add($outFile)
        $tmpFile = "$outFile.partial"
        $processed++

        if (-not $Force -and (Test-ComparisonResult -Path $outFile)) {
            $valid++
            $skipped++
        }
        else {
            Remove-Item -LiteralPath $outFile, $tmpFile -Force -ErrorAction SilentlyContinue
            $consoleFile = Join-Path $OutputDirectory ("console-{0}.log" -f $pairId)
            $compareArgs = @(
                '-A', $fileA.FullName,
                '-B', $fileB.FullName,
                '-o', $tmpFile,
                '-c', $Cutoff.ToString($inv),
                '-p', $MaxPrecursorDifference.ToString($inv),
                '-r', $MaxRTDifference.ToString($inv),
                '-w', $MaxScanNumberDifference.ToString($inv),
                '-m', ("{0},{1}" -f $MinBasepeakIntensity.ToString($inv), $MinTotalIonCurrent.ToString($inv)),
                '-s', $Scaling.ToString($inv),
                '-n', $Noise.ToString($inv),
                '-d', [string]$Metric,
                '-f', [string]$SpectrumMetric,
                '-q', [string]$QC
            )

            $failureMessage = $null
            $exitCode = 'NA'
            try {
                & $CompareMS2Path @compareArgs *> $consoleFile
                $exitCode = $LASTEXITCODE
                if ($exitCode -eq 0 -and (Test-ComparisonResult -Path $tmpFile)) {
                    Move-Item -LiteralPath $tmpFile -Destination $outFile -Force
                    Remove-Item -LiteralPath $consoleFile -Force -ErrorAction SilentlyContinue
                    $valid++
                }
                else {
                    $failureMessage = 'compareMS2 failed or produced an invalid result'
                }
            }
            catch {
                $failureMessage = $_.Exception.Message
            }

            if ($failureMessage) {
                $failed++
                Add-Content -LiteralPath $FailureLog -Value ("{0:u}`t{1}`t{2}`t{3}`t{4}" -f (Get-Date), $fileA.FullName, $fileB.FullName, $exitCode, $failureMessage) -Encoding UTF8
                Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue
                if (-not $KeepGoing) {
                    throw "$failureMessage for '$($fileA.Name)' and '$($fileB.Name)'; see $consoleFile"
                }
            }
        }

        $elapsed = (Get-Date) - $started
        $percent = 100.0 * $processed / $expected
        $etaText = 'calculating'
        if ($processed -gt 0 -and $elapsed.TotalSeconds -gt 0) {
            $remainingSeconds = ($elapsed.TotalSeconds / $processed) * ($expected - $processed)
            $etaText = (Get-Date).AddSeconds($remainingSeconds).ToString('u')
        }
        Write-Progress -Activity 'compareMS2 all-pairs run' -Status "$processed / $expected; failed=$failed; ETA=$etaText" -PercentComplete $percent

        if (($processed % 25) -eq 0) {
            Write-RunLog "processed=$processed, valid=$valid, skipped=$skipped, failed=$failed, ETA=$etaText"
        }
    }
}

Write-Progress -Activity 'compareMS2 all-pairs run' -Completed

$results = @(
    $expectedResultFiles |
    Where-Object { Test-ComparisonResult -Path $_ } |
    ForEach-Object { Get-Item -LiteralPath $_ }
)
if ($results.Count -ne $expected -or $failed -gt 0) {
    Write-RunLog "Pairwise validation failed: valid_files=$($results.Count), expected=$expected, failures=$failed"
    throw 'Not all pairwise comparisons succeeded; the distance matrix was not created.'
}

$results | Sort-Object Name | Select-Object -ExpandProperty FullName | Out-File -LiteralPath $FileList -Encoding ASCII
Write-RunLog "Pairwise stage complete: valid_files=$($results.Count), elapsed_hours=$([math]::Round(((Get-Date) - $started).TotalHours, 2))"

if ($DistanceMatrixPath) {
    $formatFlag = switch ($MatrixFormat) {
        'Nexus' { '-n' }
        'Mega'  { '-m' }
        'Mega12'{ '-m2' }
        'JSON'  { '-J' }
    }

    $matrixArgs = @('-i', $FileList, '-o', $OutputStem, '-c', $Cutoff.ToString([System.Globalization.CultureInfo]::InvariantCulture), $formatFlag)
    if ($MappingFile) { $matrixArgs += @('-x', $MappingFile) }

    Write-RunLog "Building $MatrixFormat distance matrix"
    & $DistanceMatrixPath @matrixArgs
    if ($LASTEXITCODE -ne 0) { throw "Distance-matrix executable exited with code $LASTEXITCODE." }

    $extension = switch ($MatrixFormat) {
        'Nexus' { '.nexus' }
        'Mega'  { '.meg' }
        'Mega12'{ '.meg' }
        'JSON'  { '.json' }
    }
    $matrixFile = "$OutputStem$extension"
    if (-not (Test-Path -LiteralPath $matrixFile -PathType Leaf) -or (Get-Item -LiteralPath $matrixFile).Length -le 0) {
        throw "Distance-matrix output was not created: $matrixFile"
    }
    Write-RunLog "Run completed successfully: matrix=$matrixFile"
}
else {
    Write-RunLog 'Run completed successfully; distance-matrix stage was not requested.'
}
