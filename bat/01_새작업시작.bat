@echo off
chcp 65001 > nul

set BRANCH_NAME=feature/bm

echo.
echo ========================================
echo [START] 새 작업 시작
echo ========================================
echo.
echo 이 작업은 기존 feature/bm 작업 내용을 초기화하고
echo 최신 main 기준으로 새 작업을 시작합니다.
echo.
echo 방금 수정한 내용이 있다면 삭제될 수 있습니다.
echo ========================================
echo.

set /p CONFIRM=계속 진행하려면 Y 를 입력하세요: 

if /I not "%CONFIRM%"=="Y" goto CANCEL

echo.
echo [1/5] 프로젝트 폴더로 이동 중...
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [OK] 프로젝트 폴더 이동 완료
echo 현재 위치:
cd

echo.
echo [2/5] 원격 저장소 정보 갱신 중...
git fetch origin
if errorlevel 1 goto FAIL_FETCH

echo [OK] 원격 정보 갱신 완료

echo.
echo [3/5] main 브랜치 최신화 중...
git switch main
if errorlevel 1 goto FAIL_MAIN

git pull origin main
if errorlevel 1 goto FAIL_PULL

echo [OK] main 최신화 완료

echo.
echo [4/5] 작업 브랜치 준비 중...
git switch -C %BRANCH_NAME% origin/main
if errorlevel 1 goto FAIL_BRANCH

echo [OK] 작업 브랜치 준비 완료

echo.
echo [5/5] 작업 폴더 초기화 중...
git reset --hard origin/main
if errorlevel 1 goto FAIL_RESET

git clean -fd
if errorlevel 1 goto FAIL_CLEAN

echo.
echo ========================================
echo [SUCCESS] 새 작업 준비 완료
echo ========================================
echo.
echo 이제 main.js 또는 Info.js에 코드를 붙여넣고 저장하세요.
echo 그 다음 02_수정내용올리기.bat 를 실행하면 됩니다.
echo.
echo 현재 브랜치: %BRANCH_NAME%
echo ========================================
pause
exit /b 0

:CANCEL
echo.
echo ========================================
echo [CANCEL] 작업이 취소되었습니다.
echo ========================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ========================================
echo [FAIL] 프로젝트 폴더 이동 실패
echo BAT 파일 위치를 확인하세요.
echo 예상 위치: HOIBOT/bat/
echo ========================================
pause
exit /b 1

:FAIL_FETCH
echo.
echo ========================================
echo [FAIL] 원격 저장소 정보 갱신 실패
echo 인터넷 연결 또는 GitHub 권한을 확인하세요.
echo ========================================
pause
exit /b 1

:FAIL_MAIN
echo.
echo ========================================
echo [FAIL] main 브랜치 이동 실패
echo main 브랜치가 있는지 확인하세요.
echo ========================================
pause
exit /b 1

:FAIL_PULL
echo.
echo ========================================
echo [FAIL] main 최신화 실패
echo 충돌 또는 GitHub 권한을 확인하세요.
echo ========================================
pause
exit /b 1

:FAIL_BRANCH
echo.
echo ========================================
echo [FAIL] 작업 브랜치 준비 실패
echo feature/bm 브랜치 생성/이동 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1

:FAIL_RESET
echo.
echo ========================================
echo [FAIL] 작업 초기화 실패
echo reset 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1

:FAIL_CLEAN
echo.
echo ========================================
echo [FAIL] 불필요 파일 정리 실패
echo clean 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1