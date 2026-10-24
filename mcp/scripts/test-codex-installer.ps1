$ErrorActionPreference = 'Stop'
$Installer = Join-Path $PSScriptRoot '../../Install-Codebase-Mentor.ps1'
$Tokens = $null
$ParseErrors = $null
$Ast = [System.Management.Automation.Language.Parser]::ParseFile($Installer, [ref]$Tokens, [ref]$ParseErrors)
if ($ParseErrors.Count) { throw 'Installer has PowerShell syntax errors.' }
foreach ($Name in @('Fail', 'Register-CodexMcp')) {
    $FunctionAst = $Ast.Find({ param($Item) $Item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Item.Name -eq $Name }, $true)
    Invoke-Expression $FunctionAst.Extent.Text
}

$OriginalCodexHome = $env:CODEX_HOME
$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ('mentor-codex-test-' + [guid]::NewGuid().ToString('N'))
$NodeExe = (Get-Command node.exe).Source
$Mcp = Join-Path $TestRoot 'MCP folder with spaces'
$McpEnv = Join-Path $Mcp '.env'
$Fixture = "# Preserve non-ASCII: caf$([char]0x00e9)`nmodel = 'test-model'`n[mcp_servers.other]`ncommand = 'other-server'`n[mcp_servers.codebase_mentor]`ncommand = 'old-mentor'`n"
try {
    $env:CODEX_HOME = $TestRoot
    New-Item -ItemType Directory -Path $TestRoot | Out-Null
    $ConfigPath = Join-Path $TestRoot 'config.toml'
    [IO.File]::WriteAllText($ConfigPath, $Fixture, (New-Object Text.UTF8Encoding($true)))
    $Before = [IO.File]::ReadAllBytes($ConfigPath)
    Register-CodexMcp $NodeExe
    $Bytes = [IO.File]::ReadAllBytes($ConfigPath)
    if ($Bytes[0] -eq 239 -and $Bytes[1] -eq 187 -and $Bytes[2] -eq 191) { throw 'Regression: config still has a UTF-8 BOM.' }
    $Backups = @(Get-ChildItem -LiteralPath $TestRoot -Filter 'config.toml.codebase-mentor-backup-*')
    if ($Backups.Count -ne 1) { throw 'Expected exactly one original-config backup.' }
    $BackupBytes = [IO.File]::ReadAllBytes($Backups[0].FullName)
    if ([Convert]::ToBase64String($BackupBytes) -ne [Convert]::ToBase64String($Before)) { throw 'Backup did not preserve original bytes.' }
    $Text = [IO.File]::ReadAllText($ConfigPath)
    if (-not $Text.Contains("caf$([char]0x00e9)") -or -not $Text.Contains('test-model')) { throw 'Unrelated settings or Unicode were changed.' }
    $Other = (& codex mcp get other --json | Out-String | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $Other.transport.command -ne 'other-server') { throw 'Other MCP server was changed.' }
    $Entry = (& codex mcp get codebase_mentor --json | Out-String | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $Entry.transport.command -ne $NodeExe) { throw 'Wrong MCP command.' }
    if ($Entry.startup_timeout_sec -ne 30 -or $Entry.tool_timeout_sec -ne 360) { throw 'Regression: MCP timeout settings were lost.' }
    if ($Entry.transport.args[0] -ne "--env-file-if-exists=$McpEnv" -or $Entry.transport.args[1] -ne (Join-Path $Mcp 'src/stdio.js')) { throw 'MCP paths with spaces were not preserved.' }
    Register-CodexMcp $NodeExe
    $Entries = (& codex mcp list --json | Out-String | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or @($Entries | Where-Object name -eq 'codebase_mentor').Count -ne 1) { throw 'Repeated installation produced duplicate entries.' }
    Write-Host 'PASS: BOM repair, exact backup, Unicode/settings preservation, CLI registration, timeout limits, spaced paths, and repeated installation.'
} finally {
    $env:CODEX_HOME = $OriginalCodexHome
    # Leave the isolated fixture available for inspection; never touch the real Codex home.
    Write-Host "Isolated test files: $TestRoot"
}
