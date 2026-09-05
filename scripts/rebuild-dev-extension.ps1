[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repositoryRoot 'dist\atlas-extension-v0.1.0'

Push-Location $repositoryRoot
try {
    & npm.cmd run build -- --channel dev --out $destination
    if ($LASTEXITCODE -ne 0) {
        throw "Atlas dev extension build failed with exit code $LASTEXITCODE."
    }

    $marker = Get-Content -LiteralPath (Join-Path $destination 'atlas-desktop-compatibility.json') -Raw | ConvertFrom-Json
    if ($marker.channel -ne 'dev') {
        throw 'The built extension does not declare the dev channel.'
    }

    Write-Host 'Built Atlas Extension Dev for Chrome:' -ForegroundColor Green
    Write-Host $destination
    Write-Host 'Reload Atlas in chrome://extensions to apply the new build.'
}
finally {
    Pop-Location
}
