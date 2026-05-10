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
set /p COMMIT_MSG=수정내용 제목을 입력하세요. 그냥 엔터 시 기본값 사용: 

if "%COMMIT_MSG%"=="" set COMMIT_MSG=BM 코드 수정 반영

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

echo [OK] 원격 저장소 업로드 완료

echo.
echo [7/7] PR 생성 요청 중...

where gh >nul 2>nul
if errorlevel 1 goto FAIL_GH_NOT_FOUND

gh auth status >nul 2>nul
if errorlevel 1 goto FAIL_GH_AUTH

echo.
set /p PR_TITLE=PR 제목을 입력하세요. 그냥 엔터 시 커밋 제목 사용: 

if "%PR_TITLE%"=="" set PR_TITLE=%COMMIT_MSG%

echo.
set /p PR_BODY=PR 설명을 입력하세요. 그냥 엔터 시 기본값 사용: 

if "%PR_BODY%"=="" set PR_BODY=BM 코드 수정 반영 요청드립니다.

echo.
echo PR 생성 중...

gh pr create ^
  --base main ^
  --head %BRANCH_NAME% ^
  --title "%PR_TITLE%" ^
  --body "%PR_BODY%"

if errorlevel 1 goto FAIL_PR

echo.
echo ========================================
echo [SUCCESS] 수정내용 올리기 및 PR 생성 완료
echo ========================================
echo.
echo 브랜치: %BRANCH_NAME%
echo 커밋 제목: %COMMIT_MSG%
echo PR 제목: %PR_TITLE%
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

:FAIL_GH_NOT_FOUND
echo.
echo ========================================
echo [FAIL] GitHub CLI를 찾을 수 없습니다.
echo 먼저 GitHub CLI(gh)를 설치하세요.
echo ========================================
pause
exit /b 1

:FAIL_GH_AUTH
echo.
echo ========================================
echo [FAIL] GitHub CLI 로그인이 필요합니다.
echo 아래 명령어로 로그인하세요:
echo gh auth login
echo ========================================
pause
exit /b 1

:FAIL_PR
echo.
echo ========================================
echo [FAIL] PR 생성 실패
echo 이미 PR이 있거나 GitHub 권한 문제가 있을 수 있습니다.
echo ========================================
pause
exit /b 1