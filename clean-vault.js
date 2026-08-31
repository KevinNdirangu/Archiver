const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Locate and load config.json dynamically
const CONFIG_PATH = path.join(__dirname, 'config.json');

if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ Configuration file not found at: ${CONFIG_PATH}`);
    process.exit(1);
}

let config;
try {
    const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(rawData);
} catch (err) {
    console.error(`❌ Failed to parse ${CONFIG_PATH}:`, err.message);
    process.exit(1);
}

// Extract archive targets from config
const ARCHIVE_FOLDERS = config.archive_folders || [];

if (ARCHIVE_FOLDERS.length === 0) {
    console.log('⚠️ No archive folders specified in config.json.');
    process.exit(0);
}

// Directories to completely purge across all deep trees
const JUNK_DIRECTORIES = new Set([
    'node_modules',
    'live-deltas',
    '.git',
    'dist',
    'build',
    '.cache',
    '.vscode'
]);

// Media file extensions to purge
const MEDIA_EXTENSIONS = new Set([
    // Video
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv',
    // Audio
    '.mp3', '.wav', '.ogg', '.flac',
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'
]);

// Archive file extensions to purge inside backup trees
const ARCHIVE_EXTENSIONS = new Set([
    '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar'
]);

/**
 * MD5 hashing for content-based deduplication
 */
function getFileHash(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * STAGE 1: Deep Unrestricted Purge
 */
function deepPurgeVault(dirPath, rootVaultDir) {
    if (!fs.existsSync(dirPath)) return;

    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            if (JUNK_DIRECTORIES.has(entry.name)) {
                console.log(`🗑️ Wiping directory: ${path.relative(rootVaultDir, fullPath)}`);
                fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
                deepPurgeVault(fullPath, rootVaultDir);
                if (fs.existsSync(fullPath) && fs.readdirSync(fullPath).length === 0) {
                    fs.rmdirSync(fullPath);
                }
            }
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();

            if (MEDIA_EXTENSIONS.has(ext)) {
                console.log(`🗑️ Removing media: ${path.relative(rootVaultDir, fullPath)}`);
                fs.unlinkSync(fullPath);
            } else if (ARCHIVE_EXTENSIONS.has(ext)) {
                console.log(`📦 Removing archive: ${path.relative(rootVaultDir, fullPath)}`);
                fs.unlinkSync(fullPath);
            }
        }
    }
}

/**
 * STAGE 2: Deep File Harvester
 */
function getAllVaultFiles(dirPath, fileList = []) {
    if (!fs.existsSync(dirPath)) return fileList;
    
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
        return fileList;
    }

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            getAllVaultFiles(fullPath, fileList);
        } else if (entry.isFile()) {
            fileList.push(fullPath);
        }
    }

    return fileList;
}

/**
 * STAGE 3: Cross-Year & Cross-Month Hard Link Deduplication
 */
function deduplicateVault(vaultDir) {
    if (!fs.existsSync(vaultDir)) return;

    console.log(`\n🔍 Deduplicating code/text files in: ${vaultDir}`);

    const allFiles = getAllVaultFiles(vaultDir);
    const hashMap = new Map();
    let savedBytes = 0;
    let linkedCount = 0;

    for (const filePath of allFiles) {
        const stat = fs.statSync(filePath);
        const hash = getFileHash(filePath);

        if (hashMap.has(hash)) {
            const originalPath = hashMap.get(hash);
            const origStat = fs.statSync(originalPath);

            if (origStat.ino !== stat.ino) {
                fs.unlinkSync(filePath);
                fs.linkSync(originalPath, filePath);

                savedBytes += stat.size;
                linkedCount++;
                console.log(`🔗 Hard-linked: ${path.relative(vaultDir, filePath)}`);
            }
        } else {
            hashMap.set(hash, filePath);
        }
    }

    const savedMB = (savedBytes / (1024 * 1024)).toFixed(2);
    console.log(`✨ Deduplication Summary for ${path.basename(vaultDir)}:`);
    console.log(`🔗 Hard-linked ${linkedCount} identical files.`);
    console.log(`💾 Reclaimed ~${savedMB} MB of space.`);
}

/**
 * Execution pipeline iterating over all config target folders
 */
function runPortableCleanup() {
    console.log(`⚙️ Loaded configuration from ${path.basename(CONFIG_PATH)}`);
    console.log(`📂 Processing ${ARCHIVE_FOLDERS.length} archive directory target(s)...\n`);

    for (const vaultPath of ARCHIVE_FOLDERS) {
        const targetDir = path.normalize(vaultPath);

        if (!fs.existsSync(targetDir)) {
            console.log(`⚠️ Archive path does not exist on this machine, skipping: ${targetDir}`);
            continue;
        }

        console.log(`==================================================`);
        console.log(`🧹 Processing Archive Target: ${targetDir}`);
        console.log(`==================================================`);

        deepPurgeVault(targetDir, targetDir);
        deduplicateVault(targetDir);
        console.log(`\n✅ Finished cleaning: ${targetDir}\n`);
    }

    console.log('🎉 Vault cleanup completed across all available target paths!');
}

runPortableCleanup();