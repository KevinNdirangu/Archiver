const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

// 1. Load Configuration
const configPath = path.join(__dirname, 'config.json');
const lastSnapshotFile = path.join(__dirname, '.last_snapshot');

if (!fs.existsSync(configPath)) {
    console.error("[ERROR] config.json not found. Please run 'npm run setup' first.");
    process.exit(1);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
    console.error("[ERROR] Failed to parse config.json:", err.message);
    process.exit(1);
}

const isEnabled = config.enabled !== false;
if (!isEnabled) {
    console.log("[INFO] Archiver is currently disabled in config.json.");
    process.exit(0);
}

const sourceFolders = (config.source_folders || config.sourceFolders || []).map(p => path.resolve(p));
const archiveFolders = (config.archive_folders || config.targetFolders || []).map(p => path.resolve(p));
const watchExtensions = (config.watch_extensions || [
    ".xlsx", ".docx", ".pdf", ".txt", ".csv", ".pptx", ".js", ".json",
    ".rtf", ".md", ".doc", ".xls", ".ppt", ".png", ".jpg", ".jpeg"
]).map(ext => ext.toLowerCase());

const retryAttempts = config.retry_attempts || 3;
const retryDelayMs = config.retry_delay_ms || 3000;

if (sourceFolders.length === 0 || archiveFolders.length === 0) {
    console.error("[ERROR] Source or Target folders are missing in config.json.");
    process.exit(1);
}

// Month names helper for clean folder naming
const MONTH_NAMES = [
    "01_January", "02_February", "03_March", "04_April",
    "05_May", "06_June", "07_July", "08_August",
    "09_September", "10_October", "11_November", "12_December"
];

// 2. Helper: Get Current Year, Named Month, and DD-MM-YYYY Day
function CalendarStructure(date = new Date()) {
    const year = date.getFullYear().toString();
    const monthNumber = String(date.getMonth() + 1).padStart(2, '0');
    const dayNumber = String(date.getDate()).padStart(2, '0');

    const monthFolder = MONTH_NAMES[date.getMonth()];
    // Builds DD-MM-YYYY -> e.g. "31-08-2026"
    const dayFolder = `${dayNumber}-${monthNumber}-${year}`; 
    
    return { year, monthFolder, dayFolder };
}

// 3. Helper: Filter out temp files, lock files, and unwatched extensions
function shouldIgnoreFile(filePath) {
    const filename = path.basename(filePath);
    
    // Ignore MS Office lock files (~$file.docx), temporary files, partial downloads
    if (filename.startsWith('~$') || filename.startsWith('.~') || filename.endsWith('.tmp') || filename.endsWith('.crdownload')) {
        return true;
    }

    // Ignore hidden files and dot-folders
    const parts = filePath.split(path.sep);
    if (parts.some(part => part.startsWith('.') && part !== '.' && part !== '..')) {
        return true;
    }

    // Ignore common heavy/irrelevant build directories
    if (parts.includes('node_modules') || parts.includes('dist') || parts.includes('build')) {
        return true;
    }

    const ext = path.extname(filename).toLowerCase();
    if (watchExtensions.length > 0 && !watchExtensions.includes(ext)) {
        return true;
    }

    return false;
}

// 4. Helper: Find which sourceFolder a given file belongs to
function getSourceFolderForFile(filePath) {
    const normalizedFile = path.resolve(filePath).toLowerCase();
    for (const src of sourceFolders) {
        const normalizedSrc = path.resolve(src).toLowerCase();
        if (normalizedFile === normalizedSrc || normalizedFile.startsWith(normalizedSrc + path.sep)) {
            return src;
        }
    }
    return null;
}

// 5. Helper: Archive ONLY a specific single file
function archiveSingleFile(absoluteFilePath, sourceDir = null, attempt = 1) {
    if (!fs.existsSync(absoluteFilePath)) {
        return; // File was deleted or was a transient temporary file
    }

    try {
        const stat = fs.statSync(absoluteFilePath);
        if (stat.isDirectory()) return;

        if (shouldIgnoreFile(absoluteFilePath)) {
            return;
        }

        if (!sourceDir) {
            sourceDir = getSourceFolderForFile(absoluteFilePath);
        }

        if (!sourceDir) {
            console.warn(`[WARN] File not inside any configured source folder: ${absoluteFilePath}`);
            return;
        }

        const sourceFolderName = path.basename(sourceDir);
        const relPath = path.relative(sourceDir, absoluteFilePath);
        const { year, monthFolder, dayFolder } = CalendarStructure();

        archiveFolders.forEach((vaultDir) => {
            if (!fs.existsSync(vaultDir)) {
                try {
                    fs.mkdirSync(vaultDir, { recursive: true });
                } catch (e) {
                    console.log(`[WARN] Archive vault unreachable/offline: ${vaultDir}`);
                    return;
                }
            }

            const destinationPath = path.join(vaultDir, year, monthFolder, dayFolder, sourceFolderName, relPath);
            const destinationDir = path.dirname(destinationPath);

            // Check if already backed up today with identical size & modified time
            if (fs.existsSync(destinationPath)) {
                try {
                    const destStat = fs.statSync(destinationPath);
                    if (destStat.size === stat.size && Math.abs(destStat.mtimeMs - stat.mtimeMs) < 1000) {
                        return; // Already up-to-date in today's vault
                    }
                } catch (e) {
                    // Proceed to copy if stat fails
                }
            }

            try {
                if (!fs.existsSync(destinationDir)) {
                    fs.mkdirSync(destinationDir, { recursive: true });
                }
                fs.copyFileSync(absoluteFilePath, destinationPath);
                console.log(`[ARCHIVED] ${relPath} -> ${path.join(year, monthFolder, dayFolder, sourceFolderName, relPath)}`);
            } catch (err) {
                if (attempt <= retryAttempts && (err.code === 'EBUSY' || err.code === 'EPERM')) {
                    console.log(`[RETRY] File busy (${err.code}). Retrying ${relPath} (attempt ${attempt}/${retryAttempts})...`);
                    setTimeout(() => {
                        archiveSingleFile(absoluteFilePath, sourceDir, attempt + 1);
                    }, retryDelayMs);
                } else {
                    console.error(`[ERROR] Failed to archive ${relPath}:`, err.message);
                }
            }
        });
    } catch (err) {
        if (attempt <= retryAttempts) {
            setTimeout(() => {
                archiveSingleFile(absoluteFilePath, sourceDir, attempt + 1);
            }, retryDelayMs);
        } else {
            console.error(`[ERROR] Could not read file ${absoluteFilePath}:`, err.message);
        }
    }
}

// 6. Helper: Track last snapshot time for incremental scans
function getLastSnapshotTime() {
    if (fs.existsSync(lastSnapshotFile)) {
        try {
            const raw = fs.readFileSync(lastSnapshotFile, 'utf8').trim();
            const parsed = new Date(raw);
            if (!isNaN(parsed.getTime())) {
                return parsed.getTime();
            }
        } catch (e) {}
    }
    // Default fallback: start of today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return startOfToday.getTime();
}

function updateLastSnapshotTime() {
    try {
        fs.writeFileSync(lastSnapshotFile, new Date().toISOString());
    } catch (e) {
        console.error('[WARN] Could not update .last_snapshot file:', e.message);
    }
}

// 7. Helper: Scan source directories for only modified/created files
function scanDirectoryForModifiedFiles(dir, sinceTime, sourceDir, modifiedList = []) {
    if (!fs.existsSync(dir)) return modifiedList;

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        return modifiedList;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'dist' || entry.name === 'build') {
                continue;
            }
            scanDirectoryForModifiedFiles(fullPath, sinceTime, sourceDir, modifiedList);
        } else if (entry.isFile()) {
            if (shouldIgnoreFile(fullPath)) continue;
            try {
                const stat = fs.statSync(fullPath);
                if (stat.mtimeMs >= sinceTime) {
                    modifiedList.push({ path: fullPath, sourceDir });
                }
            } catch (e) {}
        }
    }
    return modifiedList;
}

// 8. Trigger Incremental Snapshot (only modified/created files)
function triggerIncrementalSnapshot() {
    const sinceTime = getLastSnapshotTime();
    const sinceDateStr = new Date(sinceTime).toLocaleString();
    console.log(`\n[ARCHIVE] Checking for files modified or created since: ${sinceDateStr}...`);

    let modifiedFiles = [];
    for (const sourceDir of sourceFolders) {
        if (!fs.existsSync(sourceDir)) {
            console.log(`[WARN] Source folder does not exist: ${sourceDir}`);
            continue;
        }
        scanDirectoryForModifiedFiles(sourceDir, sinceTime, sourceDir, modifiedFiles);
    }

    if (modifiedFiles.length === 0) {
        console.log(`[INFO] No new or modified files found since last check.`);
    } else {
        console.log(`[INFO] Found ${modifiedFiles.length} modified/created file(s). Archiving...`);
        for (const item of modifiedFiles) {
            archiveSingleFile(item.path, item.sourceDir);
        }
        console.log(`[SUCCESS] Incremental archive completed for ${modifiedFiles.length} file(s).`);
    }

    updateLastSnapshotTime();
}

// 9. Purge Old Snapshots (Older than 30 Days)
function purgeOldSnapshots(retentionDays = 30) {
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    archiveFolders.forEach((vaultDir) => {
        if (!fs.existsSync(vaultDir)) return;

        let years;
        try {
            years = fs.readdirSync(vaultDir);
        } catch (err) {
            return;
        }

        years.forEach((year) => {
            const yearPath = path.join(vaultDir, year);
            if (fs.lstatSync(yearPath).isDirectory() && /^\d{4}$/.test(year)) {
                
                const months = fs.readdirSync(yearPath);
                months.forEach((month) => {
                    const monthPath = path.join(yearPath, month);
                    if (fs.lstatSync(monthPath).isDirectory()) {
                        
                        const days = fs.readdirSync(monthPath);
                        days.forEach((day) => {
                            const dayPath = path.join(monthPath, day);
                            // Matches DD-MM-YYYY pattern like 31-08-2026
                            if (fs.lstatSync(dayPath).isDirectory() && /^\d{2}-\d{2}-\d{4}$/.test(day)) {
                                const stats = fs.statSync(dayPath);
                                if (now - stats.mtimeMs > maxAgeMs) {
                                    try {
                                        fs.rmSync(dayPath, { recursive: true, force: true });
                                        console.log(`[CLEANUP] Purged old snapshot: ${year}/${month}/${day}`);
                                    } catch (err) {
                                        console.error(`[WARN] Failed to purge ${dayPath}:`, err.message);
                                    }
                                }
                            }
                        });

                        // Clean up empty month folders if all days were purged
                        if (fs.readdirSync(monthPath).length === 0) {
                            fs.rmdirSync(monthPath);
                        }
                    }
                });

                // Clean up empty year folders if all months were purged
                if (fs.readdirSync(yearPath).length === 0) {
                    fs.rmdirSync(yearPath);
                }
            }
        });
    });
}

// 10. Execution Modes (Command-line flag vs Watcher Daemon)
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--snapshot')) {
        triggerIncrementalSnapshot();
        purgeOldSnapshots();
        console.log("[DONE] Incremental snapshot complete.");
        process.exit(0);
    } else {
        console.log("==========================================");
        console.log(" Universal Auto-Archiver Daemon Active");
        console.log(` Watching ${sourceFolders.length} source folder(s) for file changes...`);
        console.log("==========================================");

        // Initial check for files created/edited while offline
        triggerIncrementalSnapshot();
        purgeOldSnapshots();

        // Start Chokidar watcher with file-level event handling
        const watcher = chokidar.watch(sourceFolders, {
            ignored: [
                /(^|[\/\\])\../, // ignore dotfiles/dotfolders
                '**/node_modules/**',
                '**/*.tmp',
                '**/*.crdownload',
                '**/~$*'
            ],
            persistent: true,
            ignoreInitial: true, // Don't dump entire existing source folders on start
            awaitWriteFinish: {
                stabilityThreshold: 1500,
                pollInterval: 200
            },
            ignorePermissionErrors: true
        });

        watcher
            .on('add', (filePath) => {
                console.log(`\n[NEW FILE DETECTED] ${filePath}`);
                archiveSingleFile(filePath);
            })
            .on('change', (filePath) => {
                console.log(`\n[EDIT DETECTED] ${filePath}`);
                archiveSingleFile(filePath);
            })
            .on('error', (error) => {
                console.error(`[WATCHER ERROR]`, error.message);
            });

        // Run purge once every 24 hours
        setInterval(() => {
            purgeOldSnapshots();
            updateLastSnapshotTime();
        }, 24 * 60 * 60 * 1000);
    }
}

module.exports = {
    archiveSingleFile,
    triggerIncrementalSnapshot,
    shouldIgnoreFile,
    CalendarStructure,
    purgeOldSnapshots
};