const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function pickFolder(dialogTitle) {
    console.log(`\nOpening folder picker: ${dialogTitle}...`);
    const psCommand = `Add-Type -AssemblyName System.windows.forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '${dialogTitle}'; $dialog.ShowNewFolderButton = $true; if($dialog.ShowDialog() -eq 'OK'){ Write-Output $dialog.SelectedPath }`;

    try {
        const result = execSync(`powershell -STA -NoProfile -Command "${psCommand}"`, { encoding: 'utf8' }).trim();
        return result || null;
    } catch (err) {
        console.error(`\n[WARN] PowerShell folder picker error: ${err.message}`);
        return null;
    }
}

function askYesNo(dialogTitle, promptText) {
    const psCommand = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${promptText}', '${dialogTitle}', 'YesNo', 'Question')`;
    try {
        const result = execSync(`powershell -STA -NoProfile -Command "${psCommand}"`, { encoding: 'utf8' }).trim();
        return result === 'Yes';
    } catch (err) {
        return true;
    }
}

function conflictsWithFolders(candidate, otherFolders) {
    const norm = path.resolve(candidate).replace(/\\/g, '/');
    for (const f of otherFolders) {
        const other = path.resolve(f).replace(/\\/g, '/');
        if (norm === other || norm.startsWith(other + '/') || other.startsWith(norm + '/')) {
            return other;
        }
    }
    return null;
}

console.log("\n==========================================");
console.log(" Universal Auto-Archiver Setup");
console.log("==========================================\n");

console.log("[SETUP] Checking and installing dependencies...");
try {
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
} catch (err) {
    console.error("[WARN] Failed to run npm install automatically.");
}

const configPath = path.join(__dirname, 'config.json');
let existingConfig = {};
let keepExisting = false;

if (fs.existsSync(configPath)) {
    try {
        existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log("[INFO] Found existing configuration.");
        keepExisting = askYesNo("Existing Configuration", "An existing configuration was found.\n\nDo you want to KEEP your currently watched folders and add to them?\n\n(Click 'No' to clear them and start fresh.)");
        if (!keepExisting) console.log("[INFO] Starting fresh! Old folders cleared.");
    } catch (e) {
        console.error("[WARN] Failed to read existing config.json. Starting fresh.");
    }
}

let sourceFolders = [];
let archiveFolders = [];

if (keepExisting) {
    sourceFolders = existingConfig.source_folders || existingConfig.sourceFolders || [];
    archiveFolders = existingConfig.archive_folders || existingConfig.targetFolders || [];
}

sourceFolders = [...new Set(sourceFolders)];
archiveFolders = [...new Set(archiveFolders)];

// Select SOURCE Folders
if (sourceFolders.length > 0) {
    console.log(`\nCurrent Source Folders: \n - ${sourceFolders.join('\n - ')}`);
}
while (true) {
    const title = sourceFolders.length === 0 ? "Select a SOURCE folder to watch" : "Select ANOTHER SOURCE folder (or click Cancel to skip/finish)";
    const folder = pickFolder(title);
    if (!folder) {
        if (sourceFolders.length === 0) {
            console.log("[ERROR] Cancelled setup. No source folder selected.");
            process.exit(1);
        }
        break;
    }
    const normalized = folder.replace(/\\/g, '/');
    const conflict = conflictsWithFolders(normalized, archiveFolders);
    if (conflict) {
        console.log(`[ERROR] Conflict! "${folder}" overlaps with target folder ("${conflict}"). Pick a different folder.`);
        continue;
    }
    if (!sourceFolders.includes(normalized)) {
        sourceFolders.push(normalized);
        console.log(`[ADDED] Source: ${folder}`);
    } else {
        console.log(`[INFO] Already watching: ${folder}`);
    }
}

// Select TARGET Folders
if (archiveFolders.length > 0) {
    console.log(`\nCurrent Target (Archive) Folders: \n - ${archiveFolders.join('\n - ')}`);
}
while (true) {
    const title = archiveFolders.length === 0 ? "Select a TARGET folder for backups" : "Select ANOTHER TARGET folder (or click Cancel to skip/finish)";
    const folder = pickFolder(title);
    if (!folder) {
        if (archiveFolders.length === 0) {
            console.log("[ERROR] Cancelled setup. No target folder selected.");
            process.exit(1);
        }
        break;
    }
    const normalized = folder.replace(/\\/g, '/');
    const conflict = conflictsWithFolders(normalized, sourceFolders);
    if (conflict) {
        console.log(`[ERROR] Conflict! "${folder}" overlaps with source folder ("${conflict}"). Pick a different folder.`);
        continue;
    }
    if (!archiveFolders.includes(normalized)) {
        archiveFolders.push(normalized);
        console.log(`[ADDED] Target: ${folder}`);
    } else {
        console.log(`[INFO] Already targeting: ${folder}`);
    }
}

let defaultExtensions = [
    ".xlsx", ".docx", ".pdf", ".txt", ".csv", ".pptx", ".js", ".json",
    ".rtf", ".md", ".doc", ".xls", ".ppt", ".png", ".jpg", ".jpeg", ".html", ".css",
    ".epub", ".mobi", ".azw3"
];

let watchExtensions = existingConfig.watch_extensions 
    ? [...new Set([...existingConfig.watch_extensions, ...defaultExtensions])] 
    : defaultExtensions;

const configData = {
    enabled: true,
    source_folders: sourceFolders,
    archive_folders: archiveFolders,
    watch_extensions: watchExtensions,
    retry_attempts: existingConfig.retry_attempts || 3,
    retry_delay_ms: existingConfig.retry_delay_ms || 3000
};

// Write config.json
fs.writeFileSync(configPath, JSON.stringify(configData, null, 4));
console.log("\n[SUCCESS] config.json created and updated successfully.");

// Handover to register-task.ps1
console.log("\n[SETUP] Handing over to register-task.ps1 to configure the background service...");
try {
    const psScriptPath = path.join(__dirname, 'register-task.ps1');
    execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'inherit' });
} catch (err) {
    console.error("\n[ERROR] Failed to register task automatically.");
    console.error("Please open PowerShell as Administrator and run manually:");
    console.error(`powershell -ExecutionPolicy Bypass -File "${path.join(__dirname, 'register-task.ps1')}"`);
}