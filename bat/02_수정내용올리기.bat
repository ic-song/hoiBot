@echo off
chcp 65001 > nul

set BRANCH_NAME=feature/bm

echo.
echo ========================================
echo [START] 수정내용 올리기
echo ========================================
echo.
echo 이 작업은 현재 수정한 내용을 저장소에 올립니다.
echo 코드 붙여넣기 후 파일 저장을 했는지 확인하세요.
echo ========================================
echo.

echo [1/6] 프로젝트 폴더로 이동 중...
cd /d "%~dp0..\.."
if errorlevel 1 goto FAIL_PATH

echo [OK] 프로젝트 폴더 이동 완료
echo 현재 위치:
cd

echo.
echo [2/6] 현재 브랜치 확인 중...
for /f "tokens=*" %%i in ('git branch --show-current') do set CURRENT_BRANCH=%%i

if not "%CURRENT_BRANCH%"=="%BRANCH_NAME%" goto FAIL_BRANCH

echo [OK] 현재 브랜치: %CURRENT_BRANCH%

echo.
echo [3/6] 변경된 파일 확인 중...
git status --porcelain > "%TEMP%\hoi_git_status.txt"

for %%A in ("%TEMP%\hoi_git_status.txt") do set STATUS_SIZE=%%~zA

if "%STATUS_SIZE%"=="0" goto FAIL_NO_CHANGE

echo.
echo 변경된 파일 목록:
git status --short

echo.
set /p COMMIT_MSG=수정내용 제목을 입력하세요. 그냥 엔터 시 기본값 사용: 

if "%COMMIT_MSG%"=="" set COMMIT_MSG=BM 코드 수정 반영

echo.
echo [4/6] 변경내용 담는 중...
git add .
if errorlevel 1 goto FAIL_ADD

echo [OK] 변경내용 담기 완료

echo.
echo [5/6] 수정내용 기록 중...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 goto FAIL_COMMIT

echo [OK] 수정내용 기록 완료

echo.
echo [6/6] 원격 저장소에 올리는 중...
git push -u origin %BRANCH_NAME% --force-with-lease
if errorlevel 1 goto FAIL_PUSH

echo.
echo ========================================
echo [SUCCESS] 수정내용 올리기 완료
echo ========================================
echo.
echo 이제 개발자가 feature/bm 내용을 확인하면 됩니다.
echo GitHub에서 PR을 생성하거나 개발자에게 확인 요청하세요.
echo.
echo 브랜치: %BRANCH_NAME%
echo 제목: %COMMIT_MSG%
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

:FAIL_BRANCH
echo.
echo ========================================
echo [FAIL] 현재 작업 위치가 올바르지 않습니다.
echo 현재 브랜치: %CURRENT_BRANCH%
echo 필요한 브랜치: %BRANCH_NAME%
echo.
echo 먼저 01_새작업시작.bat 를 실행하세요.
echo ========================================
pause
exit /b 1

:FAIL_NO_CHANGE
echo.
echo ========================================
echo [FAIL] 수정된 내용이 없습니다.
echo 코드를 붙여넣고 저장한 뒤 다시 실행하세요.
echo ========================================
pause
exit /b 1

:FAIL_ADD
echo.
echo ========================================
echo [FAIL] 변경내용 담기 실패
echo git add 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1

:FAIL_COMMIT
echo.
echo ========================================
echo [FAIL] 수정내용 기록 실패
echo 커밋 처리 중 문제가 발생했습니다.
echo ========================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ========================================
echo [FAIL] 원격 저장소 올리기 실패
echo GitHub 권한 또는 인터넷 연결을 확인하세요.
echo ========================================
pause
exit /b 1