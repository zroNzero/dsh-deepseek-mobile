$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$proxy = 'http://127.0.0.1:60744'
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17.0.1'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

$root = 'D:\PC\dsh\dsh-mobile\android-sdk'
$tools = 'D:\PC\dsh\dsh-mobile\tools'
New-Item -ItemType Directory -Force $root, $tools | Out-Null

Write-Output "== [1/4] commandline-tools =="
$sm = Join-Path $root 'cmdline-tools\latest\bin\sdkmanager.bat'
$zip = Join-Path $tools 'cmdline-tools.zip'
if (-not (Test-Path $sm)) {
  if (-not (Test-Path $zip) -or (Get-Item $zip).Length -lt 100MB) {
    curl.exe -L --retry 3 --retry-delay 2 -x $proxy -o $zip 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
    if ($LASTEXITCODE -ne 0) { throw "cmdline-tools download failed: $LASTEXITCODE" }
  }
  Write-Output "zip size: $((Get-Item $zip).Length)"
  $tmp = Join-Path $tools 'cmdline-tools-extract'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $destRoot = Join-Path $root 'cmdline-tools'
  New-Item -ItemType Directory -Force $destRoot | Out-Null
  if (Test-Path (Join-Path $destRoot 'latest')) { Remove-Item (Join-Path $destRoot 'latest') -Recurse -Force }
  Move-Item (Join-Path $tmp 'cmdline-tools') (Join-Path $destRoot 'latest') -Force
  Remove-Item $tmp -Recurse -Force
}
if (-not (Test-Path $sm)) { throw 'sdkmanager.bat missing after extraction' }
Write-Output "sdkmanager: $sm"

Write-Output "== [2/4] gradle 8.10.2 =="
$gradleHome = Join-Path $tools 'gradle-8.10.2'
if (-not (Test-Path (Join-Path $gradleHome 'bin\gradle.bat'))) {
  $gzip = Join-Path $tools 'gradle-8.10.2-bin.zip'
  if (-not (Test-Path $gzip) -or (Get-Item $gzip).Length -lt 100MB) {
    curl.exe -L --retry 3 --retry-delay 2 -x $proxy -o $gzip 'https://services.gradle.org/distributions/gradle-8.10.2-bin.zip'
    if ($LASTEXITCODE -ne 0) { throw "gradle download failed: $LASTEXITCODE" }
  }
  Write-Output "zip size: $((Get-Item $gzip).Length)"
  Expand-Archive -Path $gzip -DestinationPath $tools -Force
}
if (-not (Test-Path (Join-Path $gradleHome 'bin\gradle.bat'))) { throw 'gradle not extracted' }
Write-Output "gradle: $gradleHome"

Write-Output "== [3/4] licenses =="
$licDir = Join-Path $root 'licenses'
New-Item -ItemType Directory -Force $licDir | Out-Null
Set-Content -Path (Join-Path $licDir 'android-sdk-license') -Value "8933bad161af4178b1185d1a37fbf41ea5269c55`n24333f8a63b6825ea9c5514f83c2829b004d1fee`nd56f5187479451eabf01fb78af6dfcb131a6481e" -Encoding ascii
Set-Content -Path (Join-Path $licDir 'android-sdk-preview-license') -Value "84831b9409646a918e30573bab4c9c91346d8abd" -Encoding ascii
$env:JAVA_OPTS = "-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=60744 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=60744 -Djava.net.useSystemProxies=true"
1..100 | ForEach-Object { 'y' } | & $sm --sdk_root=$root --licenses 2>&1 | Select-Object -Last 20

Write-Output "== [4/4] sdk packages =="
& $sm --sdk_root=$root 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0' 2>&1 | Select-Object -Last 40
if ($LASTEXITCODE -ne 0) { throw "sdkmanager install failed: $LASTEXITCODE" }

Write-Output "== verify =="
Get-ChildItem $root | Select-Object Name
Test-Path (Join-Path $root 'platforms\android-34\android.jar')
Test-Path (Join-Path $root 'build-tools\34.0.0\aapt2.exe')
Write-Output "SETUP OK"
