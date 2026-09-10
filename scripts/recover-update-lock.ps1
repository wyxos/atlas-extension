[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$lockPath = Join-Path $env:LOCALAPPDATA 'AtlasBuild/update.lock'
if (-not (Test-Path -LiteralPath $lockPath)) { return }
$original = [IO.File]::ReadAllText($lockPath)
$ownerId = 0
if (-not [int]::TryParse($original.Trim(), [ref]$ownerId) -or $ownerId -le 0) {
    throw 'Update lock is unreadable; manual inspection is required.'
}
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
if ($processes.ProcessId -contains $ownerId) {
    throw "Update lock owner PID $ownerId is still running. Close that update before recovery."
}
$buildRoot = [regex]::Escape((Join-Path $env:LOCALAPPDATA 'AtlasBuild'))
$blocking = @($processes | Where-Object {
    $_.ProcessId -ne $PID -and (
        $_.CommandLine -match "$buildRoot[\\/](workspaces|cache)" -or
        $_.CommandLine -match 'smart-rebuild\.mjs|rebuild-and-run-installer\.ps1' -or
        $_.Name -match '^(cargo|rustc|git|link|lld-link|makensis|msiexec|Atlas.*setup)\.exe$' -or
        ($_.Name -match '^(cargo|rustc|node|pwsh|powershell|git|link|lld-link)\.exe$' -and -not $_.CommandLine)
    )
})
if ($blocking.Count) {
    $ids = ($blocking.ProcessId -join ', ')
    throw "Recovery stopped: build/installer processes remain or cannot be inspected (PID $ids)."
}
# Recheck immediately before deletion; never remove a replacement owner's lock.
if ([IO.File]::ReadAllText($lockPath) -cne $original -or (Get-Process -Id $ownerId -ErrorAction SilentlyContinue)) {
    throw 'Update lock changed during inspection. Retry recovery.'
}
Remove-Item -LiteralPath $lockPath
Write-Host 'Recovered interrupted update. Ready to rebuild.' -ForegroundColor Green
