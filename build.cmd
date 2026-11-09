@echo off
setlocal
set "ROOT=D:\PC\dsh\dsh-mobile"
set "JAVA_HOME=%ROOT%\tools\jdk-17"
set "ANDROID_HOME=%ROOT%\android-sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%ROOT%\refer\DSH-Kxxy\android"
if exist gradlew.bat (
  call gradlew.bat %*
) else (
  call "%ROOT%\tools\gradle-8.10.2\bin\gradle.bat" %*
)
exit /b %ERRORLEVEL%
