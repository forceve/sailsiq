$sailballIdfTools = if ($env:SAILBALL_IDF_TOOLS_PATH) { $env:SAILBALL_IDF_TOOLS_PATH } else { 'C:\Espressif\tools' }
$sailballIdfProfile = Get-ChildItem -LiteralPath $sailballIdfTools -Filter 'Microsoft.*.PowerShell_profile.ps1' -File -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $sailballIdfProfile) { throw "ESP-IDF PowerShell profile not found under $sailballIdfTools." }
. $sailballIdfProfile.FullName
Set-Location (Split-Path -Parent $PSScriptRoot)
