$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

Write-Host '[1/3] Static architecture checks'
python (Join-Path $PSScriptRoot 'check_architecture.py')
if ($LASTEXITCODE -ne 0) { throw 'Static architecture checks failed.' }
python (Join-Path $PSScriptRoot 'check_v1_metadata_reachability.py')
if ($LASTEXITCODE -ne 0) { throw 'Current v1 metadata reachability proof changed.' }

Write-Host '[2/3] Locate Visual Studio C compiler'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Build Tools with the C compiler are required for native host tests.' }
$vsInstall = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vsInstall) { throw 'No Visual Studio C/C++ build tools installation was found.' }
$vsDevCmd = Join-Path $vsInstall 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $vsDevCmd)) { throw 'VsDevCmd.bat is missing from the selected Visual Studio installation.' }

$buildDir = Join-Path $repo 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
$exe = Join-Path $buildDir 'sailball-host-tests.exe'
$batch = Join-Path $buildDir 'sailball-host-tests-build.cmd'
$commonInclude = Join-Path $repo 'components\sailball_common\include'
$ldcInclude = Join-Path $repo 'components\sailball_ldc\include'
$spInclude = Join-Path $repo 'components\sailball_sp\include'
$supervisorInclude = Join-Path $repo 'components\sailball_supervisor\include'
$recorderInclude = Join-Path $repo 'components\sailball_recorder\include'
$testSource = Join-Path $repo 'tests\host\host_tests.c'
$sources = @(
    (Join-Path $repo 'components\sailball_ldc\src\crc32c.c'),
    (Join-Path $repo 'components\sailball_ldc\src\varint.c'),
    (Join-Path $repo 'components\sailball_ldc\src\ldc.c'),
    (Join-Path $repo 'components\sailball_sp\src\sp_frame.c'),
    (Join-Path $repo 'components\sailball_sp\src\cobs.c'),
    (Join-Path $repo 'components\sailball_sp\src\cobs_stream.c'),
    (Join-Path $repo 'components\sailball_sp\src\cbor.c'),
    (Join-Path $repo 'components\sailball_sp\src\permissions.c'),
    (Join-Path $repo 'components\sailball_supervisor\src\progress.c'),
    (Join-Path $repo 'components\sailball_recorder\src\time_grid.c'),
    $testSource
)
$sourceArgs = ($sources | ForEach-Object { '"' + $_ + '"' }) -join ' '
python (Join-Path $PSScriptRoot 'prepare_phase_a_tests.py')
if ($LASTEXITCODE -ne 0) { throw 'Phase A test preparation failed.' }
python (Join-Path $repo 'tests\phase_a\wireless_budget_gate_test.py')
if ($LASTEXITCODE -ne 0) { throw 'Wireless reachability gate tests failed.' }
$batchLines = @(
    '@echo off',
    ('call "' + $vsDevCmd + '" -no_logo -arch=x64 -host_arch=x64'),
    'if errorlevel 1 exit /b %errorlevel%',
    ('cl /nologo /std:c11 /W4 /I"' + $commonInclude + '" /I"' + $ldcInclude + '" /I"' + $spInclude + '" /I"' + $supervisorInclude + '" /I"' + $recorderInclude + '" /Fe:"' + $exe + '" ' + $sourceArgs),
    'if errorlevel 1 exit /b %errorlevel%',
    'exit /b %errorlevel%'
)
$phaseInclude = @(
    (Join-Path $repo 'tests\phase_c\fakes'),
    (Join-Path $repo 'tests\phase_a\fakes'),
    (Join-Path $repo 'build\phase_a_tests')
)
$phaseInclude += Get-ChildItem (Join-Path $repo 'components') -Directory | ForEach-Object { Join-Path $_.FullName 'include' }
$phaseIncludeArgs = ($phaseInclude | ForEach-Object { '/I"' + $_ + '"' }) -join ' '
$nmeaExe = Join-Path $buildDir 'phase-b-nmea.exe'
$nmeaSource = Join-Path $repo 'tests\phase_b\nmea_test.c'
$nmeaParser = Join-Path $repo 'components\sailball_gnss\src\nmea_parser.c'
$nmeaBackend = Join-Path $repo 'components\sailball_gnss\src\atgm336h_backend.c'
$nmeaInclude = Join-Path $repo 'components\sailball_gnss\src'
$gnssStartupExe = Join-Path $buildDir 'phase-c-gnss-startup.exe'
$gnssStartupSource = Join-Path $repo 'tests\phase_c\gnss_startup_test.c'
$gnssFakeUartExe = Join-Path $buildDir 'phase-b-gnss-fake-uart.exe'
$gnssFakeUartSource = Join-Path $repo 'tests\phase_b\gnss_fake_uart_test.c'
$gnssRecorderExe = Join-Path $buildDir 'phase-b-gnss-recorder.exe'
$gnssRecorderSource = Join-Path $repo 'tests\phase_b\gnss_recorder_integration_test.c'
$bleTestExe = Join-Path $buildDir 'phase-b-ble-reassembly.exe'
$bleTestSource = Join-Path $repo 'tests\phase_b\ble_reassembly_test.c'
$bleReassembly = Join-Path $repo 'components\sailball_ble\src\ble_reassembly.c'
$bleInclude = Join-Path $repo 'components\sailball_ble\src'
$bleOwnerExe = Join-Path $buildDir 'phase-b-ble-owner.exe'
$bleOwnerSource = Join-Path $repo 'tests\phase_b\ble_owner_integration_test.c'
$storageTestExe = Join-Path $buildDir 'phase-b-storage-policy.exe'
$storageTestSource = Join-Path $repo 'tests\phase_b\storage_policy_test.c'
$storagePolicy = Join-Path $repo 'components\sailball_storage\src\storage_policy.c'
$storageInclude = Join-Path $repo 'components\sailball_storage\src'
$storageOwnerExe = Join-Path $buildDir 'phase-b-storage-owner.exe'
$storageOwnerSource = Join-Path $repo 'tests\phase_b\storage_owner_integration_test.c'
$threeOwnerExe = Join-Path $buildDir 'phase-b-three-owner-epoch.exe'
$threeOwnerSource = Join-Path $repo 'tests\phase_b\epoch_three_owner_test.c'
$poolCapacityExe = Join-Path $buildDir 'phase-b-recorder-pool-capacity.exe'
$poolCapacitySource = Join-Path $repo 'tests\phase_b\recorder_pool_capacity_test.c'
$congestionCommitExe = Join-Path $buildDir 'phase-b-congestion-storage-commit.exe'
$congestionCommitSource = Join-Path $repo 'tests\phase_b\congestion_storage_commit_test.c'
$congestionBleAdapter = Join-Path $repo 'tests\phase_b\congestion_ble_adapter.c'
$congestionWifiAdapter = Join-Path $repo 'tests\phase_b\congestion_wifi_adapter.c'
$storageFakeInclude = Join-Path $repo 'tests\phase_b\fakes'
$controlTxExe = Join-Path $buildDir 'phase-b-control-tx-policy.exe'
$controlTxSource = Join-Path $repo 'tests\phase_b\control_tx_policy_test.c'
$controlTxPolicy = Join-Path $repo 'components\sailball_control\src\control_tx_policy.c'
$controlSessionExe = Join-Path $buildDir 'phase-b-control-session.exe'
$controlSessionSource = Join-Path $repo 'tests\phase_b\control_session_test.c'
$congestionRecorderExe = Join-Path $buildDir 'phase-b-congestion-recorder.exe'
$congestionRecorderSource = Join-Path $repo 'tests\phase_b\congestion_recorder_integration_test.c'
$quantumExe = Join-Path $buildDir 'phase-b-transport-quantum.exe'
$quantumSource = Join-Path $repo 'tests\phase_b\transport_quantum_test.c'
$wifiTcpExe = Join-Path $buildDir 'phase-b-wifi-tcp-adapter.exe'
$wifiTcpSource = Join-Path $repo 'tests\phase_b\wifi_tcp_adapter_test.c'
$diagnosticsExe = Join-Path $buildDir 'phase-c-diagnostics.exe'
$diagnosticsSource = Join-Path $repo 'tests\phase_c\diagnostics_test.c'
$uiOwnershipExe = Join-Path $buildDir 'phase-c-ui-ownership.exe'
$uiOwnershipSource = Join-Path $repo 'tests\phase_c\ui_ownership_test.c'
$supervisorHealthExe = Join-Path $buildDir 'phase-c-supervisor-health.exe'
$supervisorHealthSource = Join-Path $repo 'tests\phase_c\supervisor_health_test.c'
$systemUiSnapshotExe = Join-Path $buildDir 'phase-c-system-ui-snapshot.exe'
$systemUiSnapshotSource = Join-Path $repo 'tests\phase_c\system_ui_snapshot_test.c'
$recorderSequenceSource = Join-Path $repo 'tests\phase_b\recorder_block_sequence_test.c'
$recorderSequenceExecutables = @()
$phaseExecutables = @()
foreach ($name in @('transfer_race', 'ble_init', 'wifi_init', 'system_startup', 'control_scratch', 'wireless_admission', 'control_sources')) {
    $phaseExe = Join-Path $buildDir ("phase-a-{0}.exe" -f $name)
    $phaseSource = Join-Path $repo ("tests\phase_a\{0}_test.c" -f $name)
    $phaseExecutables += $phaseExe
    $extraSources = if ($name -eq 'control_scratch') { ' "' + (Join-Path $repo 'components\sailball_sp\src\cbor.c') + '"' } else { '' }
    $batchLines = $batchLines[0..($batchLines.Count-2)] + @(
        ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $phaseExe + '" "' + $phaseSource + '"' + $extraSources),
        'if errorlevel 1 exit /b %errorlevel%', 'exit /b %errorlevel%')
}
$nmeaCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $nmeaInclude + '" /Fe:"' + $nmeaExe + '" "' + $nmeaSource + '" "' + $nmeaParser + '" "' + $nmeaBackend + '"')
$gnssStartupCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $nmeaInclude + '" /Fe:"' + $gnssStartupExe + '" "' + $gnssStartupSource + '" "' + $nmeaParser + '" "' + $nmeaBackend + '"')
$gnssFakeUartCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $nmeaInclude + '" /Fe:"' + $gnssFakeUartExe + '" "' + $gnssFakeUartSource + '" "' + $nmeaParser + '" "' + $nmeaBackend + '"')
$gnssRecorderCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $nmeaInclude + '" /Fe:"' + $gnssRecorderExe + '" "' + $gnssRecorderSource + '" "' + $nmeaParser + '" "' + $nmeaBackend + '" "' + (Join-Path $repo 'components\sailball_recorder\src\recorder.c') + '" "' + (Join-Path $repo 'components\sailball_recorder\src\time_grid.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$bleCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $bleInclude + '" /Fe:"' + $bleTestExe + '" "' + $bleTestSource + '" "' + $bleReassembly + '" "' + (Join-Path $repo 'components\sailball_sp\src\sp_frame.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$bleOwnerCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $bleInclude + '" /Fe:"' + $bleOwnerExe + '" "' + $bleOwnerSource + '" "' + $bleReassembly + '" "' + (Join-Path $repo 'components\sailball_sp\src\sp_frame.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cobs.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cobs_stream.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$storageCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $storageInclude + '" /Fe:"' + $storageTestExe + '" "' + $storageTestSource + '" "' + $storagePolicy + '"')
$storageOwnerCompile = ('cl /nologo /std:c11 /W4 /I"' + $storageFakeInclude + '" ' + $phaseIncludeArgs + ' /I"' + $storageInclude + '" /Fe:"' + $storageOwnerExe + '" "' + $storageOwnerSource + '" "' + $storagePolicy + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$threeOwnerCompile = ('cl /nologo /std:c11 /W4 /I"' + $storageFakeInclude + '" ' + $phaseIncludeArgs + ' /I"' + $storageInclude + '" /Fe:"' + $threeOwnerExe + '" "' + $threeOwnerSource + '" "' + $storagePolicy + '" "' + (Join-Path $repo 'components\sailball_recorder\src\time_grid.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$poolCapacityCompile = ('cl /nologo /std:c11 /W4 /DCONFIG_SAILBALL_GNSS_SAMPLE_RATE_NUM=10 /DCONFIG_SAILBALL_GNSS_SAMPLE_RATE_DEN=1 /I"' + $storageFakeInclude + '" ' + $phaseIncludeArgs + ' /I"' + $storageInclude + '" /Fe:"' + $poolCapacityExe + '" "' + $poolCapacitySource + '" "' + $storagePolicy + '" "' + (Join-Path $repo 'components\sailball_recorder\src\time_grid.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$congestionCommitCompile = ('cl /nologo /std:c11 /W4 /I"' + $storageFakeInclude + '" ' + $phaseIncludeArgs + ' /I"' + $storageInclude + '" /I"' + $bleInclude + '" /Fe:"' + $congestionCommitExe + '" "' + $congestionCommitSource + '" "' + $congestionBleAdapter + '" "' + $congestionWifiAdapter + '" "' + $bleReassembly + '" "' + $storagePolicy + '" "' + (Join-Path $repo 'components\sailball_control\src\control_tx_policy.c') + '" "' + (Join-Path $repo 'components\sailball_usb\src\transport_task.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cbor.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\permissions.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\sp_frame.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cobs.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cobs_stream.c') + '" "' + (Join-Path $repo 'components\sailball_recorder\src\time_grid.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$controlTxCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $controlTxExe + '" "' + $controlTxSource + '" "' + $controlTxPolicy + '"')
$controlSessionCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $controlSessionExe + '" "' + $controlSessionSource + '" "' + (Join-Path $repo 'components\sailball_sp\src\cbor.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\permissions.c') + '" "' + $controlTxPolicy + '"')
$congestionRecorderCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $congestionRecorderExe + '" "' + $congestionRecorderSource + '" "' + (Join-Path $repo 'components\sailball_sp\src\cbor.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\permissions.c') + '" "' + $controlTxPolicy + '" "' + (Join-Path $repo 'components\sailball_recorder\src\recorder.c') + '" "' + (Join-Path $repo 'components\sailball_recorder\src\time_grid.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$quantumCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /I"' + $bleInclude + '" /Fe:"' + $quantumExe + '" "' + $quantumSource + '" "' + $bleReassembly + '" "' + (Join-Path $repo 'components\sailball_sp\src\sp_frame.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$wifiTcpCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $wifiTcpExe + '" "' + $wifiTcpSource + '" "' + (Join-Path $repo 'components\sailball_sp\src\cbor.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\sp_frame.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cobs.c') + '" "' + (Join-Path $repo 'components\sailball_sp\src\cobs_stream.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
$diagnosticsCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $diagnosticsExe + '" "' + $diagnosticsSource + '"')
$uiOwnershipCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $uiOwnershipExe + '" "' + $uiOwnershipSource + '"')
$supervisorHealthCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $supervisorHealthExe + '" "' + $supervisorHealthSource + '" "' + (Join-Path $repo 'components\sailball_supervisor\src\progress.c') + '"')
$systemUiSnapshotCompile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /Fe:"' + $systemUiSnapshotExe + '" "' + $systemUiSnapshotSource + '"')
$batchLines = $batchLines[0..($batchLines.Count-2)] + @($nmeaCompile, 'if errorlevel 1 exit /b %errorlevel%', $gnssStartupCompile, 'if errorlevel 1 exit /b %errorlevel%', $gnssFakeUartCompile, 'if errorlevel 1 exit /b %errorlevel%', $gnssRecorderCompile, 'if errorlevel 1 exit /b %errorlevel%', $bleCompile, 'if errorlevel 1 exit /b %errorlevel%', $bleOwnerCompile, 'if errorlevel 1 exit /b %errorlevel%', $storageCompile, 'if errorlevel 1 exit /b %errorlevel%', $storageOwnerCompile, 'if errorlevel 1 exit /b %errorlevel%', $threeOwnerCompile, 'if errorlevel 1 exit /b %errorlevel%', $poolCapacityCompile, 'if errorlevel 1 exit /b %errorlevel%', $congestionCommitCompile, 'if errorlevel 1 exit /b %errorlevel%', $controlTxCompile, 'if errorlevel 1 exit /b %errorlevel%', $controlSessionCompile, 'if errorlevel 1 exit /b %errorlevel%', $congestionRecorderCompile, 'if errorlevel 1 exit /b %errorlevel%', $quantumCompile, 'if errorlevel 1 exit /b %errorlevel%', $wifiTcpCompile, 'if errorlevel 1 exit /b %errorlevel%', $diagnosticsCompile, 'if errorlevel 1 exit /b %errorlevel%', $uiOwnershipCompile, 'if errorlevel 1 exit /b %errorlevel%', $supervisorHealthCompile, 'if errorlevel 1 exit /b %errorlevel%', $systemUiSnapshotCompile, 'if errorlevel 1 exit /b %errorlevel%', 'exit /b %errorlevel%')
foreach ($rate in @(1,3,4,10)) {
    $rateExe = Join-Path $buildDir ("phase-b-recorder-sequence-{0}hz.exe" -f $rate)
    $recorderSequenceExecutables += $rateExe
    $compile = ('cl /nologo /std:c11 /W4 ' + $phaseIncludeArgs + ' /DCONFIG_SAILBALL_GNSS_SAMPLE_RATE_NUM=' + $rate + ' /DCONFIG_SAILBALL_GNSS_SAMPLE_RATE_DEN=1 /Fe:"' + $rateExe + '" "' + $recorderSequenceSource + '" "' + (Join-Path $repo 'components\sailball_recorder\src\time_grid.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\ldc.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\varint.c') + '" "' + (Join-Path $repo 'components\sailball_ldc\src\crc32c.c') + '"')
    $batchLines = $batchLines[0..($batchLines.Count-2)] + @($compile, 'if errorlevel 1 exit /b %errorlevel%', 'exit /b %errorlevel%')
}
Set-Content -LiteralPath $batch -Value $batchLines -Encoding Ascii

Write-Host '[3/3] Build and run native LDC / SP tests'
Push-Location $buildDir
try {
    & $env:ComSpec /d /c $batch
} finally {
    Pop-Location
}
if ($LASTEXITCODE -ne 0) { throw 'Native host test build failed.' }
& $exe
if ($LASTEXITCODE -ne 0) { throw 'Native host tests failed.' }
foreach ($phaseExe in $phaseExecutables) {
    & $phaseExe
    if ($LASTEXITCODE -ne 0) { throw "Phase A test failed: $phaseExe" }
}
& $nmeaExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B NMEA host test failed.' }
& $gnssStartupExe
if ($LASTEXITCODE -ne 0) { throw 'Phase C ATGM GNSS startup state-machine test failed.' }
& $gnssFakeUartExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B GNSS fake-UART integration test failed.' }
& $gnssRecorderExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B GNSS-to-Recorder integration test failed.' }
& $bleTestExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B BLE reassembly host test failed.' }
& $bleOwnerExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B BLE callback/owner integration test failed.' }
& $storageTestExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Storage policy host test failed.' }
& $storageOwnerExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Storage owner integration test failed.' }
& $threeOwnerExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Recorder/Storage/Transfer epoch integration test failed.' }
& $poolCapacityExe
if ($LASTEXITCODE -ne 0) { throw 'Phase 1F three-block Recorder capacity integration test failed.' }
& $congestionCommitExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Control/Transport/Recorder/Storage congestion commit integration test failed.' }
& $controlTxExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Control TX policy test failed.' }
& $controlSessionExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Control session integration test failed.' }
& $congestionRecorderExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B congestion/Recorder integration test failed.' }
& $quantumExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B transport quantum test failed.' }
& $wifiTcpExe
if ($LASTEXITCODE -ne 0) { throw 'Phase B Wi-Fi TCP adapter test failed.' }
& $diagnosticsExe
if ($LASTEXITCODE -ne 0) { throw 'Phase C Diagnostics ownership/semantics test failed.' }
& $uiOwnershipExe
if ($LASTEXITCODE -ne 0) { throw 'Phase C UI ownership test failed.' }
& $supervisorHealthExe
if ($LASTEXITCODE -ne 0) { throw 'Phase C Supervisor health integration test failed.' }
& $systemUiSnapshotExe
if ($LASTEXITCODE -ne 0) { throw 'Phase C System/UI snapshot integration test failed.' }
foreach ($rateExe in $recorderSequenceExecutables) {
    & $rateExe
    if ($LASTEXITCODE -ne 0) { throw "Phase B Recorder/LDC sequence test failed: $rateExe" }
}
$testExecutables = @($exe) + $phaseExecutables + @(
    $nmeaExe, $gnssStartupExe, $gnssFakeUartExe, $gnssRecorderExe, $bleTestExe, $bleOwnerExe,
    $storageTestExe, $storageOwnerExe, $threeOwnerExe, $poolCapacityExe, $congestionCommitExe,
    $controlTxExe, $controlSessionExe, $congestionRecorderExe, $quantumExe,
    $wifiTcpExe, $diagnosticsExe, $uiOwnershipExe, $supervisorHealthExe, $systemUiSnapshotExe
) + $recorderSequenceExecutables
$manifest = [ordered]@{
    result = 'PASS'
    generated_at_utc = [DateTime]::UtcNow.ToString('o')
    test_script_sha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
    build_batch_sha256 = (Get-FileHash -LiteralPath $batch -Algorithm SHA256).Hash
    gate_scripts = @('check_architecture.py','check_v1_metadata_reachability.py','prepare_phase_a_tests.py') | ForEach-Object {
        $gatePath = Join-Path $PSScriptRoot $_
        [ordered]@{ path = 'scripts/' + $_; sha256 = (Get-FileHash -LiteralPath $gatePath -Algorithm SHA256).Hash }
    }
    production_extraction_manifest = 'build/phase_a_tests/extraction_manifest.json'
    executables = @($testExecutables | ForEach-Object {
        [ordered]@{ path = $_.Substring($repo.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash }
    })
    source_inputs = @((Get-ChildItem (Join-Path $repo 'tests') -Recurse -File -Include *.c,*.h,*.py | Sort-Object FullName) | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($repo.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
    production_sources = @((Get-ChildItem (Join-Path $repo 'components') -Recurse -File -Include *.c,*.h | Sort-Object FullName) | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($repo.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $buildDir 'test-artifact-manifest.json') -Encoding UTF8
Write-Host 'PASS test artifact manifest: build/test-artifact-manifest.json'
