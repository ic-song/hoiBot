@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set TARGET_DEVICE=emulator-5556
set TARGET_FILE=/storage/emulated/0/hoiland/hoiland/Bots/main/main.js
set SOURCE_FILE=main.js
set CHANGELOG_SOURCE=data\hoiBotChangeLog.json
set TARGET_CHANGELOG=/storage/emulated/0/호이랜드/hoiBotChangeLog.json
set TARGET_CHANGELOG_DIR=/storage/emulated/0/호이랜드
set BOT_NAME=main
set BASE_BRANCH=feature/prod

title hoiBot main deploy

echo.
echo ============================================================
echo  hoiBot 운영 반영 - main.js
echo ============================================================
echo  LDPlayer와 MessengerBot이 켜진 상태에서 실행하세요.
echo ============================================================
echo.

echo [1/5] 준비 확인
echo ------------------------------------------------------------
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH
if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%SOURCE_FILE%" goto FAIL_SOURCE
if not exist "%CHANGELOG_SOURCE%" goto FAIL_CHANGELOG_SOURCE
echo [OK] 준비 완료
echo.

echo [2/5] 최신 코드 받기
echo ------------------------------------------------------------
git switch %BASE_BRANCH% > nul 2>&1
if errorlevel 1 goto FAIL_GIT_SWITCH
git pull --ff-only origin %BASE_BRANCH% > nul 2>&1
if errorlevel 1 goto FAIL_GIT_PULL
echo [OK] 최신 코드 확인 완료
echo.

echo [3/5] LDPlayer 연결 확인
echo ------------------------------------------------------------
"%ADB_EXE%" devices > nul 2>&1
if errorlevel 1 goto FAIL_ADB

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

set TARGET_DEVICE=!FIRST_DEVICE!
echo [OK] 연결된 기기: !TARGET_DEVICE!
echo.

echo [4/5] main.js 업로드
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_DEVICE% push "%SOURCE_FILE%" "%TARGET_FILE%" > nul 2>&1
if errorlevel 1 goto FAIL_PUSH
"%ADB_EXE%" -s %TARGET_DEVICE% shell ls -l "%TARGET_FILE%" > nul 2>&1
echo [OK] main.js uploaded
echo.

echo [5/5] 수정내용 업로드 및 컴파일 요청
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_DEVICE% shell mkdir -p "%TARGET_CHANGELOG_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_CHANGELOG
"%ADB_EXE%" -s %TARGET_DEVICE% push "%CHANGELOG_SOURCE%" "%TARGET_CHANGELOG%" > nul 2>&1
if errorlevel 1 goto FAIL_CHANGELOG
"%ADB_EXE%" -s %TARGET_DEVICE% shell ls -l "%TARGET_CHANGELOG%" > nul 2>&1
"%ADB_EXE%" -s %TARGET_DEVICE% shell am broadcast -a com.xfl.msgbot.broadcast.compile -p com.xfl.msgbot --es name %BOT_NAME% > nul 2>&1
if errorlevel 1 goto FAIL_COMPILE
echo [OK] 수정내용 업로드 및 컴파일 요청 완료
echo.

echo ============================================================
echo  SUCCESS - main.js 운영 반영 완료
echo ============================================================
echo  main.js와 수정내용이 운영 봇에 반영되었습니다.
echo ============================================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ============================================================
echo  FAIL - 프로젝트 폴더 이동 실패
echo ============================================================
echo  BAT 파일 위치가 HOIBOT\tools\ 인지 확인하세요.
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

:FAIL_SOURCE
echo.
echo ============================================================
echo  FAIL - main.js 파일 없음
echo ============================================================
echo  SOURCE_FILE = %SOURCE_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_CHANGELOG_SOURCE
echo.
echo ============================================================
echo  FAIL - hoiBotChangeLog.json 파일 없음
echo ============================================================
echo  CHANGELOG_SOURCE = %CHANGELOG_SOURCE%
echo ============================================================
pause
exit /b 1

:FAIL_GIT_SWITCH
echo.
echo ============================================================
echo  FAIL - 브랜치 이동 실패
echo ============================================================
echo  BASE_BRANCH = %BASE_BRANCH%
echo ============================================================
pause
exit /b 1

:FAIL_GIT_PULL
echo.
echo ============================================================
echo  FAIL - Git 최신화 실패
echo ============================================================
echo  충돌, 네트워크, GitHub 권한을 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_ADB
echo.
echo ============================================================
echo  FAIL - ADB 기기 확인 실패
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
echo  잘못된 기기에 운영반영되는 것을 막기 위해 중단합니다.
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - main.js 업로드 실패
echo ============================================================
echo  LDPlayer와 MessengerBot이 켜져 있는지 확인하세요.
echo  계속 실패하면 LDPlayer를 재시작한 뒤 다시 실행하세요.
echo ============================================================
pause
exit /b 1

:FAIL_CHANGELOG
echo.
echo ============================================================
echo  FAIL - hoiBotChangeLog.json 업로드 실패
echo ============================================================
echo  수정내용 파일 업로드에 실패했습니다.
echo  LDPlayer 저장공간 접근 상태를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_COMPILE
echo.
echo ============================================================
echo  FAIL - MessengerBot 컴파일 요청 실패
echo ============================================================
echo  MessengerBot 앱이 실행 중인지 확인하세요.
echo ============================================================
pause
exit /b 1
