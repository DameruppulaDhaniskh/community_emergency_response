$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$EvidenceDir = Join-Path $RepoRoot 'docs\evidence'
$VenvPython = Join-Path $BackendDir 'venv_local\Scripts\python.exe'
$BackendLog = Join-Path $EvidenceDir 'wsgi-stdout.log'
$BackendErr = Join-Path $EvidenceDir 'wsgi-stderr.log'
$FrontendLog = Join-Path $EvidenceDir 'vite-preview-stdout.log'
$FrontendErr = Join-Path $EvidenceDir 'vite-preview-stderr.log'

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

# Local production simulation env vars (HTTPS redirect False because local waitress uses HTTP)
$env:DJANGO_DEBUG = 'False'
$env:SECRET_KEY = 'local-production-check-secret-key-at-least-fifty-characters-long-123456'
$env:ALLOWED_HOSTS = 'localhost,127.0.0.1'
$env:CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:4173,http://localhost:4173'
$env:CSRF_TRUSTED_ORIGINS = 'http://127.0.0.1:4173,http://localhost:4173'
$env:DJANGO_SECURE_SSL_REDIRECT = 'False'
$env:DJANGO_SESSION_COOKIE_SECURE = 'False'
$env:DJANGO_CSRF_COOKIE_SECURE = 'False'
$env:DATABASE_URL = 'postgresql://postgres:dhaniskh%4013@localhost:5432/community_emergency_db_clean?sslmode=disable'

Write-Host '=== Running collectstatic & seed_demo ==='
Push-Location $BackendDir
try {
    & $VenvPython manage.py collectstatic --noinput
    if ($LASTEXITCODE -ne 0) { throw 'collectstatic failed' }
    & $VenvPython manage.py seed_demo
    if ($LASTEXITCODE -ne 0) { throw 'seed_demo failed' }
} finally {
    Pop-Location
}

$wsgiProc = $null
$viteProc = $null

try {
    Write-Host '=== Starting Waitress WSGI server (DEBUG=False) on 127.0.0.1:8000 ==='
    $wsgiProc = Start-Process -FilePath $VenvPython `
        -ArgumentList '-m', 'waitress', '--listen=127.0.0.1:8000', 'config.wsgi:application' `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $BackendLog `
        -RedirectStandardError $BackendErr `
        -PassThru -WindowStyle Hidden

    Write-Host '=== Starting Vite preview server on 127.0.0.1:4173 ==='
    $viteProc = Start-Process -FilePath 'node' `
        -ArgumentList 'node_modules\vite\bin\vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort' `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $FrontendLog `
        -RedirectStandardError $FrontendErr `
        -PassThru -WindowStyle Hidden

    # Wait for both servers to become healthy
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $h = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health/' -UseBasicParsing -TimeoutSec 2
            $f = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/login' -UseBasicParsing -TimeoutSec 2
            if ($h.StatusCode -eq 200 -and $f.StatusCode -eq 200) {
                $ready = $true
                Write-Host "Health check 200 OK: $($h.Content)"
                break
            }
        } catch {
            # keep polling until timeout
        }
    }
    if (-not $ready) {
        throw 'Servers failed to start within 20 seconds'
    }

    # Verify PWA assets served cleanly
    foreach ($asset in @('/manifest.webmanifest', '/sw.js', '/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png')) {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:4173$asset" -UseBasicParsing -TimeoutSec 5
        Write-Host "Asset $asset -> $($resp.StatusCode) ($($resp.RawContentLength) bytes)"
    }

    Write-Host '=== Running End-to-End Puppeteer Verification & Screenshot Capture ==='
    Push-Location $FrontendDir
    try {
        node verify-m3-e2e.mjs
        if ($LASTEXITCODE -ne 0) { throw 'verify-m3-e2e.mjs failed' }
    } finally {
        Pop-Location
    }

    Write-Host '=== Running Lighthouse Audit (Edge headless) ==='
    $env:CHROME_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    $lhOut = Join-Path $EvidenceDir 'lighthouse.json'
    Push-Location $FrontendDir
    try {
        npx -y lighthouse http://127.0.0.1:4173/login --output=json "--output-path=$lhOut" --quiet '--chrome-flags=--headless=new --no-sandbox --disable-gpu'
        if ($LASTEXITCODE -ne 0) { throw 'Lighthouse audit failed' }
    } finally {
        Pop-Location
    }

    Write-Host '=== Production Local Verification & Lighthouse Complete ==='
} finally {
    if ($wsgiProc -and -not $wsgiProc.HasExited) {
        Stop-Process -Id $wsgiProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($viteProc -and -not $viteProc.HasExited) {
        Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
    }
}

