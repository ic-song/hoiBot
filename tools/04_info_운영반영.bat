@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set LD_CONSOLE_EXE=C:\LDPlayer\LDPlayer9\ldconsole.exe
set TARGET_LD_INDEX=1
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
echo  LDPlayer와 MessengerBot이 켜진 상태에서 실행하세요.
echo ============================================================
echo  LD_CONSOLE_EXE  = %LD_CONSOLE_EXE%
echo  TARGET_LD_INDEX = %TARGET_LD_INDEX%
echo  TARGET_FILE     = %TARGET_FILE%
echo ============================================================
echo.

echo [1/5] 준비 확인
echo ------------------------------------------------------------
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH
if not exist "%LD_CONSOLE_EXE%" goto FAIL_LD_CONSOLE_EXE
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

echo [3/5] LDPlayer 인스턴스 연결 확인
echo ------------------------------------------------------------
"%LD_CONSOLE_EXE%" list2 | findstr /b "%TARGET_LD_INDEX%," > nul 2>&1
if errorlevel 1 goto FAIL_LD_INDEX
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell echo ok" > nul 2>&1
if errorlevel 1 goto FAIL_ADB
echo [OK] LDPlayer index: %TARGET_LD_INDEX%
echo.

echo [4/5] Info.js 업로드
echo ------------------------------------------------------------
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "push %SOURCE_FILE% %TARGET_FILE%" > nul 2>&1
if errorlevel 1 goto FAIL_PUSH
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell ls -l %TARGET_FILE%" > nul 2>&1
echo [OK] Info.js uploaded
echo.

echo [5/5] 수정내용 업로드 및 컴파일 요청
echo ------------------------------------------------------------
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell mkdir -p %TARGET_CHANGELOG_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_CHANGELOG
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "push %CHANGELOG_SOURCE% %TARGET_CHANGELOG%" > nul 2>&1
if errorlevel 1 goto FAIL_CHANGELOG
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell ls -l %TARGET_CHANGELOG%" > nul 2>&1
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell am broadcast -a com.xfl.msgbot.broadcast.compile -p com.xfl.msgbot --es name %BOT_NAME%" > nul 2>&1
if errorlevel 1 goto FAIL_COMPILE
echo [OK] 수정내용 업로드 및 컴파일 요청 완료
echo.

echo ============================================================
echo  SUCCESS - Info.js 운영 반영 완료
echo ============================================================
echo  Info.js와 수정내용이 운영 봇에 반영되었습니다.
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

:FAIL_LD_CONSOLE_EXE
echo.
echo ============================================================
echo  FAIL - ldconsole.exe 파일 없음
echo ============================================================
echo  LD_CONSOLE_EXE 경로가 실제 LDPlayer ldconsole.exe 위치와 다릅니다.
echo  LD_CONSOLE_EXE = %LD_CONSOLE_EXE%
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
echo  FAIL - LDPlayer ADB 명령 실패
echo ============================================================
echo  TARGET_LD_INDEX = %TARGET_LD_INDEX%
echo  LDPlayer 실행 상태와 MessengerBot 인스턴스를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_LD_INDEX
echo.
echo ============================================================
echo  FAIL - LDPlayer 인스턴스 없음
echo ============================================================
echo  TARGET_LD_INDEX = %TARGET_LD_INDEX%
echo  ldconsole list2에서 해당 인스턴스 번호를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - Info.js 업로드 실패
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
