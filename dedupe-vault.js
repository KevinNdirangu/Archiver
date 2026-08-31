const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VAULT_DIR = path.join(__dirname, 'Archive Vault');

/**
 * Computes MD5 hash of a file to ensure exact match before linking
 */
function getFileHash(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Recursively gets all files in a directory
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

function retroactivelyDeduplicate() {
    console.log('🔍 Scanning Archive Vault for redundant copies...');
    
    const allFiles = getAllFiles(VAULT_DIR);
    const hashMap = new Map(); // Store hash -> original file path
    let savedBytes = 0;
    let linkedCount = 0;

    for (const filePath of allFiles) {
        const stat = fs.statSync(filePath);
        const hash = getFileHash(filePath);

        if (hashMap.has(hash)) {
            const originalPath = hashMap.get(hash);

            // Verify they are not already hard-linked (same inode)
            const origStat = fs.statSync(originalPath);
            if (origStat.ino !== stat.ino) {
                // Delete duplicate physical file and hard-link to original
                fs.unlinkSync(filePath);
                fs.linkSync(originalPath, filePath);
                
                savedBytes += stat.size;
                linkedCount++;
                console.log(`🔗 Deduplicated: ${path.relative(VAULT_DIR, filePath)}`);
            }
        } else {
            // First time seeing this exact file version, store as master reference
            hashMap.set(hash, filePath);
        }
    }

    const savedMB = (savedBytes / (1024 * 1024)).toFixed(2);
    console.log(`\n🎉 Retroactive cleanup complete!`);
    console.log(`✨ Replaced ${linkedCount} duplicated files with hard links.`);
    console.log(`💾 Reclaimed ~${savedMB} MB of disk space without deleting any snapshots.`);
}

retroactivelyDeduplicate();