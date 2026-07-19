@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set BRANCH_NAME=feature/hoi
set BASE_BRANCH=feature/prod
set REMOTE_BASE=origin/feature/prod

title hoiBot workflow 01 - 새 작업 시작

echo.
echo ============================================================
echo  hoiBot Workflow 01 - 새 작업 시작
echo ============================================================
echo.
echo  base branch : %REMOTE_BASE%
echo  work branch : %BRANCH_NAME%
echo.
echo  기존 %BRANCH_NAME% 작업 내용을 초기화하고
echo  깃허브의 최신 %REMOTE_BASE% 기준으로 새 작업을 시작합니다.
echo.
echo  주의: 방금 수정한 내용이 있다면 삭제될 수 있습니다.
echo ============================================================
echo.

echo 계속 진행하려면 Y 를 입력한 뒤 Enter를 누르세요.
set /p "CONFIRM=> "

if /I not "%CONFIRM%"=="Y" goto CANCEL

echo.
echo [STEP 1/6] 프로젝트 폴더 이동
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [OK] PROJECT_DIR
cd

echo.
echo [STEP 2/6] 원격 저장소 정보 갱신
git fetch origin
if errorlevel 1 goto FAIL_FETCH

echo [OK] fetch complete

echo.
echo [STEP 3/6] 원격 운영 기준 확인
git fetch origin %BASE_BRANCH%:refs/remotes/%REMOTE_BASE%
if errorlevel 1 goto FAIL_PULL

git rev-parse --verify %REMOTE_BASE%
if errorlevel 1 goto FAIL_PULL

echo [OK] %REMOTE_BASE% ready

echo.
echo [STEP 4/6] 작업 브랜치 준비
git switch -C %BRANCH_NAME% %REMOTE_BASE%
if errorlevel 1 goto FAIL_BRANCH

echo [OK] %BRANCH_NAME% ready

echo.
echo [STEP 5/6] 작업 폴더 초기화
git reset --hard %REMOTE_BASE%
if errorlevel 1 goto FAIL_RESET

git clean -fd
if errorlevel 1 goto FAIL_CLEAN

echo.
echo [STEP 6/6] 원격 작업 브랜치 기준 맞추기
git push -u origin %BRANCH_NAME% --force-with-lease
if errorlevel 1 goto FAIL_PUSH

for /f "usebackq delims=" %%h in (`git rev-parse --short HEAD`) do set CURRENT_GIT_HEAD=%%h

echo.
echo ============================================================
echo  SUCCESS - 새 작업 준비 완료
echo ============================================================
echo.
echo  현재 브랜치: %BRANCH_NAME%
echo  Git HEAD: !CURRENT_GIT_HEAD!
echo  원격 반영: origin/%BRANCH_NAME%
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

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - 원격 작업 브랜치 기준 맞추기 실패
echo ============================================================
echo  origin/%BRANCH_NAME% 반영 중 문제가 발생했습니다.
echo  인터넷 연결, GitHub 권한, 또는 원격 브랜치 변경을 확인하세요.
echo ============================================================
pause
exit /b 1
