[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$builds = [ordered]@{
    dev = 'dist\atlas-extension-v0.1.0'
    stable = 'dist\atlas-extension-stable-validation'
}

Push-Location $repositoryRoot
try {
    foreach ($channel in $builds.Keys) {
        $destination = Join-Path $repositoryRoot $builds[$channel]
        & npm.cmd run build -- --channel $channel --out $destination
        if ($LASTEXITCODE -ne 0) {
            throw "Atlas $channel extension build failed with exit code $LASTEXITCODE."
        }

        $marker = Get-Content -LiteralPath (Join-Path $destination 'atlas-desktop-compatibility.json') -Raw | ConvertFrom-Json
        if ($marker.channel -ne $channel) {
            throw "The built extension does not declare the $channel channel."
        }

        Write-Host "Built Atlas Extension ($channel):" -ForegroundColor Green
        Write-Host $destination
    }
    Write-Host 'Reload each Atlas extension in your browser extensions page to apply the new builds.'
}
finally {
    Pop-Location
}
