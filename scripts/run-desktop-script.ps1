[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(ValueFromRemainingArguments)][string[]]$ScriptArguments
)

$ErrorActionPreference = 'Stop'
$scriptExitCode = 1
try {
    if (-not $env:CODEX_EXECUTABLE) {
        # Prefer the Codex desktop app's own CLI; it updates with the app and
        # supports the models the app configures. The npm CLI is a fallback.
        $codexApp = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue |
            Sort-Object Version -Descending | Select-Object -First 1
        if ($codexApp) {
            $bundled = Join-Path $codexApp.InstallLocation 'app\resources\codex.exe'
            if (Test-Path -LiteralPath $bundled) { $env:CODEX_EXECUTABLE = $bundled }
        }
    }
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

