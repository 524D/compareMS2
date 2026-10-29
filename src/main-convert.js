// SPDX-License-Identifier: MIT
// Copyright Rob Marissen.

// Conversion of vendor/open mass spectrometry formats to MGF using ProteoWizard msconvert.
// Converted files are cached on disk and reused as long as the source file is unchanged.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { llog, setActivity, isWindowValid, addActiveProcess, removeActiveProcess, shortHashObj } = require('./main-common.js');

// Extensions (lowercase) of non-MGF files that msconvert can read as a single file
const CONVERTIBLE_EXTENSIONS = ['.raw', '.wiff', '.wiff2', '.mzml', '.mzxml', '.mz5', '.mzdata', '.lcd'];
const MSCONVERT_ARGS = [
    '--mgf',
    '--filter', 'peakPicking vendor',
    '--filter', 'msLevel 2',
];
const DEFAULT_CACHE_SUBDIR = 'converted_mgf';

let msconvertExe = null;

function isExecutableFile(p) {
    try {
        if (!fs.statSync(p).isFile()) return false;
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    } catch (e) {
        return false;
    }
}

// ProteoWizard installs into versioned subdirectories, so look in the base directory and one level below.
function listWindowsInstallDirs() {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const dirs = [];
    for (const base of [path.join(local, 'Programs', 'ProteoWizard'), path.join(programFiles, 'ProteoWizard')]) {
        dirs.push(base);
        try {
            const subDirs = fs.readdirSync(base, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => e.name)
                .sort()
                .reverse(); // Newest version first
            for (const d of subDirs) dirs.push(path.join(base, d));
        } catch (e) { /* base directory does not exist */ }
    }
    return dirs;
}

// Locate the msconvert executable. Returns its path or null.
function findMsconvert() {
    const exeName = process.platform === 'win32' ? 'msconvert.exe' : 'msconvert';
    const dirs = process.platform === 'win32' ? listWindowsInstallDirs() : [];
    for (const d of (process.env.PATH || '').split(path.delimiter)) {
        const dir = d.replace(/^"|"$/g, '');
        if (dir) dirs.push(dir);
    }
    for (const dir of dirs) {
        const candidate = path.join(dir, exeName);
        if (isExecutableFile(candidate)) return candidate;
    }
    return null;
}

function initConvert() {
    msconvertExe = findMsconvert();
    return msconvertExe;
}

function getMsconvertExe() {
    return msconvertExe;
}

function isMgfFile(file) {
    return file.toLowerCase().endsWith('.mgf');
}

function needsConversion(file) {
    return CONVERTIBLE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

// True for MGF files, and for convertible files when msconvert is available
function isSupportedInput(file) {
    return isMgfFile(file) || (msconvertExe !== null && needsConversion(file));
}

// Filters for the file open dialogs
function getInputFileFilters() {
    const filters = [];
    if (msconvertExe) {
        const exts = ['mgf', ...CONVERTIBLE_EXTENSIONS.map(e => e.slice(1))];
        filters.push({ name: 'Mass spectrometry files', extensions: exts });
    }
    filters.push({ name: 'MGF files', extensions: ['mgf'] });
    filters.push({ name: 'All Files', extensions: ['*'] });
    return filters;
}

function readMeta(mgf) {
    try {
        return JSON.parse(fs.readFileSync(mgf + '.json', 'utf8'));
    } catch (e) {
        return null;
    }
}

function getSourceSignature(src) {
    const st = fs.statSync(src);
    return {
        source: src,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        args: shortHashObj(MSCONVERT_ARGS),
    };
}

function isCacheValid(mgf, sig) {
    const meta = readMeta(mgf);
    if (!meta) return false;
    try {
        if (fs.statSync(mgf).size === 0) return false;
    } catch (e) {
        return false;
    }
    return meta.source === sig.source && meta.size === sig.size &&
        meta.mtimeMs === sig.mtimeMs && meta.args === sig.args;
}

// Pick the cache file for a source file: <stem>.mgf, or <stem>-<hash>.mgf if that name belongs to another source.
function chooseCacheFile(src, cacheDir) {
    const stem = path.parse(src).name;
    const candidates = [
        path.join(cacheDir, stem + '.mgf'),
        path.join(cacheDir, `${stem}-${shortHashObj(src).slice(0, 8)}.mgf`),
    ];
    for (const c of candidates) {
        const meta = readMeta(c);
        if (meta ? meta.source === src : !fs.existsSync(c)) return c;
    }
    return candidates[1];
}

function runMsconvert(window, instanceId, src, target, sig) {
    const partialDir = target + '.partial';
    fs.rmSync(partialDir, { recursive: true, force: true });
    fs.mkdirSync(partialDir, { recursive: true });

    const args = [src, ...MSCONVERT_ARGS, '-o', partialDir];
    llog(window, `Converting ${src} to MGF (this can take a long time): ${msconvertExe} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
        const child = spawn(msconvertExe, args, { windowsHide: true });
        addActiveProcess(instanceId, child);
        let stderrTail = '';
        child.stderr.on('data', (data) => {
            stderrTail = (stderrTail + data.toString()).slice(-1000);
        });
        // Drain stdout so msconvert never blocks on a full pipe
        child.stdout.on('data', () => { });
        child.on('error', (err) => {
            removeActiveProcess(instanceId, child);
            reject(err);
        });
        child.on('close', (code) => {
            removeActiveProcess(instanceId, child);
            if (code === 0) resolve();
            else reject(new Error(`msconvert exited with code ${code}: ${stderrTail.trim()}`));
        });
    }).then(() => {
        const produced = fs.readdirSync(partialDir).find(isMgfFile);
        if (!produced) throw new Error('msconvert did not produce an MGF file for ' + src);
        // Write metadata first: a crash before the rename then just triggers a reconversion
        fs.writeFileSync(target + '.json', JSON.stringify(sig, null, 2), 'utf8');
        fs.renameSync(path.join(partialDir, produced), target);
        llog(window, `Conversion finished: ${target}`);
        return target;
    }).finally(() => {
        fs.rmSync(partialDir, { recursive: true, force: true });
    });
}

const inFlight = new Map(); // target path -> promise

// Return the path of an up-to-date MGF for src, converting it if needed.
function ensureConverted(window, instanceId, src, cacheDirOpt) {
    if (!msconvertExe) {
        return Promise.reject(new Error('msconvert was not found, cannot convert ' + src));
    }
    const cacheDir = cacheDirOpt || path.join(path.dirname(src), DEFAULT_CACHE_SUBDIR);
    fs.mkdirSync(cacheDir, { recursive: true });
    const target = chooseCacheFile(src, cacheDir);
    const sig = getSourceSignature(src);
    if (isCacheValid(target, sig)) {
        llog(window, `Using previously converted file: ${target}`);
        return Promise.resolve(target);
    }
    let pending = inFlight.get(target);
    if (!pending) {
        pending = runMsconvert(window, instanceId, src, target, sig).finally(() => inFlight.delete(target));
        inFlight.set(target, pending);
    }
    return pending;
}

// Map each input file to a usable MGF file; MGF files map to themselves.
// Conversions run one at a time because msconvert is memory and I/O heavy.
async function resolveInputFiles(window, instanceId, files, cacheDirOpt) {
    const unique = [...new Set(files)];
    const nConvert = unique.filter(needsConversion).length;
    const result = new Map();
    let done = 0;
    for (const f of unique) {
        if (!isWindowValid(window)) throw new Error('Window closed');
        if (!needsConversion(f)) {
            result.set(f, f);
            continue;
        }
        setActivity(window, `Converting ${path.basename(f)} to MGF (${done + 1}/${nConvert})`);
        result.set(f, await ensureConverted(window, instanceId, f, cacheDirOpt));
        done++;
    }
    return result;
}

exports.initConvert = initConvert;
exports.getMsconvertExe = getMsconvertExe;
exports.isSupportedInput = isSupportedInput;
exports.needsConversion = needsConversion;
exports.getInputFileFilters = getInputFileFilters;
exports.resolveInputFiles = resolveInputFiles;
