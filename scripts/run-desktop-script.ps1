[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(ValueFromRemainingArguments)][string[]]$ScriptArguments
)

$ErrorActionPreference = 'Stop'
$scriptExitCode = 1
try {
    # Resolve the CLI only when review or repair starts. Store updates can
    # remove versioned package paths during lengthy validation. Preserve only
    # an explicit user CODEX_EXECUTABLE override in the inherited environment.
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File $ScriptPath @ScriptArguments
    $scriptExitCode = $LASTEXITCODE
}
catch {
    Write-Host $_ -ForegroundColor Red
}
finally {
    Write-Host
    Write-Host 'Press Enter to exit'
    [Console]::ReadLine() | Out-Null
}
exit $scriptExitCode

