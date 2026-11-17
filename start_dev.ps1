# SafeCircle Development Startup Script (Windows PowerShell)
# Launches Django backend (port 8000), escalation worker, and Vite frontend (port 5173).
# Single Ctrl+C cleanly shuts down all background processes.

$ErrorActionPreference = "Continue"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " SafeCircle Emergency Response System - Dev Stack " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Determine script root and subdirectories
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check if nested directory exists
if (Test-Path "$ScriptDir\Community Emergency Response\backend") {
    $BackendDir = "$ScriptDir\Community Emergency Response\backend"
    $FrontendDir = "$ScriptDir\Community Emergency Response\frontend"
} elseif (Test-Path "$ScriptDir\backend") {
    $BackendDir = "$ScriptDir\backend"
    $FrontendDir = "$ScriptDir\frontend"
} else {
    Write-Error "Could not locate backend directory."
    exit 1
}

# Resolve Python executable
$PythonExe = "python"
if (Test-Path "$BackendDir\venv_local\Scripts\python.exe") {
    $PythonExe = "$BackendDir\venv_local\Scripts\python.exe"
} elseif (Test-Path "$BackendDir\venv\Scripts\python.exe") {
    $PythonExe = "$BackendDir\venv\Scripts\python.exe"
}

Write-Host "Using Python: $PythonExe" -ForegroundColor Green
Write-Host "Backend dir:  $BackendDir" -ForegroundColor Green
Write-Host "Frontend dir: $FrontendDir" -ForegroundColor Green

$Processes = @()

try {
    Write-Host "`n[1/3] Starting Django REST Backend on http://localhost:8000..." -ForegroundColor Yellow
    $backendProc = Start-Process -FilePath $PythonExe `
        -ArgumentList "manage.py runserver 8000" `
        -WorkingDirectory $BackendDir `
        -PassThru

    $Processes += $backendProc

    Start-Sleep -Seconds 2

    Write-Host "[2/3] Starting Automated Escalation Worker..." -ForegroundColor Yellow
    $workerProc = Start-Process -FilePath $PythonExe `
        -ArgumentList "manage.py run_escalation_worker" `
        -WorkingDirectory $BackendDir `
        -PassThru

    $Processes += $workerProc

    Write-Host "[3/3] Starting Vite Frontend on http://localhost:5173..." -ForegroundColor Yellow
    $frontendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run dev" `
        -WorkingDirectory $FrontendDir `
        -PassThru

    $Processes += $frontendProc

    Write-Host "`nAll 3 services are active! Press Ctrl+C in this console to terminate all services.`n" -ForegroundColor Green

    # Keep script alive and monitor processes
    while ($true) {
        Start-Sleep -Seconds 2
        foreach ($proc in $Processes) {
            if ($proc.HasExited) {
                Write-Host "Process $($proc.Id) ($($proc.ProcessName)) exited with code $($proc.ExitCode)." -ForegroundColor Yellow
            }
        }
    }
}
finally {
    Write-Host "`nShutting down all SafeCircle services..." -ForegroundColor Red
    foreach ($proc in $Processes) {
        if (-not $proc.HasExited) {
            Write-Host "Stopping process $($proc.Id) ($($proc.ProcessName))..." -ForegroundColor DarkGray
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    # Clean up lingering node / python child processes on port 8000 if needed
    Write-Host "All SafeCircle development services stopped." -ForegroundColor Green
}

