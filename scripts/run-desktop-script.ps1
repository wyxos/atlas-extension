[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(ValueFromRemainingArguments)][string[]]$ScriptArguments
)

$ErrorActionPreference = 'Stop'
$scriptExitCode = 1
try {
    if (-not $env:CODEX_EXECUTABLE) {
        $npmRoot = (& npm.cmd root -g).Trim()
        $codexPackage = Join-Path $npmRoot '@openai\codex'
        if (Test-Path -LiteralPath $codexPackage) {
            $candidates = @(Get-ChildItem -LiteralPath $codexPackage -Filter codex.exe -Recurse)
            if ($candidates.Count -eq 1) { $env:CODEX_EXECUTABLE = $candidates[0].FullName }
        }
    }
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

