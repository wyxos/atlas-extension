function Confirm-UpdateLockRecovery {
    [CmdletBinding()]
    param(
        [int]$UpdateExitCode,
        [switch]$DryRun,
        [switch]$AlreadyRecovered,
        [bool]$Interactive = (-not [Console]::IsInputRedirected),
        [scriptblock]$ReadAnswer = { Read-Host },
        [scriptblock]$RecoverAction = { & (Join-Path $PSScriptRoot 'recover-update-lock.ps1') }
    )

    # Exit 73 belongs to the updater's exclusive-lock conflict, not general failures.
    if ($UpdateExitCode -ne 73 -or $DryRun -or $AlreadyRecovered -or -not $Interactive) {
        return $false
    }

    Write-Host 'Recovery checks for active update/build processes before removing the lock.' -ForegroundColor Yellow
    Write-Host 'Recover interrupted update and retry? [y/N] ' -NoNewline
    $answer = [string](& $ReadAnswer)
    if ($answer.Trim() -notmatch '^(?i:y|yes)$') { return $false }

    & $RecoverAction | Out-Host
    return $true
}
