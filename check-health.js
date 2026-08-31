const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Running Universal Auto-Archiver Health Check...\n');

let hasErrors = false;

// 1. Check Config File
const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
    console.log('✅ config.json: Found');
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log(`   - Status: ${config.enabled ? 'Enabled' : 'Disabled'}`);
        console.log(`   - Sources Monitored: ${config.source_folders ? config.source_folders.length : 0}`);
        console.log(`   - Archive Vaults: ${config.archive_folders ? config.archive_folders.length : 0}`);
        
        // Verify source paths exist
        if (config.source_folders) {
            config.source_folders.forEach(folder => {
                if (fs.existsSync(folder)) {
                    console.log(`     ✔️ Source exists: ${folder}`);
                } else {
                    console.log(`     ❌ Source missing/unreachable: ${folder}`);
                    hasErrors = true;
                }
            });
        }
        
        // Verify archive paths exist
        if (config.archive_folders) {
            config.archive_folders.forEach(folder => {
                if (fs.existsSync(folder)) {
                    console.log(`     ✔️ Vault exists: ${folder}`);
                } else {
                    console.log(`     ❌ Vault missing/unreachable: ${folder}`);
                    hasErrors = true;
                }
            });
        }
    } catch (e) {
        console.log('   ❌ config.json is corrupted or invalid JSON.');
        hasErrors = true;
    }
} else {
    console.log('❌ config.json: Missing (Run `npm run setup`)');
    hasErrors = true;
}

// 2. Check Core Dependencies
const requiredFiles = ['index.js', 'setup.js', 'run-silent.vbs'];
requiredFiles.forEach(file => {
    if (fs.existsSync(path.join(__dirname, file))) {
        console.log(`✅ ${file}: Present`);
    } else {
        console.log(`❌ ${file}: Missing`);
        hasErrors = true;
    }
});

// 3. Check Windows Scheduled Task Status
try {
    const taskOutput = execSync('schtasks /query /tn "UniversalAutoArchiver" /fo CSV', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    if (taskOutput.includes('UniversalAutoArchiver')) {
        console.log('✅ Windows Task Scheduler: Task "UniversalAutoArchiver" is registered.');
    } else {
        console.log('⚠️ Windows Task Scheduler: Task not found. Run `register-task.ps1`.');
    }
} catch (e) {
    console.log('⚠️ Windows Task Scheduler: Could not verify task (Are you running outside of Windows or without permissions?)');
}

// 4. Summary
console.log('\n----------------------------------------');
if (hasErrors) {
    console.log('⚠️ Health check completed with warnings/errors. Review items above.');
} else {
    console.log('🎉 All systems operational! Archiver is fully healthy.');
}
console.log('----------------------------------------\n');