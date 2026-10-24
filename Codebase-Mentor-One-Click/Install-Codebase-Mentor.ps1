$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = (Resolve-Path $PSScriptRoot).Path
$Backend = Join-Path $Root 'backend'
$Mcp = Join-Path $Root 'mcp'
$BackendEnv = Join-Path $Backend '.env'
$McpEnv = Join-Path $Mcp '.env'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Fail([string]$Message) { throw $Message }
function Invoke-NpmCi([string]$Directory) {
    Push-Location $Directory
    try {
        Write-Host "Installing dependencies in $Directory ..."
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { Fail "Dependency installation failed in $Directory (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
}
function Test-BackendHealth {
    try { return (Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2).ok -eq $true }
    catch { return $false }
}
function Register-CodexMcp([string]$NodeExe) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
    New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
    $ConfigPath = Join-Path $CodexHome 'config.toml'
    $nodeToml = ('"' + $NodeExe.Replace('\','/').Replace('"','\"') + '"')
    $envArg = ('"--env-file-if-exists=' + $McpEnv.Replace('\','/').Replace('"','\"') + '"')
    $entryArg = ('"' + (Join-Path $Mcp 'src/stdio.js').Replace('\','/').Replace('"','\"') + '"')
    $Block = "[mcp_servers.codebase_mentor]`r`ncommand = $nodeToml`r`nargs = [$envArg, $entryArg]`r`nstartup_timeout_sec = 30`r`ntool_timeout_sec = 360`rnenabled = true`r`n"
    $Existing = if (Test-Path $ConfigPath) { Get-Content -Raw -Path $ConfigPath } else { '' }
    $Pattern = '(?ms)^\[mcp_servers\.codebase_mentor\]\r?\n.*?(?=^\[|\z)'
    if ($Existing -match $Pattern) {
        $Updated = [regex]::Replace($Existing, $Pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $Block + "`r`n" }, 1)
    } else {
        $Updated = $Existing.TrimEnd()
        if ($Updated.Length -gt 0) { $Updated += "`r`n`r`n" }
        $Updated += $Block
    }
    if ($Existing -ne $Updated) {
        if (Test-Path $ConfigPath) {
            $Backup = "$ConfigPath.codebase-mentor-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Copy-Item $ConfigPath $Backup -Force
            Write-Host "Existing Codex settings backed up to $Backup"
        }
        Set-Content -Path $ConfigPath -Value $Updated -Encoding utf8
    }
    Write-Host "Codex MCP registered in $ConfigPath" -ForegroundColor Green
}
function Start-LocalBackend([string]$NodeExe) {
    if (Test-BackendHealth) { Write-Host 'Backend is already running.' -ForegroundColor Green; return }
    $DataDir = Join-Path $Backend 'data'
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    $PidFile = Join-Path $DataDir 'backend.pid'
    $StdoutLog = Join-Path $DataDir 'backend.stdout.log'
    $StderrLog = Join-Path $DataDir 'backend.stderr.log'
    $Arguments = '--env-file-if-exists="' + $BackendEnv + '" "src/server.js"'
    $Process = Start-Process -FilePath $NodeExe -ArgumentList $Arguments -WorkingDirectory $Backend -WindowStyle Hidden -PassThru -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog
    Set-Content -Path $PidFile -Value $Process.Id -Encoding ascii
    $Deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $Deadline) {
        if (Test-BackendHealth) { Write-Host 'Codebase Mentor backend is running on http://127.0.0.1:3001' -ForegroundColor Green; return }
        if ($Process.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    $Tail = ''
    if (Test-Path $StderrLog) { $Tail = (Get-Content $StderrLog -Tail 12 -ErrorAction SilentlyContinue) -join "`n" }
    Fail "Backend did not start. See backend/data/backend.stderr.log. $Tail"
}

try {
    Write-Step 'Checking Node.js'
    $NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $NodeCommand) { $NodeCommand = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $NodeCommand) { Fail 'Node.js 24 or newer is required. Install the current Node.js LTS, then double-click this installer again.' }
    $NodeExe = $NodeCommand.Source
    $NodeVersionText = (& $NodeExe --version).Trim().TrimStart('v')
    $NodeVersion = [version]$NodeVersionText
    if ($NodeVersion -lt [version]'24.0') { Fail "Node.js 24 or newer is required. Detected $NodeVersionText. Upgrade Node.js, then double-click this installer again." }
    Write-Host "Using Node.js $NodeVersionText"

    Write-Step 'Preparing local environment files'
    if (-not (Test-Path $BackendEnv)) { Copy-Item (Join-Path $Backend '.env.example') $BackendEnv; Write-Host 'Created backend/.env from its example.' }
    if (-not (Test-Path $McpEnv)) { Copy-Item (Join-Path $Mcp '.env.example') $McpEnv; Write-Host 'Created mcp/.env from its example.' }

    Write-Step 'Installing the required dependencies'
    if (-not (Test-Path (Join-Path $Backend 'node_modules/express')) -or -not (Test-Path (Join-Path $Backend 'node_modules/zod')) -or -not (Test-Path (Join-Path $Backend 'node_modules/tar-stream'))) { Invoke-NpmCi $Backend } else { Write-Host 'Backend dependencies already installed.' }
    if (-not (Test-Path (Join-Path $Mcp 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'))) { Invoke-NpmCi $Mcp } else { Write-Host 'MCP dependencies already installed.' }

    Write-Step 'Connecting Codebase Mentor to Codex'
    Register-CodexMcp $NodeExe

    Write-Step 'Starting the local Codebase Mentor backend'
    Start-LocalBackend $NodeExe

    Write-Host "`nSetup complete." -ForegroundColor Green
    Write-Host 'Next: restart or reload VS Code once so Codex loads the MCP server.'
    Write-Host 'Then open a public GitHub repository and ask Codex a normal codebase question. Codebase Mentor will select the latest snapshot or analyze it on the first tool call.'
    Write-Host 'The existing analyzer supports public GitHub repositories only. Private and purely local repository analysis is not included yet.'
    Write-Host "`nPress Enter to close this window." -ForegroundColor DarkGray
    [void](Read-Host)
} catch {
    Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Fix the prerequisite shown above and run this installer again.'
    Write-Host 'Press Enter to close this window.'
    [void](Read-Host)
    exit 1
}
