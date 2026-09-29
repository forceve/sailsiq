param(
    [ValidateSet('dev', 'validation', 'production')]
    [string]$Profile = 'production'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'test.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Host/static tests failed.' }
& (Join-Path $PSScriptRoot 'build.ps1') -Profile $Profile
if ($LASTEXITCODE -ne 0) { throw 'ESP-IDF build failed.' }
Write-Host 'All automated checks completed. No device was flashed.'
