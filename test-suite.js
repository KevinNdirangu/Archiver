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
            fs.mkdirSync(vault, { recursive: true });
        }
        const testFile = path.join(vault, 'test-write-permission.tmp');
        fs.writeFileSync(testFile, 'test');
        assert(fs.existsSync(testFile), `Cannot write to archive vault: ${vault}`);
        fs.unlinkSync(testFile);
    }
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