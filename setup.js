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
        console.error(`\n⚠️ PowerShell error: ${err.message}`);
        return null;
    }
}

console.log("🛠️ Universal Auto-Archiver Setup\n");

console.log("📦 Checking and installing dependencies...");
try {
    execSync('npm install', { stdio: 'inherit', cwd: __dirname });
} catch (err) {
    console.error("⚠️ Failed to run npm install automatically. You might need to run it manually.");
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

// Returns true if `candidate` overlaps with any folder in `otherFolders`
// (exact match, candidate is inside other, or other is inside candidate)
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

const configPath = path.join(__dirname, 'config.json');
let existingConfig = {};
let keepExisting = false;

if (fs.existsSync(configPath)) {
    try {
        existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log("ℹ️ Found existing configuration.");
        keepExisting = askYesNo("Existing Configuration", "An existing configuration was found.\n\nDo you want to KEEP your currently watched folders and add to them?\n\n(Click 'No' to clear them and start fresh.)");
        if (!keepExisting) console.log("🗑️ Starting fresh! Old folders cleared.");
    } catch (e) {
        console.error("⚠️ Failed to read existing config.json. Starting fresh.");
    }
}

let sourceFolders = [];
let archiveFolders = [];

if (keepExisting) {
    sourceFolders = existingConfig.source_folders || [];
    if (existingConfig.source_folder && !sourceFolders.includes(existingConfig.source_folder)) {
        sourceFolders.push(existingConfig.source_folder);
    }

    archiveFolders = existingConfig.archive_folders || [];
    if (existingConfig.archive_folder && !archiveFolders.includes(existingConfig.archive_folder)) {
        archiveFolders.push(existingConfig.archive_folder);
    }
}

sourceFolders = [...new Set(sourceFolders)];
archiveFolders = [...new Set(archiveFolders)];

if (sourceFolders.length > 0) {
    console.log(`\nCurrent Source Folders: \n - ${sourceFolders.join('\n - ')}`);
}
while (true) {
    const title = sourceFolders.length === 0 ? "Select a SOURCE folder to watch" : "Select ANOTHER SOURCE folder (or click Cancel to skip/finish)";
    const folder = pickFolder(title);
    if (!folder) {
        if (sourceFolders.length === 0) {
            console.log("❌ Cancelled setup. No source folder selected.");
            process.exit(1);
        }
        break;
    }
    const normalized = folder.replace(/\\/g, '/');
    const conflict = conflictsWithFolders(normalized, archiveFolders);
    if (conflict) {
        console.log(`❌ Conflict! "${folder}" overlaps with an existing target folder ("${conflict}").`);
        console.log(`   This would cause an echo loop. Please pick a different folder.`);
        continue;
    }
    if (!sourceFolders.includes(normalized)) {
        sourceFolders.push(normalized);
        console.log(`✔️ Added Source: ${folder}`);
    } else {
        console.log(`ℹ️ Already watching: ${folder}`);
    }
}

if (archiveFolders.length > 0) {
    console.log(`\nCurrent Target (Archive) Folders: \n - ${archiveFolders.join('\n - ')}`);
}
while (true) {
    const title = archiveFolders.length === 0 ? "Select a TARGET folder for backups" : "Select ANOTHER TARGET folder (or click Cancel to skip/finish)";
    const folder = pickFolder(title);
    if (!folder) {
        if (archiveFolders.length === 0) {
            console.log("❌ Cancelled setup. No target folder selected.");
            process.exit(1);
        }
        break;
    }
    const normalized = folder.replace(/\\/g, '/');
    const conflict = conflictsWithFolders(normalized, sourceFolders);
    if (conflict) {
        console.log(`❌ Conflict! "${folder}" overlaps with a watched source folder ("${conflict}").`);
        console.log(`   This would cause an echo loop. Please pick a different folder.`);
        continue;
    }
    if (!archiveFolders.includes(normalized)) {
        archiveFolders.push(normalized);
        console.log(`✔️ Added Target: ${folder}`);
    } else {
        console.log(`ℹ️ Already targeting: ${folder}`);
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

fs.writeFileSync(configPath, JSON.stringify(configData, null, 4));
console.log("\n🎉 Success! config.json updated.");

console.log("\n⚙️ Registering Task Scheduler to run at Logon...");
try {
    const scriptPath = path.join(__dirname, 'run-silent.vbs');
    const psTaskCmd = `Register-ScheduledTask -TaskName 'UniversalAutoArchiver' -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Action (New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '""${scriptPath}""') -Description 'Runs Archiver in background' -Force`;
    execSync(`powershell -NoProfile -Command "${psTaskCmd}"`, { stdio: 'inherit' });
    console.log("✅ Task Scheduled successfully! It will start automatically when you log on.");
} catch (err) {
    console.error("\n⚠️ Failed to register Scheduled Task automatically. This usually requires Administrator privileges.");
    console.error("Please open PowerShell as Administrator and run the following command:");
    console.error(`Register-ScheduledTask -TaskName 'UniversalAutoArchiver' -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Action (New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '""${path.join(__dirname, 'run-silent.vbs')}""') -Description 'Runs Archiver in background' -Force`);
}

try {
    execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'node.exe'\\" | Where-Object {$_.CommandLine -like '*index.js*'} | Invoke-CimMethod -MethodName Terminate"`, { stdio: 'ignore' });
    console.log("\n🔄 Automatically restarted the background Archiver to apply new folders!");
    execSync(`wscript.exe "${path.join(__dirname, 'run-silent.vbs')}"`);
} catch (err) {
    // If it fails to restart, it's fine
}