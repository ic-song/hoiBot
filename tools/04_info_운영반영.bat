@echo off
chcp 65001 > nul
setlocal EnableExtensions

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set TARGET_DEVICE=emulator-5556
set TARGET_FILE=/storage/emulated/0/hoiland/hoiland/Bots/info/Info.js
set SOURCE_FILE=Info.js
set CHANGELOG_SOURCE=data\hoiBotChangeLog.json
set TARGET_CHANGELOG=/storage/emulated/0/호이랜드/hoiBotChangeLog.json
set TARGET_CHANGELOG_DIR=/storage/emulated/0/호이랜드
set BOT_NAME=info
set BASE_BRANCH=feature/prod

title hoiBot info deploy

echo.
echo ============================================================
echo  hoiBot 운영 반영 - Info.js
echo ============================================================
echo  1. 최신 %BASE_BRANCH% 받기
echo  2. Info.js 업로드
echo  3. hoiBotChangeLog.json 업로드
echo  4. MessengerBot info 컴파일
echo ============================================================
echo.

echo [CONFIG]
echo ------------------------------------------------------------
echo  ADB_EXE          = %ADB_EXE%
echo  TARGET_DEVICE    = %TARGET_DEVICE%
echo  BOT_NAME         = %BOT_NAME%
echo  SOURCE_FILE      = %SOURCE_FILE%
echo  TARGET_FILE      = %TARGET_FILE%
echo  CHANGELOG_SOURCE = %CHANGELOG_SOURCE%
echo  TARGET_CHANGELOG = %TARGET_CHANGELOG%
echo ------------------------------------------------------------
echo.

echo [STEP 1/7] 프로젝트 폴더 이동
echo ------------------------------------------------------------
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH
echo [OK] PROJECT_DIR = %CD%
echo.

echo [STEP 2/7] 필수 파일 확인
echo ------------------------------------------------------------
if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%SOURCE_FILE%" goto FAIL_SOURCE
if not exist "%CHANGELOG_SOURCE%" goto FAIL_CHANGELOG_SOURCE
echo [OK] required files exist
echo.

echo [STEP 3/7] Git 최신화
echo ------------------------------------------------------------
git switch %BASE_BRANCH%
if errorlevel 1 goto FAIL_GIT_SWITCH
echo.
git pull --ff-only origin %BASE_BRANCH%
if errorlevel 1 goto FAIL_GIT_PULL
echo.
git status --short --branch
echo.
echo [OK] git ready
echo.

echo [STEP 4/7] ADB 기기 확인
echo ------------------------------------------------------------
"%ADB_EXE%" devices
if errorlevel 1 goto FAIL_ADB
echo.
echo [OK] adb ready
echo.

echo [STEP 5/7] Info.js 업로드
echo ------------------------------------------------------------
echo  FROM: %SOURCE_FILE%
echo  TO  : %TARGET_FILE%
echo.
"%ADB_EXE%" -s %TARGET_DEVICE% push "%SOURCE_FILE%" "%TARGET_FILE%"
if errorlevel 1 goto FAIL_PUSH
echo.
"%ADB_EXE%" -s %TARGET_DEVICE% shell ls -l "%TARGET_FILE%"
echo.
echo [OK] Info.js uploaded
echo.

echo [STEP 6/7] hoiBotChangeLog.json 업로드
echo ------------------------------------------------------------
echo  FROM: %CHANGELOG_SOURCE%
echo  TO  : %TARGET_CHANGELOG%
echo.
"%ADB_EXE%" -s %TARGET_DEVICE% shell mkdir -p "%TARGET_CHANGELOG_DIR%"
if errorlevel 1 goto FAIL_CHANGELOG
echo.
"%ADB_EXE%" -s %TARGET_DEVICE% push "%CHANGELOG_SOURCE%" "%TARGET_CHANGELOG%"
if errorlevel 1 goto FAIL_CHANGELOG
echo.
"%ADB_EXE%" -s %TARGET_DEVICE% shell ls -l "%TARGET_CHANGELOG%"
echo.
echo [OK] hoiBotChangeLog.json uploaded
echo.

echo [STEP 7/7] MessengerBot info 컴파일
echo ------------------------------------------------------------
"%ADB_EXE%" -s %TARGET_DEVICE% shell am broadcast -a com.xfl.msgbot.broadcast.compile -p com.xfl.msgbot --es name %BOT_NAME%
if errorlevel 1 goto FAIL_COMPILE
echo.
echo [OK] compile requested
echo.

echo ============================================================
echo  SUCCESS - Info.js 운영 반영 완료
echo ============================================================
echo  Info.js와 hoiBotChangeLog.json 업로드를 확인했습니다.
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
echo  FAIL - Info.js 파일 없음
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
echo  LDPlayer 실행 상태와 TARGET_DEVICE 값을 확인하세요.
echo  TARGET_DEVICE = %TARGET_DEVICE%
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - Info.js 업로드 실패
echo ============================================================
echo  TARGET_FILE = %TARGET_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_CHANGELOG
echo.
echo ============================================================
echo  FAIL - hoiBotChangeLog.json 업로드 실패
echo ============================================================
echo  TARGET_CHANGELOG = %TARGET_CHANGELOG%
echo ============================================================
pause
exit /b 1

:FAIL_COMPILE
echo.
echo ============================================================
echo  FAIL - MessengerBot 컴파일 요청 실패
echo ============================================================
echo  BOT_NAME = %BOT_NAME%
echo ============================================================
pause
exit /b 1
