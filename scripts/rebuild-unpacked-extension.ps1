[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repositoryRoot 'dist\atlas-extension-stable-validation'
$previousChannel = $env:CHANNEL

Push-Location $repositoryRoot
try {
    $env:CHANNEL = 'stable'
    & npm.cmd run build -- --out $destination
    if ($LASTEXITCODE -ne 0) {
        throw "Atlas extension build failed with exit code $LASTEXITCODE."
    }

    Write-Host "Built unpacked Atlas extension:" -ForegroundColor Green
    Write-Host $destination
}
finally {
    if ($null -eq $previousChannel) {
        Remove-Item Env:CHANNEL -ErrorAction SilentlyContinue
    }
    else {
        $env:CHANNEL = $previousChannel
    }
    Pop-Location
}
