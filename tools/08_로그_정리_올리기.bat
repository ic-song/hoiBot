@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set BASE_BRANCH=feature/prod
set LOG_DIR=tools\logs
set COMMIT_MESSAGE=정리: 도구 실행 로그 제거

title hoiBot tool logs cleanup

echo.
echo ============================================================
echo  hoiBot Workflow 08 - 로그 정리 올리기
echo ============================================================
echo.
echo  logs 폴더의 .log 파일을 모두 제거하고
echo  %BASE_BRANCH% 브랜치에 commit/push 합니다.
echo.
echo  .gitkeep 파일은 폴더 유지를 위해 남깁니다.
echo ============================================================
echo.

set /p "CONFIRM=계속 진행하려면 CLEAN 을 입력한 뒤 Enter를 누르세요. > "
if /I not "%CONFIRM%"=="CLEAN" goto CANCEL

echo.
echo [STEP 1/6] 프로젝트 폴더 이동
echo ------------------------------------------------------------
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH
echo [OK] PROJECT_DIR
cd

echo.
echo [STEP 2/6] Git 작성자 정보 설정
echo ------------------------------------------------------------
git config user.name > nul 2>&1
if errorlevel 1 git config user.name "hoiBot operator"
git config user.email > nul 2>&1
if errorlevel 1 git config user.email "hoibot-operator@example.local"
echo [OK] git author ready

echo.
echo [STEP 3/6] %BASE_BRANCH% 최신화
echo ------------------------------------------------------------
git fetch origin
if errorlevel 1 goto FAIL_FETCH
git switch %BASE_BRANCH%
if errorlevel 1 goto FAIL_BRANCH
git pull --ff-only origin %BASE_BRANCH%
if errorlevel 1 goto FAIL_PULL
echo [OK] %BASE_BRANCH% ready

echo.
echo [STEP 4/6] logs 폴더 정리
echo ------------------------------------------------------------
if not exist "%LOG_DIR%\" mkdir "%LOG_DIR%" > nul 2>&1
if not exist "%LOG_DIR%\.gitkeep" (
	type nul > "%LOG_DIR%\.gitkeep"
)

set REMOVED_LOGS=0
for /f "delims=" %%f in ('git ls-files "%LOG_DIR%/*.log"') do (
	echo [REMOVE tracked] %%f
	git rm -f -- "%%f"
	if errorlevel 1 goto FAIL_REMOVE
	set /a REMOVED_LOGS+=1
)

for %%f in ("%LOG_DIR%\*.log") do (
	if exist "%%~f" (
		echo [REMOVE local] %%~f
		del /f /q "%%~f"
		if errorlevel 1 goto FAIL_REMOVE
		set /a REMOVED_LOGS+=1
	)
)
echo [OK] removed log files: !REMOVED_LOGS!

echo.
echo [STEP 5/6] 변경사항 확인 및 commit
echo ------------------------------------------------------------
git add "%LOG_DIR%\.gitkeep"
if errorlevel 1 goto FAIL_ADD
git status --porcelain "%LOG_DIR%"
git status --porcelain "%LOG_DIR%" | findstr "." > nul 2>&1
if errorlevel 1 (
	echo [OK] 정리할 로그 변경사항이 없습니다.
	goto SUCCESS
)

git commit -m "%COMMIT_MESSAGE%"
if errorlevel 1 goto FAIL_COMMIT

echo.
echo [STEP 6/6] Git push
echo ------------------------------------------------------------
git push origin %BASE_BRANCH%
if errorlevel 1 goto FAIL_PUSH
echo [OK] Git push 완료: %BASE_BRANCH%

:SUCCESS
echo.
echo ============================================================
echo  SUCCESS - 로그 정리 완료
echo ============================================================
echo  남은 파일: %LOG_DIR%\.gitkeep
echo  대상 브랜치: %BASE_BRANCH%
echo ============================================================
pause
exit /b 0

:CANCEL
echo.
echo ============================================================
echo  CANCEL - 로그 정리가 취소되었습니다.
echo ============================================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ============================================================
echo  FAIL - 프로젝트 폴더 이동 실패
echo ============================================================
echo  BAT 파일 위치가 hoiBot\tools\ 인지 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_FETCH
echo.
echo ============================================================
echo  FAIL - 원격 저장소 정보 갱신 실패
echo ============================================================
pause
exit /b 1

:FAIL_BRANCH
echo.
echo ============================================================
echo  FAIL - %BASE_BRANCH% 브랜치 이동 실패
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

:FAIL_REMOVE
echo.
echo ============================================================
echo  FAIL - 로그 파일 제거 실패
echo ============================================================
pause
exit /b 1

:FAIL_ADD
echo.
echo ============================================================
echo  FAIL - Git add 실패
echo ============================================================
pause
exit /b 1

:FAIL_COMMIT
echo.
echo ============================================================
echo  FAIL - Git commit 실패
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - Git push 실패
echo ============================================================
echo  GitHub 권한 또는 네트워크 상태를 확인하세요.
echo ============================================================
pause
exit /b 1
