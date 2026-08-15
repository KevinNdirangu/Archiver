const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
    console.error("❌ config.json missing. Run 'node setup.js' first.");
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Migration support from old config format
if (config.source_folder && !config.source_folders) {
    config.source_folders = [config.source_folder];
}

function getTimestamp() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    
    return {
        dateDir: `${yyyy}-${mm}-${dd}`,
        timeString: `${yyyy}-${mm}-${dd}_${hh}${min}${ss}`
    };
}

async function copyWithRetry(src, dest, attemptsLeft) {
    try {
        fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        console.log(`✅ SUCCESS: Archived -> ${path.basename(dest)}`);
    } catch (err) {
        if (err.code === 'EEXIST') return;
        if (attemptsLeft > 0 && (err.code === 'EBUSY' || err.code === 'EPERM')) {
            setTimeout(() => copyWithRetry(src, dest, attemptsLeft - 1), config.retry_delay_ms);
        } else {
            console.error(`⚠️ Copy failed for ${path.basename(src)}:`, err.message);
        }
    }
}

function archiveFile(filePath) {
    if (!config.enabled) return;
    const ext = path.extname(filePath).toLowerCase();
    if (!config.watch_extensions.includes(ext)) return;

    const absoluteFilePath = path.resolve(filePath).replace(/\\/g, '/');
    const absoluteArchiveFolder = path.resolve(config.archive_folder);

    // Find which source folder this file belongs to
    let matchingSourceFolder = null;
    for (let sf of config.source_folders) {
        const absSF = path.resolve(sf).replace(/\\/g, '/');
        if (absoluteFilePath.startsWith(absSF)) {
            matchingSourceFolder = absSF;
            break;
        }
    }

    if (!matchingSourceFolder) {
        matchingSourceFolder = path.dirname(absoluteFilePath);
    }

    const fileName = path.basename(absoluteFilePath, ext);
    const { dateDir, timeString } = getTimestamp();
    
    const relativeDir = path.relative(matchingSourceFolder, path.dirname(absoluteFilePath));
    const dailyArchiveDir = path.join(absoluteArchiveFolder, dateDir, relativeDir);

    try {
        if (!fs.existsSync(dailyArchiveDir)) {
            fs.mkdirSync(dailyArchiveDir, { recursive: true });
        }

        const newFileName = `${fileName}_${timeString}${ext}`;
        const destinationPath = path.join(dailyArchiveDir, newFileName);

        if (fs.existsSync(absoluteFilePath)) {
            copyWithRetry(absoluteFilePath, destinationPath, config.retry_attempts);
        }
    } catch (dirErr) {
        console.error(`❌ Directory creation error:`, dirErr.message);
    }
}

const watcher = chokidar.watch(config.source_folders, {
    ignored: /(^|[\/\\])\..|~\$/, 
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 4000, pollInterval: 1000 },
    ignoreInitial: true,
    ignorePermissionErrors: true,
    depth: 99
});

watcher.on('add', archiveFile).on('change', archiveFile);
console.log(`🚀 Engine running! Watching:\n - ${config.source_folders.join('\n - ')}`);