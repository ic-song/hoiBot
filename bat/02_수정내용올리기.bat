@echo off
chcp 65001 > nul

set BRANCH_NAME=feature/bm
set BASE_BRANCH=main

echo.
echo ========================================
echo [START] 수정내용 올리기
echo ========================================
echo.
echo 이 작업은 현재 수정한 내용을 저장소에 올리고
echo PR 요청까지 자동으로 진행합니다.
echo 코드 붙여넣기 후 파일 저장을 했는지 확인하세요.
echo ========================================
echo.

echo [1/7] 프로젝트 폴더로 이동 중...
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [OK] 프로젝트 폴더 이동 완료
echo 현재 위치:
cd

echo.
echo Git 작성자 정보 설정 중...
git config user.name "jinminy2"
git config user.email "jinminy2@gmail.com"
if errorlevel 1 goto FAIL_GIT_CONFIG

echo [OK] Git 작성자 정보 설정 완료

echo.
echo [2/7] 현재 브랜치 확인 중...
for /f "tokens=*" %%i in ('git branch --show-current') do set CURRENT_BRANCH=%%i

if not "%CURRENT_BRANCH%"=="%BRANCH_NAME%" goto FAIL_BRANCH

echo [OK] 현재 브랜치: %CURRENT_BRANCH%

echo.
echo [3/7] 변경된 파일 확인 중...
git status --porcelain > "%TEMP%\hoi_git_status.txt"

for %%A in ("%TEMP%\hoi_git_status.txt") do set STATUS_SIZE=%%~zA

if "%STATUS_SIZE%"=="0" goto FAIL_NO_CHANGE

echo.
echo 변경된 파일 목록:
git status --short

echo.
set /p WORK_MSG=수정내용 제목을 입력하세요. 그냥 엔터 시 기본값 사용: 

if "%WORK_MSG%"=="" set WORK_MSG=BM 코드 수정 반영

set COMMIT_MSG=%WORK_MSG%
set PR_TITLE=%WORK_MSG%
set PR_BODY=%WORK_MSG%

echo.
echo [4/7] 변경내용 담는 중...
git add .
if errorlevel 1 goto FAIL_ADD

echo [OK] 변경내용 담기 완료

echo.
echo [5/7] 수정내용 기록 중...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 goto FAIL_COMMIT

echo [OK] 수정내용 기록 완료

echo.
echo [6/7] 원격 저장소에 올리는 중...
git push -u origin %BRANCH_NAME% --force-with-lease
if errorlevel 1 goto FAIL_PUSH

echo [OK] 원격 저장소 올리기 완료

echo.
echo [7/7] PR 요청 생성 중...
where gh > nul 2>&1
if errorlevel 1 goto FAIL_GH

gh pr create --base %BASE_BRANCH% --head %BRANCH_NAME% --title "%PR_TITLE%" --body "%PR_BODY%"
if errorlevel 1 goto FAIL_PR

echo.
echo ========================================
echo [SUCCESS] 수정내용 올리기 + PR 요청 완료
echo ========================================
echo.
echo 브랜치: %BRANCH_NAME%
echo 커밋 제목: %COMMIT_MSG%
echo PR 제목: %PR_TITLE%
echo PR 내용: %PR_BODY%
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

:FAIL_GIT_CONFIG
echo.
echo ========================================
echo [FAIL] Git 작성자 정보 설정 실패
echo user.name / user.email 설정 중 문제가 발생했습니다.
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

:FAIL_GH
echo.
echo ========================================
echo [FAIL] GitHub CLI(gh)를 찾을 수 없습니다.
echo gh 설치 후 다시 실행하세요.
echo ========================================
pause
exit /b 1

:FAIL_PR
echo.
echo ========================================
echo [FAIL] PR 요청 생성 실패
echo gh 로그인 상태 또는 저장소 권한을 확인하세요.
echo ========================================
pause
exit /b 1
