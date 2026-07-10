@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set BRANCH_NAME=feature/hoi
set BASE_BRANCH=feature/prod

echo.
echo ========================================
echo [WARNING] 작업내용 초기화
echo ========================================
echo.
echo 이 작업은 현재 수정한 내용을 전부 삭제하고
echo origin/%BASE_BRANCH% 기준으로 되돌립니다.
echo.
echo 로컬 변경사항과 새로 만든 파일이 사라질 수 있습니다.
echo 정말 망했을 때만 사용하세요.
echo ========================================
echo.

echo 정말 초기화하려면 RESET 을 입력한 뒤 Enter를 누르세요.
set /p "CONFIRM=> "

if /I not "%CONFIRM%"=="RESET" goto CANCEL

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
echo [3/5] 작업 브랜치로 이동/생성 중...
git switch -C %BRANCH_NAME% origin/%BASE_BRANCH%
if errorlevel 1 goto FAIL_BRANCH

echo [OK] 작업 브랜치 준비 완료

echo.
echo [4/5] 수정내용 되돌리는 중...
git reset --hard origin/%BASE_BRANCH%
if errorlevel 1 goto FAIL_RESET

echo [OK] 수정내용 되돌리기 완료

echo.
echo [5/5] 새로 생긴 파일 정리 중...
git clean -fd
if errorlevel 1 goto FAIL_CLEAN

echo.
echo ========================================
echo [SUCCESS] 초기화 완료
echo ========================================
echo.
echo 현재 상태는 origin/%BASE_BRANCH% 기준으로 되돌아갔습니다.
echo 다시 작업하려면 01_새작업시작.bat 를 실행하세요.
echo ========================================
pause
exit /b 0

:CANCEL
echo.
echo ========================================
echo [CANCEL] 초기화가 취소되었습니다.
echo 아무 내용도 삭제하지 않았습니다.
echo ========================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ========================================
echo [FAIL] 프로젝트 폴더 이동 실패
echo BAT 파일 위치를 확인하세요.
echo 예상 위치: HOIBOT/tools/
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

:FAIL_BRANCH
echo.
echo ========================================
echo [FAIL] 작업 브랜치 이동/생성 실패
echo feature/hoi 브랜치 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1

:FAIL_RESET
echo.
echo ========================================
echo [FAIL] 수정내용 되돌리기 실패
echo reset 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1

:FAIL_CLEAN
echo.
echo ========================================
echo [FAIL] 새 파일 정리 실패
echo clean 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1
