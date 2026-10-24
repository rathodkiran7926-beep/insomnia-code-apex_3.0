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
    $CodexCommand = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $CodexCommand) { Fail 'Codex CLI is required. Install it and ensure codex is on PATH, then rerun this installer.' }
    $CodexConfigRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
    $ConfigPath = Join-Path $CodexConfigRoot 'config.toml'
    if (Test-Path -LiteralPath $ConfigPath) {
        $Backup = "$ConfigPath.codebase-mentor-backup-$([guid]::NewGuid().ToString('N'))"
        Copy-Item -LiteralPath $ConfigPath -Destination $Backup
        Write-Host "Existing Codex settings backed up to $Backup"
        # Windows PowerShell 5.1's Set-Content -Encoding utf8 added a BOM.
        # Remove only those three bytes; leave TOML parsing/writing to Codex.
        $Bytes = [IO.File]::ReadAllBytes($ConfigPath)
        if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 239 -and $Bytes[1] -eq 187 -and $Bytes[2] -eq 191) {
            $WithoutBom = New-Object byte[] ($Bytes.Length - 3)
            [Array]::Copy($Bytes, 3, $WithoutBom, 0, $WithoutBom.Length)
            [IO.File]::WriteAllBytes($ConfigPath, $WithoutBom)
            Write-Host 'Removed the UTF-8 BOM from the existing Codex config.'
        }
    }
    & $CodexCommand mcp add codebase_mentor -- $NodeExe "--env-file-if-exists=$McpEnv" (Join-Path $Mcp 'src/stdio.js')
    if ($LASTEXITCODE -ne 0) { Fail "Codex MCP registration failed (exit $LASTEXITCODE). Existing settings were backed up if present; check the Codex error above." }
    $EntryJson = & $CodexCommand mcp get codebase_mentor --json
    if ($LASTEXITCODE -ne 0) { Fail 'Codex could not read the registered MCP server.' }
    $Entry = ($EntryJson | Out-String | ConvertFrom-Json)
    # The CLI has no timeout flags. Add only missing limits to its generated table.
    $TimeoutLines = @()
    if ($null -eq $Entry.startup_timeout_sec) { $TimeoutLines += 'startup_timeout_sec = 30' }
    if ($null -eq $Entry.tool_timeout_sec) { $TimeoutLines += 'tool_timeout_sec = 360' }
    if ($TimeoutLines.Count) {
        $Lines = New-Object 'System.Collections.Generic.List[string]'
        $Lines.AddRange([IO.File]::ReadAllLines($ConfigPath))
        $HeaderIndex = $Lines.IndexOf('[mcp_servers.codebase_mentor]')
        if ($HeaderIndex -lt 0) { Fail 'Unexpected Codex config layout; timeout settings were not changed.' }
        $Lines.InsertRange($HeaderIndex + 1, [string[]]$TimeoutLines)
        [IO.File]::WriteAllLines($ConfigPath, $Lines, (New-Object Text.UTF8Encoding($false)))
    }
    $VerifiedJson = & $CodexCommand mcp get codebase_mentor --json
    if ($LASTEXITCODE -ne 0) { Fail 'Codex rejected the final MCP configuration; restore the backup above.' }
    $Verified = ($VerifiedJson | Out-String | ConvertFrom-Json)
    if ($null -eq $Verified.startup_timeout_sec -or $null -eq $Verified.tool_timeout_sec) { Fail 'Codex MCP timeout settings could not be verified.' }
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
