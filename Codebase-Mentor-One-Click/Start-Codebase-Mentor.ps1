$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $PSScriptRoot).Path
$Backend = Join-Path $Root 'backend'
$BackendEnv = Join-Path $Backend '.env'
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) { $NodeCommand = Get-Command node -ErrorAction SilentlyContinue }
if (-not $NodeCommand) { throw 'Node.js 24 or newer is required. Run Install-Codebase-Mentor.bat first.' }
$NodeExe = $NodeCommand.Source
$Version = [version]((& $NodeExe --version).Trim().TrimStart('v'))
if ($Version -lt [version]'24.0') { throw "Node.js 24 or newer is required. Detected $Version." }
if (-not (Test-Path (Join-Path $Backend 'node_modules/express'))) { throw 'Dependencies are not installed. Run Install-Codebase-Mentor.bat once.' }
try { if ((Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2).ok) { Write-Host 'Codebase Mentor is already running.' -ForegroundColor Green; Read-Host 'Press Enter to close'; exit 0 } } catch {}
if (-not (Test-Path $BackendEnv)) { Copy-Item (Join-Path $Backend '.env.example') $BackendEnv }
$DataDir = Join-Path $Backend 'data'
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$StdoutLog = Join-Path $DataDir 'backend.stdout.log'
$StderrLog = Join-Path $DataDir 'backend.stderr.log'
$Arguments = '--env-file-if-exists="' + $BackendEnv + '" "src/server.js"'
$Process = Start-Process -FilePath $NodeExe -ArgumentList $Arguments -WorkingDirectory $Backend -WindowStyle Hidden -PassThru -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog
Set-Content -Path (Join-Path $DataDir 'backend.pid') -Value $Process.Id -Encoding ascii
$Deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $Deadline) {
    try { if ((Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2).ok) { Write-Host 'Codebase Mentor backend is ready.' -ForegroundColor Green; Read-Host 'Press Enter to close'; exit 0 } } catch {}
    if ($Process.HasExited) { break }
    Start-Sleep -Milliseconds 500
}
Write-Host 'Backend did not start. See backend/data/backend.stderr.log.' -ForegroundColor Red
Read-Host 'Press Enter to close'
exit 1
