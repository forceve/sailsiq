param(
    [ValidateSet('dev', 'validation', 'production')]
    [string]$Profile = 'production'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$idfCommand = Get-Command 'idf.py' -ErrorAction SilentlyContinue
if (-not $env:IDF_PATH -or -not $idfCommand) {
    $idfTools = if ($env:SAILBALL_IDF_TOOLS_PATH) { $env:SAILBALL_IDF_TOOLS_PATH } else { 'C:\Espressif\tools' }
    $idfProfile = Get-ChildItem -LiteralPath $idfTools -Filter 'Microsoft.*.PowerShell_profile.ps1' -File -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $idfProfile) { throw "ESP-IDF PowerShell profile not found under $idfTools. Install ESP-IDF with Espressif Installation Manager or set SAILBALL_IDF_TOOLS_PATH." }
    . $idfProfile.FullName
}
$profileBuild = Join-Path $repo (Join-Path 'build' $Profile)
$profileSdkconfig = Join-Path $repo ("sdkconfig.{0}" -f $Profile)
$profileDefaults = Join-Path $repo ("sdkconfig.defaults.{0}" -f $Profile)
if (-not (Test-Path -LiteralPath $profileDefaults -PathType Leaf)) {
    throw "ESP-IDF build profile '$Profile' is missing $profileDefaults."
}
New-Item -ItemType Directory -Force -Path $profileBuild | Out-Null
$oldSdkconfigDefaults = $env:SDKCONFIG_DEFAULTS
$oldPythonUtf8 = $env:PYTHONUTF8
$env:PYTHONUTF8 = '1'
$env:SDKCONFIG_DEFAULTS = @(
    (Join-Path $repo 'sdkconfig.defaults'),
    $profileDefaults
) -join ';'
$idfArgs = @('-B', $profileBuild, '-D', "SDKCONFIG=$profileSdkconfig")
Push-Location $repo
try {
    # Windows PowerShell turns native stderr notes into ErrorRecord objects.
    # IDF/Kconfig notes are not build failures; the native exit code is decisive.
    $ErrorActionPreference = 'Continue'
    idf.py @idfArgs reconfigure
    if ($LASTEXITCODE -ne 0) { throw 'idf.py reconfigure failed.' }
    idf.py @idfArgs build
    if ($LASTEXITCODE -ne 0) { throw 'idf.py build failed.' }
    python (Join-Path $PSScriptRoot 'check_phase_a_config.py') $profileSdkconfig
    if ($LASTEXITCODE -ne 0) { throw 'Phase A configuration gate failed.' }
    python (Join-Path $PSScriptRoot 'check_stack_usage.py') $profileBuild
    if ($LASTEXITCODE -ne 0) { throw 'Compiled stack/frame gate failed.' }
    python (Join-Path $PSScriptRoot 'check_wireless_budget.py') $profileBuild $profileSdkconfig --phase-b
    if ($LASTEXITCODE -ne 0) { throw 'H10-S wireless admission safety gate failed.' }
} finally {
    $ErrorActionPreference = 'Stop'
    Pop-Location
    if ($null -eq $oldSdkconfigDefaults) {
        Remove-Item Env:SDKCONFIG_DEFAULTS -ErrorAction SilentlyContinue
    } else {
        $env:SDKCONFIG_DEFAULTS = $oldSdkconfigDefaults
    }
    if ($null -eq $oldPythonUtf8) {
        Remove-Item Env:PYTHONUTF8 -ErrorAction SilentlyContinue
    } else {
        $env:PYTHONUTF8 = $oldPythonUtf8
    }
}
