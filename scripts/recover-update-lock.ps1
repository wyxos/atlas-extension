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
# An updater child can outlive its parent, and generic helpers need not mention
# Atlas in their arguments. Keep the stale owner as an ancestry root too.
$atlasProcesses = [Collections.Generic.HashSet[int]]::new()
[void]$atlasProcesses.Add($ownerId)
foreach ($process in $processes) {
    if ($process.CommandLine -match "$buildRoot[\\/](workspaces|cache)([\\/]|\b)" -or
        $process.CommandLine -match 'smart-rebuild\.mjs|rebuild-and-run-installer\.ps1' -or
        $process.Name -match '^Atlas.*setup\.exe$') {
        [void]$atlasProcesses.Add([int]$process.ProcessId)
    }
}
do {
    $added = $false
    foreach ($process in $processes) {
        if ($atlasProcesses.Contains([int]$process.ParentProcessId)) {
            if ($atlasProcesses.Add([int]$process.ProcessId)) { $added = $true }
        }
    }
} while ($added)

# Atlas uses NSIS. The system Windows Installer service can stay alive after
# unrelated MSI work, with an unreadable command line under a normal user token.
# Exempt only the service PID attested by SCM, not other opaque MSI processes.
$installerServiceId = 0
if ($processes.Name -contains 'msiexec.exe') {
    try {
        $service = Get-CimInstance Win32_Service -Filter "Name='msiserver'" -ErrorAction Stop
        $systemInstaller = [regex]::Escape((Join-Path $env:SystemRoot 'system32/msiexec.exe').Replace('/', '\'))
        if ($service.Name -eq 'msiserver' -and $service.State -eq 'Running' -and
            $service.StartName -eq 'LocalSystem' -and
            $service.PathName -match "^\s*`"?$systemInstaller`"?\s+/[Vv]\s*$") {
            $serviceProcess = $processes | Where-Object {
                $_.ProcessId -eq $service.ProcessId -and $_.Name -eq 'msiexec.exe' -and $_.SessionId -eq 0
            } | Select-Object -First 1
            $parent = $processes | Where-Object {
                $_.ProcessId -eq $serviceProcess.ParentProcessId -and $_.Name -eq 'services.exe' -and $_.SessionId -eq 0
            } | Select-Object -First 1
            if ($serviceProcess -and $parent) { $installerServiceId = [int]$serviceProcess.ProcessId }
        }
    }
    catch { $installerServiceId = 0 } # Uncertain service ownership remains blocked.
}

# Git read operations from editors/agents do not represent an active build. Keep
# an explicit command allowlist; mutations, unrecognized arguments, opaque Git
# processes and any Atlas descendant still block recovery.
$gitExecutable = '^(?:"(?:[^"\r\n]*[\\/])?git(?:\.exe)?"|(?:[^\s"]*[\\/])?git(?:\.exe)?)\s+'
$gitOptions = '(?:(?:--no-optional-locks|--no-pager|--literal-pathspecs)\s+|-c\s+(?:"[^"\r\n]+"|[^\s"]+)\s+)*'
$gitRead = $gitExecutable + $gitOptions + '(?:status|log|rev-parse|for-each-ref|show-ref|ls-files|ls-tree)(?:\s|$)'
$blocking = @($processes | Where-Object {
    if ($_.ProcessId -eq $PID) { return $false }
    if ($atlasProcesses.Contains([int]$_.ProcessId)) { return $true }
    if ($_.ProcessId -eq $installerServiceId) { return $false }
    if ($_.Name -eq 'git.exe' -and $_.CommandLine -match $gitRead -and
        $_.CommandLine -notmatch '(?:^|[\s"])--output(?:=|[\s"]|$)') { return $false }
    $_.Name -match '^(cargo|rustc|git|link|lld-link|makensis|msiexec)\.exe$' -or
        ($_.Name -match '^(node|pwsh|powershell)\.exe$' -and -not $_.CommandLine)
})
if ($blocking.Count) {
    $details = ($blocking | ForEach-Object {
        $reason = if ($atlasProcesses.Contains([int]$_.ProcessId)) { 'Atlas update' }
            elseif (-not $_.CommandLine) { 'process details unavailable' } else { 'build/installer tool' }
        "PID $($_.ProcessId) $($_.Name) ($reason)"
    }) -join ', '
    throw "Recovery stopped: build/installer processes remain or cannot be inspected ($details)."
}
# Recheck immediately before deletion; never remove a replacement owner's lock.
if ([IO.File]::ReadAllText($lockPath) -cne $original -or (Get-Process -Id $ownerId -ErrorAction SilentlyContinue)) {
    throw 'Update lock changed during inspection. Retry recovery.'
}
Remove-Item -LiteralPath $lockPath
Write-Host 'Recovered interrupted update. Ready to rebuild.' -ForegroundColor Green
