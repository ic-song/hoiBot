@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set TARGET_ADB_DEVICE=auto
set REMOTE_DATA_DIR=/storage/emulated/0/호이랜드
set LOCAL_DATA_DIR=data
set BACKUP_ROOT=backups\ldplayer-data
set SYNC_LOG=%TEMP%\hoibot_data_pull_%RANDOM%.log

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
echo ------------------------------------------------------------
echo.

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_LOCAL_DATA

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set RUN_TS=%%t
set BACKUP_DIR=%BACKUP_ROOT%\%RUN_TS%
set PULL_ROOT=%TEMP%\hoibot_ld_data_%RUN_TS%
set PULLED_DATA_DIR=%PULL_ROOT%\호이랜드

echo [1/5] ADB device 확인
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

echo [2/5] LDPlayer 원격 데이터 폴더 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "ls -ld '%REMOTE_DATA_DIR%'" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_REMOTE_DATA
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_DATA
echo [OK] 원격 데이터 폴더 확인 완료
echo.

echo [3/5] 현재 로컬 data\ 백업
echo ------------------------------------------------------------
mkdir "%BACKUP_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_BACKUP
robocopy "%LOCAL_DATA_DIR%" "%BACKUP_DIR%\data" /E /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set ROBOCOPY_CODE=%ERRORLEVEL%
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_BACKUP
echo [OK] 백업 완료: %BACKUP_DIR%\data
echo.

echo [4/5] LDPlayer 운영 데이터 임시 폴더로 가져오기
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
if not exist "%PULLED_DATA_DIR%\member.json" goto FAIL_PULL_VERIFY
if not exist "%PULLED_DATA_DIR%\guildData.json" goto FAIL_PULL_VERIFY
if not exist "%PULLED_DATA_DIR%\hoiBotChangeLog.json" goto FAIL_PULL_VERIFY
echo [OK] 가져온 데이터 검증 완료: %PULLED_DATA_DIR%
echo.

echo [5/5] 로컬 data\ 최신화
echo ------------------------------------------------------------
robocopy "%PULLED_DATA_DIR%" "%LOCAL_DATA_DIR%" /MIR /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set ROBOCOPY_CODE=%ERRORLEVEL%
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_MIRROR
echo [OK] 로컬 data\ 최신화 완료
echo.

echo ============================================================
echo  SUCCESS - LDPlayer 데이터 가져오기 완료
echo ============================================================
echo  백업 위치: %BACKUP_DIR%\data
echo  최신화 대상: %LOCAL_DATA_DIR%\
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
echo  member.json, guildData.json, hoiBotChangeLog.json 중 하나를 찾지 못했습니다.
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
