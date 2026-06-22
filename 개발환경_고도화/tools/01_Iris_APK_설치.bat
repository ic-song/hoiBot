@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set IRIS_APK_URL=https://github.com/dolidolih/Iris/releases/latest/download/Iris.apk
set IRIS_APK_MD5_URL=https://github.com/dolidolih/Iris/releases/latest/download/Iris.apk.MD5
set IRIS_REMOTE_APK=/data/local/tmp/Iris.apk
set IRIS_MAIN_CLASS=party.qwer.iris.Main
set TOOL_DIR=%~dp0
set WORK_DIR=%TOOL_DIR%..
set DOWNLOAD_DIR=%WORK_DIR%\downloads
set LOG_DIR=%WORK_DIR%\logs
set LOCAL_APK=%DOWNLOAD_DIR%\Iris.apk
set LOCAL_MD5=%DOWNLOAD_DIR%\Iris.apk.MD5
set INSTALL_LOG=%LOG_DIR%\iris_install_%RANDOM%.log

title hoiBot Iris APK install bootstrap

echo.
echo ============================================================
echo  hoiBot Iris APK install bootstrap
echo ============================================================
echo  This tool is for the operation PC.
echo  It pushes Iris.apk to LDPlayer Android storage.
echo  It does not modify MessengerBot R files or hoiBot JSON data.
echo ============================================================
echo  ADB_EXE         = %ADB_EXE%
echo  LOCAL_APK       = %LOCAL_APK%
echo  IRIS_REMOTE_APK = %IRIS_REMOTE_APK%
echo  LOG             = %INSTALL_LOG%
echo ============================================================
echo.

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" > nul 2>&1
if not exist "%DOWNLOAD_DIR%" mkdir "%DOWNLOAD_DIR%" > nul 2>&1

call :LOG "START Iris APK install bootstrap"

echo [1/7] ADB path check
echo ------------------------------------------------------------
if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
echo [OK] ADB found: %ADB_EXE%
call :LOG "OK ADB found: %ADB_EXE%"
echo.

echo [2/7] Connected device check
echo ------------------------------------------------------------
"%ADB_EXE%" devices
if errorlevel 1 goto FAIL_ADB_DEVICES

set DEVICE_COUNT=0
set TARGET_DEVICE=
for /f "skip=1 tokens=1,2" %%a in ('"%ADB_EXE%" devices') do (
	if "%%b"=="device" (
		set /a DEVICE_COUNT+=1
		set TARGET_DEVICE=%%a
	)
)

if "%DEVICE_COUNT%"=="0" goto FAIL_NO_DEVICE
if not "%DEVICE_COUNT%"=="1" goto FAIL_MULTI_DEVICE

echo [OK] TARGET_DEVICE = %TARGET_DEVICE%
call :LOG "OK TARGET_DEVICE=%TARGET_DEVICE%"
echo.

echo [3/7] Shell access check
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_DEVICE% shell echo ok > "%INSTALL_LOG%.tmp" 2>&1
type "%INSTALL_LOG%.tmp"
type "%INSTALL_LOG%.tmp" >> "%INSTALL_LOG%"
if errorlevel 1 goto FAIL_SHELL
findstr /i /c:"error" /c:"failed" "%INSTALL_LOG%.tmp" > nul 2>&1
if not errorlevel 1 goto FAIL_SHELL
echo [OK] shell access ready
echo.

echo [4/7] Iris.apk local file check
echo ------------------------------------------------------------
if exist "%TOOL_DIR%Iris.apk" (
	copy /y "%TOOL_DIR%Iris.apk" "%LOCAL_APK%" > nul
	echo [OK] Found Iris.apk next to BAT.
) else if exist "%WORK_DIR%\Iris.apk" (
	copy /y "%WORK_DIR%\Iris.apk" "%LOCAL_APK%" > nul
	echo [OK] Found Iris.apk in 개발환경_고도화.
) else if exist "%LOCAL_APK%" (
	echo [OK] Existing downloaded Iris.apk found.
) else (
	echo [INFO] Iris.apk not found locally. Downloading latest release...
	curl.exe -L "%IRIS_APK_URL%" -o "%LOCAL_APK%" >> "%INSTALL_LOG%" 2>&1
	if errorlevel 1 goto FAIL_DOWNLOAD
)

if not exist "%LOCAL_APK%" goto FAIL_APK_MISSING
for %%A in ("%LOCAL_APK%") do set APK_SIZE=%%~zA
if "%APK_SIZE%"=="0" goto FAIL_APK_MISSING
echo [OK] LOCAL_APK = %LOCAL_APK%
echo [OK] APK_SIZE  = %APK_SIZE% bytes
call :LOG "OK LOCAL_APK=%LOCAL_APK% size=%APK_SIZE%"
echo.

echo [5/7] Optional MD5 download/check
echo ------------------------------------------------------------
curl.exe -L "%IRIS_APK_MD5_URL%" -o "%LOCAL_MD5%" >> "%INSTALL_LOG%" 2>&1
if errorlevel 1 (
	echo [WARN] MD5 file download failed. Skipping checksum verification.
	call :LOG "WARN MD5 download failed"
) else (
	for /f "usebackq tokens=1" %%h in ("%LOCAL_MD5%") do set EXPECTED_MD5=%%h
	for /f "tokens=1" %%h in ('certutil -hashfile "%LOCAL_APK%" MD5 ^| findstr /r /v "hash CertUtil"') do set CALCULATED_MD5=%%h
	echo Expected MD5   = !EXPECTED_MD5!
	echo Calculated MD5 = !CALCULATED_MD5!
	if /i not "!EXPECTED_MD5!"=="!CALCULATED_MD5!" goto FAIL_MD5
	echo [OK] MD5 verified
	call :LOG "OK MD5 verified"
)
echo.

echo [6/7] Push Iris.apk to LDPlayer
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_DEVICE% push "%LOCAL_APK%" "%IRIS_REMOTE_APK%" > "%INSTALL_LOG%.tmp" 2>&1
type "%INSTALL_LOG%.tmp"
type "%INSTALL_LOG%.tmp" >> "%INSTALL_LOG%"
if errorlevel 1 goto FAIL_PUSH
findstr /i /c:"error" /c:"failed" "%INSTALL_LOG%.tmp" > nul 2>&1
if not errorlevel 1 goto FAIL_PUSH
echo [OK] push completed
call :LOG "OK pushed to %IRIS_REMOTE_APK%"
echo.

echo [7/7] Verify remote file and root/start readiness
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_DEVICE% shell "ls -l %IRIS_REMOTE_APK%" > "%INSTALL_LOG%.tmp" 2>&1
type "%INSTALL_LOG%.tmp"
type "%INSTALL_LOG%.tmp" >> "%INSTALL_LOG%"
if errorlevel 1 goto FAIL_REMOTE_VERIFY
findstr /i /c:"No such file" /c:"not found" /c:"error" /c:"failed" "%INSTALL_LOG%.tmp" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_VERIFY
echo [OK] remote Iris.apk verified

echo.
echo [INFO] Root check for future Iris start:
"%ADB_EXE%" -s %TARGET_DEVICE% shell "su root -c id" > "%INSTALL_LOG%.tmp" 2>&1
type "%INSTALL_LOG%.tmp"
type "%INSTALL_LOG%.tmp" >> "%INSTALL_LOG%"
findstr /i /c:"uid=0" "%INSTALL_LOG%.tmp" > nul 2>&1
if errorlevel 1 (
	echo [WARN] Root check did not confirm uid=0.
	echo [WARN] Iris start may fail until LDPlayer Root is enabled.
	call :LOG "WARN root check did not confirm uid=0"
) else (
	echo [OK] Root command appears available.
	call :LOG "OK root command available"
)

echo.
echo ============================================================
echo  SUCCESS - Iris.apk install bootstrap completed
echo ============================================================
echo  Remote APK:
echo  %IRIS_REMOTE_APK%
echo.
echo  Next manual start command candidate:
echo  %ADB_EXE% -s %TARGET_DEVICE% shell "su root -c 'app_process -cp %IRIS_REMOTE_APK% / %IRIS_MAIN_CLASS%'"
echo.
echo  Log:
echo  %INSTALL_LOG%
echo ============================================================
pause
exit /b 0

:LOG
echo [%date% %time%] %~1>> "%INSTALL_LOG%"
exit /b 0

:FAIL_ADB_EXE
echo.
echo ============================================================
echo  FAIL - adb.exe not found
echo ============================================================
echo  Expected path:
echo  %ADB_EXE%
echo.
echo  Check LDPlayer install path on the operation PC.
echo ============================================================
pause
exit /b 1

:FAIL_ADB_DEVICES
echo.
echo ============================================================
echo  FAIL - adb devices failed
echo ============================================================
echo  Check LDPlayer and ADB settings.
echo ============================================================
pause
exit /b 1

:FAIL_NO_DEVICE
echo.
echo ============================================================
echo  FAIL - no connected ADB device
echo ============================================================
echo  Start LDPlayer and enable ADB debugging.
echo ============================================================
pause
exit /b 1

:FAIL_MULTI_DEVICE
echo.
echo ============================================================
echo  FAIL - multiple ADB devices found
echo ============================================================
echo  Keep only the operation LDPlayer connected, then retry.
echo ============================================================
pause
exit /b 1

:FAIL_SHELL
echo.
echo ============================================================
echo  FAIL - ADB shell access failed
echo ============================================================
echo  Check LDPlayer state.
echo ============================================================
pause
exit /b 1

:FAIL_DOWNLOAD
echo.
echo ============================================================
echo  FAIL - Iris.apk download failed
echo ============================================================
echo  Download manually from:
echo  https://github.com/dolidolih/Iris/releases
echo  Then place Iris.apk next to this BAT and retry.
echo ============================================================
pause
exit /b 1

:FAIL_APK_MISSING
echo.
echo ============================================================
echo  FAIL - Iris.apk missing or empty
echo ============================================================
echo  Place Iris.apk next to this BAT or allow download access.
echo ============================================================
pause
exit /b 1

:FAIL_MD5
echo.
echo ============================================================
echo  FAIL - MD5 verification failed
echo ============================================================
echo  Delete downloaded Iris.apk and retry.
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - adb push failed
echo ============================================================
echo  Check ADB connection and LDPlayer storage permissions.
echo ============================================================
pause
exit /b 1

:FAIL_REMOTE_VERIFY
echo.
echo ============================================================
echo  FAIL - remote Iris.apk verification failed
echo ============================================================
echo  File was not confirmed at:
echo  %IRIS_REMOTE_APK%
echo ============================================================
pause
exit /b 1
