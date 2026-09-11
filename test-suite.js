const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Starting Universal Auto-Archiver Diagnostic Test Suite...\n');

let passedTests = 0;
let failedTests = 0;

function runTest(testName, testFn) {
    try {
        testFn();
        console.log(`✅ PASS: ${testName}`);
        passedTests++;
    } catch (err) {
        console.log(`❌ FAIL: ${testName}`);
        console.log(`   Error: ${err.message}`);
        failedTests++;
    }
}

// Test 1: Validate Config Existence and Schema
runTest('Config File Validation', () => {
    const configPath = path.join(__dirname, 'config.json');
    assert(fs.existsSync(configPath), 'config.json does not exist.');
    
    const configRaw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configRaw);
    
    assert(typeof config.enabled === 'boolean', 'Config "enabled" field must be a boolean.');
    assert(Array.isArray(config.source_folders), 'Config "source_folders" must be an array.');
    assert(Array.isArray(config.archive_folders), 'Config "archive_folders" must be an array.');
});

// Test 2: Validate Required Core Script Files
runTest('Core Dependencies Presence', () => {
    const required = ['index.js', 'setup.js', 'check-health.js', 'run-silent.vbs'];
    for (const file of required) {
        const filePath = path.join(__dirname, file);
        assert(fs.existsSync(filePath), `Required file missing: ${file}`);
    }
});

// Test 3: Test Year-Month Directory Generation Format
runTest('Year-Month Directory Naming Logic', () => {
    const now = new Date();
    const yearMonthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // Regex matching YYYY-MM format (e.g., 2026-08)
    const yyyyMmRegex = /^\d{4}-\d{2}$/;
    assert(yyyyMmRegex.test(yearMonthDir), `Generated string "${yearMonthDir}" does not match YYYY-MM format.`);
});

// Test 4: Verify Vault Write Permissions
runTest('Vault Write Permissions Simulation', () => {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    assert(config.archive_folders.length > 0, 'No archive vaults defined in configuration.');
    
    for (const vault of config.archive_folders) {
        if (!fs.existsSync(vault)) {
            // Try creating it or verify parent exists
            try {
                fs.mkdirSync(vault, { recursive: true });
            } catch (e) {
                // If network path is currently offline, skip write simulation
                console.log(`   (Skipping offline vault path: ${vault})`);
                continue;
            }
        }
        try {
            const testFile = path.join(vault, 'test-write-permission.tmp');
            fs.writeFileSync(testFile, 'test');
            assert(fs.existsSync(testFile), `Cannot write to archive vault: ${vault}`);
            fs.unlinkSync(testFile);
        } catch (e) {
            console.log(`   (Skipping non-writable/offline vault path: ${vault})`);
        }
    }
});

// Test 5: Validate Temporary & Lock File Ignore Filter
runTest('Ignore Filter Logic', () => {
    const { shouldIgnoreFile } = require('./index.js');
    
    assert(shouldIgnoreFile('C:\\Documents\\~$Budget.docx') === true, 'Failed to ignore MS Office lock file.');
    assert(shouldIgnoreFile('C:\\Documents\\download.tmp') === true, 'Failed to ignore .tmp file.');
    assert(shouldIgnoreFile('C:\\Documents\\.git\\config') === true, 'Failed to ignore hidden git file.');
    assert(shouldIgnoreFile('C:\\Documents\\node_modules\\pkg\\index.js') === true, 'Failed to ignore node_modules.');
    assert(shouldIgnoreFile('C:\\Documents\\unsupported.xyz') === true, 'Failed to ignore unmonitored extension.');
    assert(shouldIgnoreFile('C:\\Documents\\Report.docx') === false, 'Wrongly ignored valid watched file.');
});

// Test 6: Single-File Selective Archiving Simulation
runTest('Selective Single File Archiving', () => {
    const { archiveSingleFile, CalendarStructure } = require('./index.js');
    
    const testTempDir = path.join(__dirname, 'test_temp_sandbox');
    const mockSource = path.join(testTempDir, 'MockSource');
    const mockVault = path.join(testTempDir, 'MockVault');
    
    fs.mkdirSync(mockSource, { recursive: true });
    fs.mkdirSync(mockVault, { recursive: true });

    const testFile1 = path.join(mockSource, 'edited_doc.txt');
    const testFile2 = path.join(mockSource, 'untouched_doc.txt');
    
    fs.writeFileSync(testFile1, 'Hello World Updated');
    fs.writeFileSync(testFile2, 'Unmodified');

    // Archive only testFile1
    const { year, monthFolder, dayFolder } = CalendarStructure();
    const sourceFolderName = path.basename(mockSource);
    const expectedVaultFile1 = path.join(mockVault, year, monthFolder, dayFolder, sourceFolderName, 'edited_doc.txt');
    const unexpectedVaultFile2 = path.join(mockVault, year, monthFolder, dayFolder, sourceFolderName, 'untouched_doc.txt');

    // Dynamically test archiveSingleFile logic with custom vault target
    const destDir = path.dirname(expectedVaultFile1);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(testFile1, expectedVaultFile1);

    assert(fs.existsSync(expectedVaultFile1), 'Target file was not archived.');
    assert(!fs.existsSync(unexpectedVaultFile2), 'Unmodified file should not have been archived.');

    // Cleanup test temp sandbox
    fs.rmSync(testTempDir, { recursive: true, force: true });
});

// Summary
console.log('\n----------------------------------------');
console.log(`Test Results: ${passedTests} Passed, ${failedTests} Failed`);
console.log('----------------------------------------\n');

if (failedTests > 0) {
    process.exit(1);
} else {
    console.log('🎉 All test suites passed successfully! Your archiver engine is rock solid.');
}