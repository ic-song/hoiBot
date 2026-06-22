@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion
if not "%HOIBOT_TOOL_LOG_ACTIVE%"=="1" (
	set "HOIBOT_TOOL_LOG_ACTIVE=1"
	set "HOIBOT_TOOL_LOG_DIR=%~dp0logs"
	set "HOIBOT_TOOL_LOG_SCRIPT=%~f0"
	if not exist "%~dp0logs" mkdir "%~dp0logs" > nul 2>&1
	for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "HOIBOT_TOOL_LOG_FILE=%~dp0logs\%~n0_%%t.log"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$script=$env:HOIBOT_TOOL_LOG_SCRIPT; $log=$env:HOIBOT_TOOL_LOG_FILE; cmd /d /c call $script 2>&1 | Tee-Object -FilePath $log; $code=$LASTEXITCODE; $toolDir=Split-Path -Parent $script; $helper=Join-Path $toolDir '_push_tool_log.ps1'; $repoRoot=Resolve-Path (Join-Path $toolDir '..'); if (Test-Path $helper) { & $helper -RepoRoot $repoRoot -LogPath $log -Branch 'feature/tool-logs' }; exit $code"
	exit /b !ERRORLEVEL!
)
setlocal EnableExtensions EnableDelayedExpansion

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set TARGET_ADB_DEVICE=auto
set REMOTE_DATA_DIR=/storage/emulated/0/호이랜드
set LOCAL_DATA_DIR=data
set BACKUP_ROOT=backups\ldplayer-data
set SYNC_LOG=%TEMP%\hoibot_data_pull_%RANDOM%.log
set ENABLE_GIT_PUSH=1
set BASE_BRANCH=feature/prod
set GIT_PUSH_BRANCH=feature/data-backup
set GIT_COMMIT_PREFIX=데이터: LDPlayer 운영 데이터 최신화

title hoiBot LDPlayer data pull

echo.
echo ============================================================
echo  hoiBot LDPlayer 데이터 가져오기
echo ============================================================
echo  LDPlayer 안의 실제 운영 데이터를 로컬 data\ 폴더로 최신화합니다.
echo  실행 전 현재 data\는 일자/시간별 백업 폴더에 보존합니다.
echo ============================================================
echo.

cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [CONFIG]
echo ------------------------------------------------------------
echo  ADB_EXE           = %ADB_EXE%
echo  TARGET_ADB_DEVICE = %TARGET_ADB_DEVICE%
echo  REMOTE_DATA_DIR   = %REMOTE_DATA_DIR%
echo  LOCAL_DATA_DIR    = %LOCAL_DATA_DIR%
echo  BACKUP_ROOT       = %BACKUP_ROOT%
echo  ENABLE_GIT_PUSH   = %ENABLE_GIT_PUSH%
echo  BASE_BRANCH       = %BASE_BRANCH%
echo  GIT_PUSH_BRANCH   = %GIT_PUSH_BRANCH%
if defined HOIBOT_TOOL_LOG_FILE echo  TOOL_LOG_FILE     = %HOIBOT_TOOL_LOG_FILE%
echo ------------------------------------------------------------
echo.

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_LOCAL_DATA

echo [1/7] Git 작업상태 초기화
echo ------------------------------------------------------------
if /i "%ENABLE_GIT_PUSH%"=="1" (
	git fetch origin > "%SYNC_LOG%" 2>&1
	type "%SYNC_LOG%"
	if errorlevel 1 goto FAIL_GIT_FETCH
	git rev-parse --verify "origin/%GIT_PUSH_BRANCH%" > nul 2>&1
	if errorlevel 1 (
		git switch -C "%GIT_PUSH_BRANCH%" "origin/%BASE_BRANCH%" > "%SYNC_LOG%" 2>&1
	) else (
		git switch -C "%GIT_PUSH_BRANCH%" "origin/%GIT_PUSH_BRANCH%" > "%SYNC_LOG%" 2>&1
	)
	type "%SYNC_LOG%"
	if errorlevel 1 goto FAIL_GIT_BRANCH
	git reset --hard > "%SYNC_LOG%" 2>&1
	type "%SYNC_LOG%"
	if errorlevel 1 goto FAIL_GIT_RESET
	git clean -fd > "%SYNC_LOG%" 2>&1
	type "%SYNC_LOG%"
	if errorlevel 1 goto FAIL_GIT_CLEAN
	echo [OK] Git 작업상태 초기화 완료
) else (
	echo [SKIP] ENABLE_GIT_PUSH=0 이므로 Git 초기화를 생략합니다.
)
echo.

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set RUN_TS=%%t
set BACKUP_DIR=%BACKUP_ROOT%\%RUN_TS%
set PULL_ROOT=%TEMP%\hoibot_ld_data_%RUN_TS%
set PULLED_DATA_DIR=%PULL_ROOT%\호이랜드
set REQUIRED_JSON_FILES=member.json board.json carrotBoard.json itemInfo.json trialTowerBoss.json eventTowerBoss.json castleBattle2.json errorLog.json member_title.json pet_title.json miniPet_title.json miniPet_collection.json miniPetCollectionInfo.json member_pet.json petSkillData.json punchRankData.json trialTower.json miniPetData.json memberBagCheck\memberBagCheck.json petSweetHomeInfo.json petSweetHomeData.json petExploreData.json attendanceLight.json itemList.json hoiBotChangeLog.json freeMarket.json packageInfo.json packageLog.json currencyLog.json guildData.json requestMonitorConfig.json

echo [2/7] ADB device 확인
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

echo [3/7] LDPlayer 원격 데이터 폴더 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "ls -ld '%REMOTE_DATA_DIR%'" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_REMOTE_DATA
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_DATA
echo [OK] 원격 데이터 폴더 확인 완료
echo.

echo [4/7] 현재 로컬 data\ 백업
echo ------------------------------------------------------------
mkdir "%BACKUP_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_BACKUP
robocopy "%LOCAL_DATA_DIR%" "%BACKUP_DIR%\data" /E /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set ROBOCOPY_CODE=%ERRORLEVEL%
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_BACKUP
echo [OK] 백업 완료: %BACKUP_DIR%\data
echo.

echo [5/7] LDPlayer 운영 데이터 임시 폴더로 가져오기
echo ------------------------------------------------------------
if exist "%PULL_ROOT%" rmdir /s /q "%PULL_ROOT%"
mkdir "%PULL_ROOT%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_ROOT
"%ADB_EXE%" -s %TARGET_ADB_DEVICE% pull "%REMOTE_DATA_DIR%" "%PULL_ROOT%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_PULL
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_PULL

if not exist "%PULLED_DATA_DIR%\" set PULLED_DATA_DIR=%PULL_ROOT%
set MISSING_REQUIRED_FILE=
for %%f in (%REQUIRED_JSON_FILES%) do (
	if not exist "%PULLED_DATA_DIR%\%%f" (
		set MISSING_REQUIRED_FILE=%%f
		goto FAIL_PULL_VERIFY
	)
)
echo [OK] 가져온 데이터 검증 완료: %PULLED_DATA_DIR%
echo.

echo [6/7] 로컬 data\ 최신화
echo ------------------------------------------------------------
robocopy "%PULLED_DATA_DIR%" "%LOCAL_DATA_DIR%" /MIR /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set ROBOCOPY_CODE=%ERRORLEVEL%
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_MIRROR
echo [OK] 로컬 data\ 최신화 완료
echo.

echo [7/7] Git 데이터/로그 기록 및 push
echo ------------------------------------------------------------
if /i not "%ENABLE_GIT_PUSH%"=="1" (
	echo [SKIP] ENABLE_GIT_PUSH=0 이므로 Git push를 생략합니다.
	goto SUCCESS
)
git status --porcelain "%LOCAL_DATA_DIR%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
set HAS_GIT_INPUT=
findstr "." "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 set HAS_GIT_INPUT=1
if defined HOIBOT_TOOL_LOG_FILE if exist "%HOIBOT_TOOL_LOG_FILE%" set HAS_GIT_INPUT=1
if not defined HAS_GIT_INPUT (
	echo [OK] data\ 변경사항 및 실행 로그 없음 - Git commit/push 생략
	goto SUCCESS
)
git add "%LOCAL_DATA_DIR%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_ADD
if defined HOIBOT_TOOL_LOG_FILE if exist "%HOIBOT_TOOL_LOG_FILE%" (
	git add -f "%HOIBOT_TOOL_LOG_FILE%" > "%SYNC_LOG%" 2>&1
	type "%SYNC_LOG%"
	if errorlevel 1 goto FAIL_GIT_ADD
)
git commit -m "%GIT_COMMIT_PREFIX% %RUN_TS%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_COMMIT
git push -u origin "%GIT_PUSH_BRANCH%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_PUSH
echo [OK] Git push 완료: %GIT_PUSH_BRANCH%
echo.

:SUCCESS
echo ============================================================
echo  SUCCESS - LDPlayer 데이터 가져오기 완료
echo ============================================================
echo  백업 위치: %BACKUP_DIR%\data
echo  최신화 대상: %LOCAL_DATA_DIR%\
if defined HOIBOT_TOOL_LOG_FILE echo  실행 로그: %HOIBOT_TOOL_LOG_FILE%
if /i "%ENABLE_GIT_PUSH%"=="1" echo  Git push 대상: %GIT_PUSH_BRANCH%
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

:FAIL_LOCAL_DATA
echo.
echo ============================================================
echo  FAIL - 로컬 data 폴더 없음
echo ============================================================
echo  LOCAL_DATA_DIR = %LOCAL_DATA_DIR%
echo ============================================================
pause
exit /b 1

:FAIL_GIT_FETCH
echo.
echo ============================================================
echo  FAIL - Git 원격 정보 갱신 실패
echo ============================================================
echo  인터넷 연결 또는 GitHub 권한을 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_BRANCH
echo.
echo ============================================================
echo  FAIL - Git 데이터 백업 브랜치 준비 실패
echo ============================================================
echo  GIT_PUSH_BRANCH = %GIT_PUSH_BRANCH%
echo  현재 작업트리에 미정리 변경사항이 있는지 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_RESET
echo.
echo ============================================================
echo  FAIL - Git 작업내용 초기화 실패
echo ============================================================
echo  reset 처리 중 문제가 발생했습니다.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_CLEAN
echo.
echo ============================================================
echo  FAIL - Git 미추적 파일 정리 실패
echo ============================================================
echo  clean 처리 중 문제가 발생했습니다.
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
echo  운영 봇이 실행 중인 LDPlayer만 켜거나 TARGET_ADB_DEVICE를 직접 지정하세요.
echo ============================================================
pause
exit /b 1

:FAIL_REMOTE_DATA
echo.
echo ============================================================
echo  FAIL - LDPlayer 원격 데이터 폴더 확인 실패
echo ============================================================
echo  REMOTE_DATA_DIR = %REMOTE_DATA_DIR%
echo  운영 데이터 경로가 맞는지 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_BACKUP
echo.
echo ============================================================
echo  FAIL - 로컬 data 백업 실패
echo ============================================================
echo  BACKUP_DIR = %BACKUP_DIR%\data
echo  파일 권한 또는 잠금 상태를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_PULL_ROOT
echo.
echo ============================================================
echo  FAIL - 임시 pull 폴더 생성 실패
echo ============================================================
echo  PULL_ROOT = %PULL_ROOT%
echo ============================================================
pause
exit /b 1

:FAIL_PULL
echo.
echo ============================================================
echo  FAIL - LDPlayer 데이터 가져오기 실패
echo ============================================================
echo  LDPlayer 저장공간 접근 상태와 ADB 연결을 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_PULL_VERIFY
echo.
echo ============================================================
echo  FAIL - 가져온 데이터 검증 실패
echo ============================================================
echo  main.js 초기 운영 JSON 경로 기준 필수 파일을 찾지 못했습니다.
echo  누락 파일: %MISSING_REQUIRED_FILE%
echo  안전을 위해 로컬 data\를 덮어쓰지 않았습니다.
echo  PULLED_DATA_DIR = %PULLED_DATA_DIR%
echo  백업 위치: %BACKUP_DIR%\data
echo ============================================================
pause
exit /b 1

:FAIL_MIRROR
echo.
echo ============================================================
echo  FAIL - 로컬 data 최신화 실패
echo ============================================================
echo  백업 위치: %BACKUP_DIR%\data
echo  robocopy 로그를 확인하세요: %SYNC_LOG%
echo ============================================================
pause
exit /b 1

:FAIL_GIT_ADD
echo.
echo ============================================================
echo  FAIL - Git add 실패
echo ============================================================
echo  data\ 변경사항을 스테이징하지 못했습니다.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_COMMIT
echo.
echo ============================================================
echo  FAIL - Git commit 실패
echo ============================================================
echo  data\ 변경사항 기록 중 문제가 발생했습니다.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_PUSH
echo.
echo ============================================================
echo  FAIL - Git push 실패
echo ============================================================
echo  GIT_PUSH_BRANCH = %GIT_PUSH_BRANCH%
echo  GitHub 권한 또는 인터넷 연결을 확인하세요.
echo ============================================================
pause
exit /b 1
