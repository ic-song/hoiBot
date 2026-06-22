@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion
if not "%HOIBOT_TOOL_LOG_ACTIVE%"=="1" (
	set "HOIBOT_TOOL_LOG_ACTIVE=1"
	set "HOIBOT_TOOL_LOG_DIR=%~dp0logs"
	set "HOIBOT_TOOL_LOG_SCRIPT=%~f0"
	if not exist "%~dp0logs" mkdir "%~dp0logs" > nul 2>&1
	for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "HOIBOT_TOOL_LOG_FILE=%~dp0logs\%~n0_%%t.log"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$script=$env:HOIBOT_TOOL_LOG_SCRIPT; $log=$env:HOIBOT_TOOL_LOG_FILE; cmd /d /c call $script 2>&1 | Tee-Object -FilePath $log; $code=$LASTEXITCODE; $toolDir=Split-Path -Parent $script; $helper=Join-Path $toolDir '_push_tool_log.ps1'; $repoRoot=Resolve-Path (Join-Path $toolDir '..'); if (Test-Path $helper) { & $helper -RepoRoot $repoRoot -LogPath $log -Branch 'feature/prod' }; exit $code"
	exit /b !ERRORLEVEL!
)
setlocal EnableExtensions EnableDelayedExpansion

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set MAIN_DEPLOY=tools\03_main_운영반영.bat
set INFO_DEPLOY=tools\04_info_운영반영.bat

title hoiBot TARGET_DEVICE sync

echo.
echo ============================================================
echo  hoiBot TARGET_DEVICE 동기화
echo ============================================================
echo  현재 ADB에 연결된 LDPlayer 기기명을 찾아
echo  03_main_운영반영.bat / 04_info_운영반영.bat에 반영합니다.
echo ============================================================
echo.

cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [CONFIG]
echo ------------------------------------------------------------
echo  ADB_EXE     = %ADB_EXE%
echo  MAIN_DEPLOY = %MAIN_DEPLOY%
echo  INFO_DEPLOY = %INFO_DEPLOY%
echo ------------------------------------------------------------
echo.

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%MAIN_DEPLOY%" goto FAIL_DEPLOY_FILE
if not exist "%INFO_DEPLOY%" goto FAIL_DEPLOY_FILE

echo [STEP 1/3] ADB devices 확인
echo ------------------------------------------------------------
"%ADB_EXE%" devices
if errorlevel 1 goto FAIL_ADB
echo.

set DEVICE_COUNT=0
set FIRST_DEVICE=

for /f "skip=1 tokens=1,2" %%a in ('"%ADB_EXE%" devices') do (
	if "%%b"=="device" (
		set /a DEVICE_COUNT+=1
		if "!FIRST_DEVICE!"=="" set FIRST_DEVICE=%%a
	)
)

if "%DEVICE_COUNT%"=="0" goto FAIL_NO_DEVICE
if not "%DEVICE_COUNT%"=="1" goto FAIL_MULTI_DEVICE

echo [STEP 2/3] 동기화 대상 확인
echo ------------------------------------------------------------
echo  찾은 TARGET_DEVICE = %FIRST_DEVICE%
echo.

echo [STEP 3/3] 03/04 운영반영 배치파일 업데이트
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$enc = New-Object System.Text.UTF8Encoding($false); $files = @('%MAIN_DEPLOY%', '%INFO_DEPLOY%'); foreach ($file in $files) { $text = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8); $text = [Text.RegularExpressions.Regex]::Replace($text, '(?m)^set TARGET_DEVICE=.*$', 'set TARGET_DEVICE=%FIRST_DEVICE%'); [IO.File]::WriteAllText($file, $text, $enc); Write-Host ('[OK] ' + $file + ' -> set TARGET_DEVICE=%FIRST_DEVICE%'); }"
if errorlevel 1 goto FAIL_UPDATE
echo.

echo ============================================================
echo  SUCCESS - TARGET_DEVICE 동기화 완료
echo ============================================================
echo  이제 tools\03_main_운영반영.bat 또는 tools\04_info_운영반영.bat를 실행하세요.
echo ============================================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ============================================================
echo  FAIL - 프로젝트 폴더 이동 실패
echo ============================================================
echo  BAT 파일 위치가 hoiBot\tools\ 인지 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_ADB_EXE
echo.
echo ============================================================
echo  FAIL - ADB 파일 없음
echo ============================================================
echo  ADB_EXE 경로가 실제 LDPlayer adb.exe 위치와 다릅니다.
echo  ADB_EXE = %ADB_EXE%
echo ============================================================
pause
exit /b 1

:FAIL_DEPLOY_FILE
echo.
echo ============================================================
echo  FAIL - 운영반영 배치파일 없음
echo ============================================================
echo  tools\03_main_운영반영.bat 또는 tools\04_info_운영반영.bat를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_ADB
echo.
echo ============================================================
echo  FAIL - adb devices 실행 실패
echo ============================================================
echo  LDPlayer 실행 상태와 ADB 경로를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_NO_DEVICE
echo.
echo ============================================================
echo  FAIL - 연결된 ADB 기기 없음
echo ============================================================
echo  LDPlayer가 켜져 있는지 확인한 뒤 다시 실행하세요.
echo ============================================================
pause
exit /b 1

:FAIL_MULTI_DEVICE
echo.
echo ============================================================
echo  FAIL - 연결된 ADB 기기가 2개 이상입니다
echo ============================================================
echo  운영 봇이 실행 중인 LDPlayer만 켜고 다시 실행하세요.
echo  잘못된 기기에 운영반영되는 것을 막기 위해 자동 동기화를 중단합니다.
echo ============================================================
pause
exit /b 1

:FAIL_UPDATE
echo.
echo ============================================================
echo  FAIL - TARGET_DEVICE 업데이트 실패
echo ============================================================
echo  배치파일 권한 또는 파일 잠금 상태를 확인하세요.
echo ============================================================
pause
exit /b 1
