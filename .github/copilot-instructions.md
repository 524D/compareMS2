# compareMS2 - AI Coding Agent Instructions

This is a **scientific mass spectrometry analysis tool** built as an Electron desktop application for comparing tandem mass spectra datasets. The tool generates phylogenetic trees, heatmaps, and species comparisons from proteomics data.

## Architecture Overview

### Core Application Structure

- **Main Process**: `src/main.js` - Electron main process with modular compare modes
- **Compare Modes**: Split into separate modules (`main-phyltree.js`, `main-heatmap.js`, `main-spectra2species.js`)
- **Renderer Windows**: Each mode opens dedicated BrowserWindows with contextIsolation and preload scripts
- **External Binaries**: Platform-specific C executables in `external_binaries/` (compareMS2, compareMS2_to_distance_matrices)

### Window Architecture Pattern

Each comparison mode follows this pattern:

1. Main window (`index.html`) - configuration UI
2. Modal child windows for results - phylotree, heatmap, or spectra2species views
3. IPC communication via preload scripts (moving from `@electron/remote` to contextBridge)
4. Background C binary execution for heavy computation

### Key File Patterns

- `main-*.js` - Main process logic for each compare mode
- `*-preload.js` - Secure IPC bridges using contextBridge
- `*.html/css/js` triplets - Complete UI modules with dedicated styling
- Platform detection for binary selection (Windows .exe, Linux, Darwin)

## Development Workflows

### Debug Mode

Set `CPM_MS2_DEBUG="x"` environment variable to enable Chrome DevTools:

```bash
# Bash
export CPM_MS2_DEBUG="x" && yarn start
# Windows CMD
SET CPM_MS2_DEBUG=X && yarn start
```

### Build Commands

- `yarn start` - Development mode
- `yarn make` - Build distributable for current platform
- `./build-linux.sh` - Linux-specific build with package.json manipulation

### Platform Support

App detects platform in multiple places (`src/main.js`, renderer scripts) for binary selection:

- Windows x64: `.exe` extensions
- Linux x64: no extension
- macOS: `_darwin` suffix

## Project-Specific Conventions

### IPC Security Pattern

**CRITICAL**: App is transitioning from `@electron/remote` to proper IPC:

- Old pattern: Direct remote module access
- New pattern: contextBridge + preload scripts (see `spectra2species-preload.js`)
- Never accept file paths from renderer - use dialog selections stored in main process

### Data Flow Architecture

1. **Configuration**: User sets parameters in main window
2. **File Processing**: C binaries process MGF (mass spectrometry) files
3. **Results Caching**: JSON results cached in `compareresult/` subdirectory with hash-based filenames
4. **Visualization**: ECharts for charts, D3/phylotree for trees, real-time updates during processing

### Scientific Domain Specifics

- **MGF Files**: Mass spectrometry data format - the primary input
- **Distance Matrices**: Core output format (MEGA, Nexus formats supported)
- **Species Mapping**: Tab-separated files linking samples to species
- **UPGMA Trees**: Phylogenetic clustering algorithm implementation

### CSS/Layout Patterns

Uses flexbox with specific layout classes:

- `.tvert-container` - Full-height vertical flex containers
- `.mainhor-container` - Horizontal split (controls + visualization)
- `.tvert-main`, `.tvert-activity`, `.tvert-details` - Sectioned layouts
- Consistent `.control-item` styling across modes

### Error Handling Conventions

- Extensive platform validation (64-bit requirement)
- Missing file graceful degradation
- Logging via `electron-log` to data directory with timestamps
- HTML error display for unsupported platforms

## External Dependencies

### Critical Libraries

- **ECharts**: All chart rendering (heatmaps, bar charts)
- **D3 + phylotree**: Phylogenetic tree visualization
- **electron-forge**: Build system
- **@electron/remote**: IPC (being phased out)

### Build Requirements

- Node.js + yarn (specific versions required - see README)
- Platform-specific C binary compilation (external_binaries/)
- Windows: Squirrel installer, Linux: .deb packages

## Testing Data

- Primate sera datasets (OSF repository) - primary test data
- PRIDE Project PXD034932 - additional test datasets
- Files should be ~1,000 spectra for performance testing

## Performance Considerations

- Real-time chart updates during long-running comparisons
- Hash-based result caching to avoid recomputation
- SVG vs Canvas rendering options (SVG slower but scalable)
- Memory management for large distance matrices
