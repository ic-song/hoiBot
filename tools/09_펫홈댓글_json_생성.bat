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
set TARGET_ADB_DEVICE=auto
set REMOTE_DATA_DIR=/storage/emulated/0/호이랜드
set REMOTE_COMMENT_FILE=/storage/emulated/0/호이랜드/petHomeComments.json
set LOCAL_COMMENT_FILE=data\petHomeComments.json
set CREATE_LOG=%TEMP%\hoibot_pet_home_comments_create_%RANDOM%.log

title hoiBot petHomeComments.json create

echo.
echo ============================================================
echo  hoiBot 펫홈 댓글 JSON 생성
echo ============================================================
echo  LDPlayer 안의 펫홈 댓글 데이터 파일을 확인하고,
echo  없을 때만 초기 petHomeComments.json을 생성합니다.
echo  이미 파일이 있으면 덮어쓰지 않습니다.
echo ============================================================
echo.

cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [CONFIG]
echo ------------------------------------------------------------
echo  ADB_EXE             = %ADB_EXE%
echo  TARGET_ADB_DEVICE   = %TARGET_ADB_DEVICE%
echo  REMOTE_DATA_DIR     = %REMOTE_DATA_DIR%
echo  REMOTE_COMMENT_FILE = %REMOTE_COMMENT_FILE%
echo  LOCAL_COMMENT_FILE  = %LOCAL_COMMENT_FILE%
if defined HOIBOT_TOOL_LOG_FILE echo  TOOL_LOG_FILE       = %HOIBOT_TOOL_LOG_FILE%
echo ------------------------------------------------------------
echo.

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%LOCAL_COMMENT_FILE%" goto FAIL_LOCAL_COMMENT_FILE

echo [1/5] 로컬 JSON 검증
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$text = [IO.File]::ReadAllText('%LOCAL_COMMENT_FILE%', [Text.Encoding]::UTF8); $json = $text | ConvertFrom-Json; if ($null -eq $json.comments) { exit 1 }; Write-Host '[OK] local petHomeComments.json valid'"
if errorlevel 1 goto FAIL_LOCAL_JSON
echo.

echo [2/5] ADB devices 확인
echo ------------------------------------------------------------
"%ADB_EXE%" devices
if errorlevel 1 goto FAIL_ADB
echo.

if /i "%TARGET_ADB_DEVICE%"=="auto" (
	set DEVICE_COUNT=0
	set FIRST_DEVICE=
	for /f "skip=1 tokens=1,2" %%a in ('"%ADB_EXE%" devices') do (
		if "%%b"=="device" (
			set /a DEVICE_COUNT+=1
			if "!FIRST_DEVICE!"=="" set FIRST_DEVICE=%%a
		)
	)
	if "!DEVICE_COUNT!"=="0" goto FAIL_NO_DEVICE
	if not "!DEVICE_COUNT!"=="1" goto FAIL_MULTI_DEVICE
	set TARGET_ADB_DEVICE=!FIRST_DEVICE!
)
echo [OK] TARGET_ADB_DEVICE = %TARGET_ADB_DEVICE%
echo.

echo [3/5] 원격 데이터 폴더 준비
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "mkdir -p '%REMOTE_DATA_DIR%'" > "%CREATE_LOG%" 2>&1
type "%CREATE_LOG%"
if errorlevel 1 goto FAIL_REMOTE_DIR
echo.

echo [4/5] 원격 petHomeComments.json 존재 여부 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "if [ -f '%REMOTE_COMMENT_FILE%' ]; then echo EXISTS; else echo MISSING; fi" > "%CREATE_LOG%" 2>&1
type "%CREATE_LOG%"
if errorlevel 1 goto FAIL_REMOTE_CHECK
findstr /c:"EXISTS" "%CREATE_LOG%" > nul 2>&1
if not errorlevel 1 goto SKIP_EXISTS
findstr /c:"MISSING" "%CREATE_LOG%" > nul 2>&1
if errorlevel 1 goto FAIL_REMOTE_CHECK
echo.

echo [5/5] 초기 JSON 업로드
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_ADB_DEVICE% push "%LOCAL_COMMENT_FILE%" "%REMOTE_COMMENT_FILE%" > "%CREATE_LOG%" 2>&1
type "%CREATE_LOG%"
if errorlevel 1 goto FAIL_PUSH

"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "ls -l '%REMOTE_COMMENT_FILE%'" > "%CREATE_LOG%" 2>&1
type "%CREATE_LOG%"
if errorlevel 1 goto FAIL_VERIFY

echo.
echo ============================================================
echo  SUCCESS - petHomeComments.json 생성 완료
echo ============================================================
echo  생성 경로: %REMOTE_COMMENT_FILE%
echo  이후 봇에서 /데이터정리 를 실행하면 기존 펫홈 댓글을 이 파일로 옮깁니다.
echo ============================================================
pause
exit /b 0

:SKIP_EXISTS
echo.
echo ============================================================
echo  SKIP - 이미 petHomeComments.json이 있습니다
echo ============================================================
echo  기존 댓글 데이터 보호를 위해 덮어쓰지 않았습니다.
echo  경로: %REMOTE_COMMENT_FILE%
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

:FAIL_LOCAL_COMMENT_FILE
echo.
echo ============================================================
echo  FAIL - 로컬 petHomeComments.json 없음
echo ============================================================
echo  로컬 파일을 확인하세요: %LOCAL_COMMENT_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_LOCAL_JSON
echo.
echo ============================================================
echo  FAIL - 로컬 petHomeComments.json 형식 오류
echo ============================================================
echo  초기 형식은 {"comments":{}} 이어야 합니다.
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
echo  잘못된 기기에 파일을 생성하는 것을 막기 위해 중단합니다.
echo ============================================================
pause
exit /b 1

:FAIL_REMOTE_DIR
echo.
echo ============================================================
echo  FAIL - 원격 데이터 폴더 준비 실패
echo ============================================================
echo  경로: %REMOTE_DATA_DIR%
echo ============================================================
pause
exit /b 1

:FAIL_REMOTE_CHECK
echo.
echo ============================================================
echo  FAIL - 원격 파일 확인 실패
echo ============================================================
echo  경로: %REMOTE_COMMENT_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - 초기 JSON 업로드 실패
echo ============================================================
echo  경로: %REMOTE_COMMENT_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_VERIFY
echo.
echo ============================================================
echo  FAIL - 업로드 후 파일 확인 실패
echo ============================================================
echo  경로: %REMOTE_COMMENT_FILE%
echo ============================================================
pause
exit /b 1
