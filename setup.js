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

const sourceFolders = [];
while (true) {
    const title = sourceFolders.length === 0 ? "Select a SOURCE folder to watch" : "Select ANOTHER SOURCE folder (or click Cancel to finish)";
    const folder = pickFolder(title);
    if (!folder) {
        if (sourceFolders.length === 0) {
            console.log("❌ Cancelled setup. No source folder selected.");
            process.exit(1);
        }
        break;
    }
    sourceFolders.push(folder.replace(/\\/g, '/'));
    console.log(`✔️ Added: ${folder}`);
}

const archiveFolder = pickFolder("Select the TARGET folder for backups");
if (!archiveFolder) { console.log("❌ Cancelled."); process.exit(1); }

const configData = {
    enabled: true,
    source_folders: sourceFolders,
    archive_folder: archiveFolder.replace(/\\/g, '/'),
    watch_extensions: [".xlsx", ".docx", ".pdf", ".txt", ".csv", ".pptx", ".js", ".json"],
    retry_attempts: 3,
    retry_delay_ms: 3000
};

fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(configData, null, 4));
console.log("\n🎉 Success! config.json generated.");

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