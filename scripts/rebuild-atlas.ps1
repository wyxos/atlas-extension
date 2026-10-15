[CmdletBinding()]
param([switch]$DryRun, [switch]$SkipUncommitted, [switch]$RecoverLock)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $env:LOCALAPPDATA 'AtlasBuild'
$logPath = Join-Path $logDirectory 'update-latest.log'
$transcribing = $false
$scriptExitCode = 0
try {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    try { Start-Transcript -LiteralPath $logPath -Force | Out-Null }
    catch {
        # Another launch can still own the summary while we offer lock recovery.
        # Never truncate its transcript or let that handle suppress the prompt.
        $logPath = Join-Path $logDirectory "update-$PID-$([guid]::NewGuid().ToString('N')).log"
        Start-Transcript -LiteralPath $logPath -NoClobber | Out-Null
        Write-Host "Summary log for this launch: $logPath" -ForegroundColor Yellow
    }
    $transcribing = $true
    . (Join-Path $PSScriptRoot 'update-lock-prompt.ps1')
    if ($RecoverLock -and -not $DryRun) { & (Join-Path $PSScriptRoot 'recover-update-lock.ps1') }
    $arguments = @((Join-Path $PSScriptRoot 'smart-rebuild.mjs'))
    if ($DryRun) { $arguments += '--dry-run' }
    if ($SkipUncommitted) { $arguments += '--skip-uncommitted' }
    Push-Location $repositoryRoot
    try {
        & node.exe @arguments
        if (Confirm-UpdateLockRecovery -UpdateExitCode $LASTEXITCODE -DryRun:$DryRun -AlreadyRecovered:$RecoverLock) {
            & node.exe @arguments
        }
        if ($LASTEXITCODE -ne 0) { $scriptExitCode = $LASTEXITCODE }
    }
    finally { Pop-Location }
}
catch {
    Write-Host "Stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Summary log: $logPath"
    $scriptExitCode = 1
}
finally { if ($transcribing) { Stop-Transcript | Out-Null } }
exit $scriptExitCode
