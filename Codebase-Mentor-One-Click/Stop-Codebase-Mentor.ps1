$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $PSScriptRoot).Path
$PidFile = Join-Path $Root 'backend/data/backend.pid'
if (-not (Test-Path $PidFile)) {
    Write-Host 'No managed Codebase Mentor PID file found. The backend may have been started by another process.' -ForegroundColor Yellow
    Read-Host 'Press Enter to close'
    exit 0
}
$id = 0
$idText = (Get-Content $PidFile -Raw).Trim()
if (-not [int]::TryParse($idText, [ref]$id)) { Remove-Item $PidFile -Force; throw 'The backend PID file is invalid.' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue
if ($process -and $process.CommandLine -match 'src[\\/]server\.js') {
    Stop-Process -Id $id -Force
    Write-Host 'Codebase Mentor backend stopped.' -ForegroundColor Green
} elseif ($process) {
    Write-Host 'PID no longer belongs to the Codebase Mentor backend; refusing to stop it.' -ForegroundColor Yellow
} else {
    Write-Host 'The backend process was already stopped.' -ForegroundColor Yellow
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Read-Host 'Press Enter to close'
