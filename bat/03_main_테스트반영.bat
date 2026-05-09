@echo off
chcp 65001 > nul

set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set TARGET_DEVICE=emulator-5556
set TARGET_FILE=/storage/emulated/0/hoiland/Bots/main/main.js
set BOT_NAME=main

echo.
echo ========================================
echo [START] main.js 테스트 반영
echo ========================================
echo.
echo 이 작업은 최신 main 코드를 받은 뒤
echo LD플레이어의 main.js에 반영합니다.
echo ========================================
echo.

echo [1/5] 프로젝트 폴더로 이동 중...
cd /d "%~dp0..\.."
if errorlevel 1 goto FAIL_PATH

echo [OK] 프로젝트 폴더 이동 완료
echo 현재 위치:
cd

echo.
echo [2/5] Git 최신화 중...
git switch main
if errorlevel 1 goto FAIL_GIT_SWITCH

git pull origin main
if errorlevel 1 goto FAIL_GIT_PULL

echo [OK] Git 최신화 완료

echo.
echo [3/5] ADB 기기 확인 중...
"%ADB_EXE%" devices
if errorlevel 1 goto FAIL_ADB

echo [OK] ADB 확인 완료

echo.
echo [4/5] main.js 파일 업로드 중...
"%ADB_EXE%" -s %TARGET_DEVICE% push main.js "%TARGET_FILE%"
if errorlevel 1 goto FAIL_PUSH

echo [OK] main.js 업로드 완료

echo.
echo [5/5] 메신저봇R main 컴파일 중...
"%ADB_EXE%" -s %TARGET_DEVICE% shell am broadcast -a com.xfl.msgbot.broadcast.compile -p com.xfl.msgbot --es name %BOT_NAME%
if errorlevel 1 goto FAIL_COMPILE

echo.
echo ========================================
echo [SUCCESS] main.js 테스트 반영 완료
echo ========================================
echo.
echo LD플레이어에 main.js 업로드 및 컴파일까지 완료했습니다.
echo ========================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ========================================
echo [FAIL] 프로젝트 폴더 이동 실패
echo BAT 파일 위치를 확인하세요.
echo 예상 위치: hoiBot/tools/planner/
echo ========================================
pause
exit /b 1

:FAIL_GIT_SWITCH
echo.
echo ========================================
echo [FAIL] main 브랜치 이동 실패
echo main 브랜치가 있는지 확인하세요.
echo ========================================
pause
exit /b 1

:FAIL_GIT_PULL
echo.
echo ========================================
echo [FAIL] Git 최신화 실패
echo 인터넷 연결 또는 GitHub 권한을 확인하세요.
echo ========================================
pause
exit /b 1

:FAIL_ADB
echo.
echo ========================================
echo [FAIL] ADB 확인 실패
echo ADB_EXE 경로 또는 LD플레이어 실행 상태를 확인하세요.
echo ADB 경로: %ADB_EXE%
echo ========================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ========================================
echo [FAIL] main.js 업로드 실패
echo LD플레이어 기기명 또는 파일 경로를 확인하세요.
echo DEVICE: %TARGET_DEVICE%
echo FILE: %TARGET_FILE%
echo ========================================
pause
exit /b 1

:FAIL_COMPILE
echo.
echo ========================================
echo [FAIL] 메신저봇R 컴파일 실패
echo 봇 이름 또는 메신저봇R 패키지명을 확인하세요.
echo BOT_NAME: %BOT_NAME%
echo ========================================
pause
exit /b 1