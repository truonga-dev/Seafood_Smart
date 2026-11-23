$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:ANDROID_HOME = Join-Path $projectRoot '.android-sdk'
$env:ANDROID_USER_HOME = Join-Path $projectRoot '.android-user'
$env:ANDROID_AVD_HOME = Join-Path $env:ANDROID_USER_HOME 'avd'
$emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
if (-not (Test-Path -LiteralPath $emulator)) { throw 'Android Emulator not found in .android-sdk.' }
& $emulator '@SeafoodSmart_API35' '-no-snapshot' '-no-audio' '-gpu' 'auto'
