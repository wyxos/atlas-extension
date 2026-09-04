[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $env:LOCALAPPDATA 'AtlasBuild'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory ('update-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Start-Transcript -LiteralPath $logPath | Out-Null
try {
    $arguments = @((Join-Path $PSScriptRoot 'smart-rebuild.mjs'))
    if ($DryRun) { $arguments += '--dry-run' }
    Push-Location $repositoryRoot
    try {
        & node.exe @arguments
        if ($LASTEXITCODE -ne 0) { throw "Atlas update failed. See $logPath" }
    }
    finally { Pop-Location }
}
finally { Stop-Transcript | Out-Null }
