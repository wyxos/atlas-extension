[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(ValueFromRemainingArguments)][string[]]$ScriptArguments
)

$ErrorActionPreference = 'Stop'
$scriptExitCode = 1
try {
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @ScriptArguments
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
