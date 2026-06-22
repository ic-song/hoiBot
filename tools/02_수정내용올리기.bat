@echo off
chcp 65001 > nul
if not "%HOIBOT_TOOL_LOG_ACTIVE%"=="1" (
	set "HOIBOT_TOOL_LOG_ACTIVE=1"
	set "HOIBOT_TOOL_LOG_DIR=%~dp0logs"
	set "HOIBOT_TOOL_LOG_SCRIPT=%~f0"
	if not exist "%~dp0logs" mkdir "%~dp0logs" > nul 2>&1
	for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "HOIBOT_TOOL_LOG_FILE=%~dp0logs\%~n0_%%t.log"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$script=$env:HOIBOT_TOOL_LOG_SCRIPT; $log=$env:HOIBOT_TOOL_LOG_FILE; & $script 2>&1 | Tee-Object -FilePath $log; $code=$LASTEXITCODE; $toolDir=Split-Path -Parent $script; $helper=Join-Path $toolDir '_push_tool_log.ps1'; $repoRoot=Resolve-Path (Join-Path $toolDir '..'); if (Test-Path $helper) { & $helper -RepoRoot $repoRoot -LogPath $log -Branch 'feature/tool-logs' }; exit $code"
	exit /b %ERRORLEVEL%
)

set BRANCH_NAME=feature/hoi
set BASE_BRANCH=feature/prod

title hoiBot workflow 02 - 수정내용 올리기

echo.
echo ============================================================
echo  hoiBot Workflow 02 - 수정내용 올리기
echo ============================================================
echo.
echo  작업 브랜치 : %BRANCH_NAME%
echo  운영 브랜치 : %BASE_BRANCH%
echo.
echo  현재 수정한 내용을 커밋/푸시한 뒤
echo  %BASE_BRANCH% 직접 병합과 push까지 진행합니다.
echo.
echo  코드 붙여넣기 후 파일 저장을 했는지 확인하세요.
echo ============================================================
echo.

echo [STEP 1/7] 프로젝트 폴더 이동
echo ------------------------------------------------------------
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH

echo [OK] PROJECT_DIR
cd

echo.
echo [SETUP] Git 작성자 정보 설정
echo ------------------------------------------------------------
git config user.name "jinminy2"
git config user.email "jinminy2@gmail.com"
if errorlevel 1 goto FAIL_GIT_CONFIG

echo [OK] git author ready

echo.
echo [STEP 2/7] 현재 브랜치 확인
echo ------------------------------------------------------------
for /f "tokens=*" %%i in ('git branch --show-current') do set CURRENT_BRANCH=%%i

if not "%CURRENT_BRANCH%"=="%BRANCH_NAME%" (
  git switch %BRANCH_NAME%
  if errorlevel 1 goto FAIL_BRANCH_SWITCH
)

git fetch origin
if errorlevel 1 goto FAIL_FETCH
echo.

git merge --ff-only origin/%BASE_BRANCH%
if errorlevel 1 goto FAIL_BASE_SYNC
echo.

for /f "tokens=*" %%i in ('git branch --show-current') do set CURRENT_BRANCH=%%i

if not "%CURRENT_BRANCH%"=="%BRANCH_NAME%" goto FAIL_BRANCH

echo [OK] 현재 브랜치: %CURRENT_BRANCH%

echo.
echo [STEP 3/7] 변경 파일 확인
echo ------------------------------------------------------------
git status --porcelain > "%TEMP%\hoi_git_status.txt"

for %%A in ("%TEMP%\hoi_git_status.txt") do set STATUS_SIZE=%%~zA

if "%STATUS_SIZE%"=="0" goto FAIL_NO_CHANGE

echo.
echo 변경된 파일 목록:
git status --short

echo.
set /p "WORK_MSG=수정내용 제목을 입력하세요. 그냥 엔터 시 기본값 사용 > "

if "%WORK_MSG%"=="" set WORK_MSG=BM 코드 수정 반영

set COMMIT_MSG=%WORK_MSG%

echo.
echo [STEP 4/7] 변경내용 담기
echo ------------------------------------------------------------
git add .
if errorlevel 1 goto FAIL_ADD

echo [OK] 변경내용 담기 완료

echo.
echo [STEP 5/7] 수정내용 기록
echo ------------------------------------------------------------
git commit -m "%COMMIT_MSG%"
if errorlevel 1 goto FAIL_COMMIT

echo [OK] 수정내용 기록 완료

echo.
echo [STEP 6/7] 원격 저장소 올리기
echo ------------------------------------------------------------
git push -u origin %BRANCH_NAME% --force-with-lease
if errorlevel 1 goto FAIL_PUSH

echo [OK] 원격 저장소 올리기 완료

echo.
echo [STEP 7/7] %BASE_BRANCH% 직접 병합 및 push
echo ------------------------------------------------------------
git switch %BASE_BRANCH%
if errorlevel 1 goto FAIL_PROD_SWITCH
echo.

git pull origin %BASE_BRANCH%
if errorlevel 1 goto FAIL_PROD_PULL
echo.

git merge %BRANCH_NAME%
if errorlevel 1 goto FAIL_PROD_MERGE
echo.

git push origin %BASE_BRANCH%
if errorlevel 1 goto FAIL_PROD_PUSH

echo.
echo ============================================================
echo  SUCCESS - 수정내용 올리기 + %BASE_BRANCH% 반영 완료
echo ============================================================
echo.
echo  작업 브랜치 : %BRANCH_NAME%
echo  커밋 제목   : %COMMIT_MSG%
echo  운영 반영   : %BASE_BRANCH% push complete
echo ============================================================
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

:FAIL_BRANCH_SWITCH
echo.
echo ========================================
echo [FAIL] feature/hoi branch switch failed.
echo Run 01 first, or check branch state.
echo ========================================
pause
exit /b 1

:FAIL_FETCH
echo.
echo ========================================
echo [FAIL] git fetch origin failed.
echo Check network or GitHub permission.
echo ========================================
pause
exit /b 1

:FAIL_BASE_SYNC
echo.
echo ========================================
echo [FAIL] feature/hoi could not fast-forward from origin/feature/prod.
echo Resolve branch divergence or conflicts first.
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

:FAIL_PROD_SWITCH
echo.
echo ========================================
echo [FAIL] feature/prod branch switch failed.
echo Check feature/prod branch state.
echo ========================================
pause
exit /b 1

:FAIL_PROD_PULL
echo.
echo ========================================
echo [FAIL] feature/prod pull failed.
echo Check conflicts, network, or GitHub permission.
echo ========================================
pause
exit /b 1

:FAIL_PROD_MERGE
echo.
echo ========================================
echo [FAIL] feature/hoi merge into feature/prod failed.
echo Resolve merge conflicts before pushing prod.
echo ========================================
pause
exit /b 1

:FAIL_PROD_PUSH
echo.
echo ========================================
echo [FAIL] feature/prod push failed.
echo Check GitHub permission or remote branch state.
echo ========================================
pause
exit /b 1
