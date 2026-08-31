# ==============================================================================
# Task Registration Script: UniversalAutoArchiver
# ==============================================================================

# Ensure script halts on fatal errors
$ErrorActionPreference = "Stop"

Write-Host "`nInitializing UniversalAutoArchiver Task Registration..." -ForegroundColor Cyan

# 1. Stop any running background instances cleanly
Write-Host "Stopping any existing Node processes..." -ForegroundColor Yellow
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue

# 2. Unregister previous scheduled task if present
Write-Host "Cleaning up old Task Scheduler entries..." -ForegroundColor Yellow
Unregister-ScheduledTask -TaskName 'UniversalAutoArchiver' -Confirm:$false -ErrorAction SilentlyContinue

# 3. Dynamic Directory Resolution (Works when run as a script or pasted into shell)
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir -or -not (Test-Path (Join-Path -Path $ScriptDir -ChildPath 'index.js'))) {
    $ScriptDir = (Get-Location).Path
}

# Set execution path explicitly
Set-Location -Path $ScriptDir
Write-Host "Project Root Directory: $ScriptDir" -ForegroundColor Gray

# Define dependency paths
$VbsPath  = Join-Path -Path $ScriptDir -ChildPath 'run-silent.vbs'
$NodePath = Join-Path -Path $ScriptDir -ChildPath 'index.js'

# 4. Pre-flight Verification
if (-not (Test-Path $VbsPath)) {
    Write-Host "`nERROR: Missing 'run-silent.vbs' in $ScriptDir" -ForegroundColor Red
    Write-Host "-> Ensure run-silent.vbs exists before registering the task." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $NodePath)) {
    Write-Host "`nERROR: Missing 'index.js' in $ScriptDir" -ForegroundColor Red
    Write-Host "-> Ensure index.js exists in the project folder." -ForegroundColor Yellow
    exit 1
}

# 5. Build Task Scheduler Configuration
Write-Host "Building Windows Scheduled Task configuration..." -ForegroundColor Yellow

$Action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$VbsPath`"" `
    -WorkingDirectory "$ScriptDir"

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# 6. Register Task with Windows
try {
    Register-ScheduledTask `
        -TaskName 'UniversalAutoArchiver' `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description 'Runs Universal Archiver and Vault Cleanup seamlessly in background' `
        -Force | Out-Null

    Write-Host "`nTask 'UniversalAutoArchiver' registered successfully!" -ForegroundColor Green
    Write-Host "Background process will launch automatically at Logon." -ForegroundColor Gray
} catch {
    Write-Host "`nFailed to register task: $_" -ForegroundColor Red
    Write-Host "-> Make sure you are running PowerShell as Administrator!" -ForegroundColor Yellow
    exit 1
}

# 7. Initial Bootstrap Run (Spawns it silently in the background right now)
Write-Host "`nLaunching initial background archiver..." -ForegroundColor Cyan
$VbsPath = Join-Path -Path $ScriptDir -ChildPath 'run-silent.vbs'
Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`"" -WorkingDirectory $ScriptDir

Write-Host "`nSetup complete! Your auto-archiver is now live and running in the background." -ForegroundColor Green
Write-Host "You can safely close this terminal window now." -ForegroundColor Yellow