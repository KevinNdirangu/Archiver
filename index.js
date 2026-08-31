const fs = require('fs');
const path = require('path');

// 1. Load Configuration
const configPath = path.join(__dirname, 'config.json');

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

const sourceFolders = config.source_folders || config.sourceFolders || [];
const archiveFolders = config.archive_folders || config.targetFolders || [];
const watchExtensions = config.watch_extensions || [
    ".xlsx", ".docx", ".pdf", ".txt", ".csv", ".pptx", ".js", ".json",
    ".rtf", ".md", ".doc", ".xls", ".ppt", ".png", ".jpg", ".jpeg"
];

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
function CalendarStructure() {
    const now = new Date();
    const year = now.getFullYear().toString();
    const monthNumber = String(now.getMonth() + 1).padStart(2, '0');
    const dayNumber = String(now.getDate()).padStart(2, '0');

    const monthFolder = MONTH_NAMES[now.getMonth()];
    // Builds DD-MM-YYYY -> e.g. "31-08-2026"
    const dayFolder = `${dayNumber}-${monthNumber}-${year}`; 
    
    return { year, monthFolder, dayFolder };
}

// 3. Helper: Copy Files Recursively
function copyFolderRecursive(source, target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }

    const files = fs.readdirSync(source);

    files.forEach((file) => {
        const curSource = path.join(source, file);
        const curTarget = path.join(target, file);

        if (fs.lstatSync(curSource).isDirectory()) {
            copyFolderRecursive(curSource, curTarget);
        } else {
            const ext = path.extname(file).toLowerCase();
            if (watchExtensions.includes(ext) || watchExtensions.length === 0) {
                try {
                    fs.copyFileSync(curSource, curTarget);
                } catch (err) {
                    console.error(`[WARN] Could not copy file ${file}:`, err.message);
                }
            }
        }
    });
}

// 4. Trigger Archival Snapshot into Year / Month / DD-MM-YYYY structure
function triggerSnapshot() {
    const { year, monthFolder, dayFolder } = CalendarStructure();
    console.log(`\n[ARCHIVE] Starting snapshot run: ${year} -> ${monthFolder} -> ${dayFolder}...`);

    archiveFolders.forEach((vaultDir) => {
        sourceFolders.forEach((sourceDir) => {
            if (!fs.existsSync(sourceDir)) {
                console.log(`[WARN] Source folder does not exist: ${sourceDir}`);
                return;
            }

            const sourceFolderName = path.basename(sourceDir);
            
            // Builds target path as: TargetVault / 2026 / 08_August / 31-08-2026 / SourceFolderName
            const destinationPath = path.join(vaultDir, year, monthFolder, dayFolder, sourceFolderName);

            try {
                copyFolderRecursive(sourceDir, destinationPath);
                console.log(`[SUCCESS] Backed up: ${sourceFolderName} -> ${destinationPath}`);
            } catch (err) {
                console.error(`[ERROR] Failed backing up ${sourceFolderName}:`, err.message);
            }
        });
    });
}

// 5. Purge Old Snapshots (Older than 30 Days)
function purgeOldSnapshots(retentionDays = 30) {
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    archiveFolders.forEach((vaultDir) => {
        if (!fs.existsSync(vaultDir)) return;

        const years = fs.readdirSync(vaultDir);
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

// 6. Execution Modes (Command-line flag vs Watcher Daemon)
const args = process.argv.slice(2);

if (args.includes('--snapshot')) {
    triggerSnapshot();
    purgeOldSnapshots();
    console.log("[DONE] Snapshot complete.");
    process.exit(0);
} else {
    console.log("==========================================");
    console.log(" Universal Auto-Archiver Daemon Active");
    console.log(` Watching ${sourceFolders.length} source folder(s)...`);
    console.log("==========================================");

    triggerSnapshot();
    purgeOldSnapshots();

    sourceFolders.forEach((folder) => {
        if (fs.existsSync(folder)) {
            let debounceTimer;
            fs.watch(folder, { recursive: true }, (eventType, filename) => {
                if (filename) {
                    const ext = path.extname(filename).toLowerCase();
                    if (watchExtensions.includes(ext)) {
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            console.log(`[CHANGE DETECTED] ${filename} altered in ${folder}`);
                            triggerSnapshot();
                        }, 5000);
                    }
                }
            });
        }
    });

    setInterval(() => {
        purgeOldSnapshots();
    }, 24 * 60 * 60 * 1000);
}