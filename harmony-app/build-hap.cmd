@echo off
setlocal
rem DeepSeek Harness HarmonyOS build wrapper.
rem DevEco Studio 26.0.0 + API 26 + hvigor 6.26.9 are installed locally.
set "DEVECO=D:\PC\Huawei\DevEco Studio"
set "DEVECO_SDK_HOME=%DEVECO%\sdk"
set "NODE_HOME=%DEVECO%\tools\node"
set "JAVA_HOME=%DEVECO%\jbr"
set "PATH=%DEVECO%\tools\node;%DEVECO%\tools\hvigor\bin;%DEVECO%\tools\ohpm\bin;%DEVECO%\jbr\bin;%PATH%"

cd /d "%~dp0"

if not exist "oh_modules" (
  echo [dsh] ohpm install...
  call "%DEVECO%\tools\ohpm\bin\ohpm.bat" install
  if errorlevel 1 exit /b %ERRORLEVEL%
)

call "%DEVECO%\tools\hvigor\bin\hvigorw.bat" assembleHap --mode module -p product=default -p buildMode=debug %*
exit /b %ERRORLEVEL%
