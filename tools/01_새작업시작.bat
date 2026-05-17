@echo off
chcp 65001 > nul

set BRANCH_NAME=feature/hoi
set BASE_BRANCH=feature/prod

title hoiBot workflow 01 - 새 작업 시작

echo.
echo ============================================================
echo  hoiBot Workflow 01 - 새 작업 시작
echo ============================================================
echo.
echo  기준 브랜치 : %BASE_BRANCH%
echo  작업 브랜치 : %BRANCH_NAME%
echo.
echo  기존 %BRANCH_NAME% 작업 내용을 초기화하고
echo  최신 %BASE_BRANCH% 기준으로 새 작업을 시작합니다.
echo.
echo  주의: 방금 수정한 내용이 있다면 삭제될 수 있습니다.
echo ============================================================
echo.

set /p "CONFIRM=계속 진행하려면 Y 를 입력하세요 > "

if /I not "%CONFIRM%"=="Y" goto CANCEL

echo.
echo [STEP 1/5] 프로젝트 폴더 이동
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [OK] PROJECT_DIR
cd

echo.
echo [STEP 2/5] 원격 저장소 정보 갱신
git fetch origin
if errorlevel 1 goto FAIL_FETCH

echo [OK] fetch complete

echo.
echo [STEP 3/5] %BASE_BRANCH% 최신화
git switch %BASE_BRANCH%
if errorlevel 1 goto FAIL_MAIN

git pull origin %BASE_BRANCH%
if errorlevel 1 goto FAIL_PULL

echo [OK] %BASE_BRANCH% ready

echo.
echo [STEP 4/5] 작업 브랜치 준비
git switch -C %BRANCH_NAME% origin/%BASE_BRANCH%
if errorlevel 1 goto FAIL_BRANCH

echo [OK] %BRANCH_NAME% ready

echo.
echo [STEP 5/5] 작업 폴더 초기화
git reset --hard origin/%BASE_BRANCH%
if errorlevel 1 goto FAIL_RESET

git clean -fd
if errorlevel 1 goto FAIL_CLEAN

echo.
echo ============================================================
echo  SUCCESS - 새 작업 준비 완료
echo ============================================================
echo.
echo  다음 작업:
echo  1. main.js 또는 Info.js에 코드를 붙여넣고 저장
echo  2. 02_수정내용올리기.bat 실행
echo.
echo  현재 브랜치: %BRANCH_NAME%
echo ============================================================
pause
exit /b 0

:CANCEL
echo.
echo ============================================================
echo  CANCEL - 작업이 취소되었습니다.
echo ============================================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ============================================================
echo  FAIL - 프로젝트 폴더 이동 실패
echo ============================================================
echo  BAT 파일 위치를 확인하세요.
echo  예상 위치: HOIBOT\tools\
echo ============================================================
pause
exit /b 1

:FAIL_FETCH
echo.
echo ============================================================
echo  FAIL - 원격 저장소 정보 갱신 실패
echo ============================================================
echo  인터넷 연결 또는 GitHub 권한을 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_MAIN
echo.
echo ============================================================
echo  FAIL - %BASE_BRANCH% 브랜치 이동 실패
echo ============================================================
echo  %BASE_BRANCH% 브랜치가 있는지 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_PULL
echo.
echo ============================================================
echo  FAIL - %BASE_BRANCH% 최신화 실패
echo ============================================================
echo  충돌 또는 GitHub 권한을 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_BRANCH
echo.
echo ============================================================
echo  FAIL - 작업 브랜치 준비 실패
echo ============================================================
echo  %BRANCH_NAME% 브랜치 생성/이동 중 문제가 발생했습니다.
echo ============================================================
pause
exit /b 1

:FAIL_RESET
echo.
echo ============================================================
echo  FAIL - 작업 초기화 실패
echo ============================================================
echo  reset 처리 중 문제가 발생했습니다.
echo ============================================================
pause
exit /b 1

:FAIL_CLEAN
echo.
echo ============================================================
echo  FAIL - 불필요 파일 정리 실패
echo ============================================================
echo  clean 처리 중 문제가 발생했습니다.
echo ============================================================
pause
exit /b 1
