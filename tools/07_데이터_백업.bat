@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe"
set "TARGET_ADB_DEVICE=auto"
set "REMOTE_DATA_DIR=/storage/emulated/0/호이랜드"
set "LOCAL_DATA_DIR=data"
set "SOURCE_BRANCH=feature/hoi"
set "PROD_BRANCH=feature/prod"
set "SYNC_LOG=%TEMP%\hoibot_data_pull_%RANDOM%.log"
set "GIT_COMMIT_PREFIX=데이터: LDPlayer 운영 데이터 전체 최신화"

title hoiBot LDPlayer full data sync

echo.
echo ============================================================
echo  hoiBot LDPlayer 운영 데이터 전체 최신화
echo ============================================================
echo  운영 /storage/emulated/0/호이랜드/ 전체를 data\에 반영합니다.
echo  검증된 데이터 커밋을 feature/hoi에 먼저 push한 뒤
echo  같은 커밋을 feature/prod에 fast-forward push합니다.
echo  일관된 스냅샷을 위해 MessengerBot 데이터 쓰기를 멈춰 주세요.
echo ============================================================
echo.

choice /C YN /N /M "MessengerBot 데이터 쓰기를 멈췄습니까? [Y/N] "
if errorlevel 2 goto CANCELLED

cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH
if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_LOCAL_DATA

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RUN_TS=%%t"
set "PULL_ROOT=%TEMP%\hoibot_ld_data_%RUN_TS%_%RANDOM%"
set "PULLED_DATA_DIR=%PULL_ROOT%\호이랜드"
set "GIT_WORKTREE_DIR=%TEMP%\hoibot_data_git_%RUN_TS%_%RANDOM%"
set "DATA_COMMIT="
set "PULL_COUNT=0"

echo [1/7] 저장소와 data 작업상태 확인
echo ------------------------------------------------------------
git rev-parse --show-toplevel > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_GIT_REPO
git status --porcelain -- "%LOCAL_DATA_DIR%" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_GIT_STATUS
findstr "." "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_DIRTY_DATA
echo [OK] data\ 작업상태 깨끗함
echo.

echo [2/7] ADB device 확인
echo ------------------------------------------------------------
"%ADB_EXE%" devices
if errorlevel 1 goto FAIL_ADB
echo.

if /i "%TARGET_ADB_DEVICE%"=="auto" (
	set "DEVICE_COUNT=0"
	set "FIRST_DEVICE="
	for /f "skip=1 tokens=1,2" %%a in ('"%ADB_EXE%" devices') do (
		if "%%b"=="device" (
			set /a DEVICE_COUNT+=1
			if "!FIRST_DEVICE!"=="" set "FIRST_DEVICE=%%a"
		)
	)
	if "!DEVICE_COUNT!"=="0" goto FAIL_NO_DEVICE
	if not "!DEVICE_COUNT!"=="1" goto FAIL_MULTI_DEVICE
	set "TARGET_ADB_DEVICE=!FIRST_DEVICE!"
)
echo [OK] TARGET_ADB_DEVICE = %TARGET_ADB_DEVICE%
echo.

echo [3/7] LDPlayer 운영 데이터 폴더 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "ls -ld '%REMOTE_DATA_DIR%'" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_REMOTE_DATA
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_DATA
echo [OK] 운영 데이터 폴더 확인 완료
echo.

echo [4/7] 운영 데이터 전체 임시 가져오기
echo ------------------------------------------------------------
mkdir "%PULL_ROOT%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_ROOT
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" pull "%REMOTE_DATA_DIR%" "%PULL_ROOT%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_PULL
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_PULL
if not exist "%PULLED_DATA_DIR%\" set "PULLED_DATA_DIR=%PULL_ROOT%"
echo [OK] 운영 데이터 전체 가져오기 완료
echo.

echo [5/7] 파일·JSON UTF-8·파싱 검증
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:PULLED_DATA_DIR; $files=@(Get-ChildItem -LiteralPath $root -File -Recurse); if($files.Count -eq 0){Write-Output 'FAIL_NO_FILES'; exit 11}; $empty=@($files | Where-Object {$_.Length -le 0}); if($empty.Count -gt 0){$empty | ForEach-Object {Write-Output ('EMPTY=' + $_.FullName.Substring($root.Length).TrimStart('\'))}; exit 12}; $utf8=New-Object System.Text.UTF8Encoding($false,$true); $jsonFiles=@($files | Where-Object {$_.Extension -ieq '.json'}); foreach($file in $jsonFiles){try{$text=$utf8.GetString([System.IO.File]::ReadAllBytes($file.FullName))}catch{Write-Output ('INVALID_UTF8=' + $file.FullName.Substring($root.Length).TrimStart('\')); exit 13}; try{$null=$text | ConvertFrom-Json -ErrorAction Stop}catch{Write-Output ('INVALID_JSON=' + $file.FullName.Substring($root.Length).TrimStart('\')); exit 14}}; Write-Output ('PULL_COUNT=' + $files.Count); Write-Output ('JSON_COUNT=' + $jsonFiles.Count)" > "%SYNC_LOG%" 2>&1
set "VALIDATE_CODE=%ERRORLEVEL%"
type "%SYNC_LOG%"
if not "%VALIDATE_CODE%"=="0" goto FAIL_VALIDATE
for /f "tokens=2 delims==" %%c in ('findstr /b /c:"PULL_COUNT=" "%SYNC_LOG%"') do set "PULL_COUNT=%%c"
if "%PULL_COUNT%"=="0" goto FAIL_VALIDATE
echo [OK] 전체 파일 %PULL_COUNT%개 검증 완료
echo.

echo [6/7] feature/hoi 기록 후 feature/prod 반영
echo ------------------------------------------------------------
git fetch origin "%SOURCE_BRANCH%" "%PROD_BRANCH%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_FETCH
git merge-base --is-ancestor "origin/%SOURCE_BRANCH%" "origin/%PROD_BRANCH%" > nul 2>&1
if errorlevel 1 goto FAIL_SOURCE_DIVERGED
git worktree add --detach "%GIT_WORKTREE_DIR%" "origin/%PROD_BRANCH%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_WORKTREE
robocopy "%PULLED_DATA_DIR%" "%GIT_WORKTREE_DIR%\data" /MIR /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set "ROBOCOPY_CODE=%ERRORLEVEL%"
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_GIT_MIRROR
git -C "%GIT_WORKTREE_DIR%" add -A -- data > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_ADD
git -C "%GIT_WORKTREE_DIR%" ls-files --others --ignored --exclude-standard -- data > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_GIT_IGNORED_CHECK
findstr "." "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_GIT_IGNORED
git -C "%GIT_WORKTREE_DIR%" diff --cached --quiet -- data
set "DIFF_CODE=%ERRORLEVEL%"
if "%DIFF_CODE%"=="0" goto NO_GIT_CHANGES
if not "%DIFF_CODE%"=="1" goto FAIL_GIT_DIFF
git -C "%GIT_WORKTREE_DIR%" commit -m "%GIT_COMMIT_PREFIX% %RUN_TS%" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_GIT_COMMIT
for /f "usebackq delims=" %%h in (`git -C "%GIT_WORKTREE_DIR%" rev-parse HEAD`) do set "DATA_COMMIT=%%h"
git -C "%GIT_WORKTREE_DIR%" push origin HEAD:refs/heads/%SOURCE_BRANCH% > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_SOURCE_PUSH
git fetch origin "%SOURCE_BRANCH%" > nul 2>&1
for /f "usebackq delims=" %%h in (`git rev-parse "origin/%SOURCE_BRANCH%"`) do set "REMOTE_SOURCE_COMMIT=%%h"
if /i not "%DATA_COMMIT%"=="%REMOTE_SOURCE_COMMIT%" goto FAIL_SOURCE_VERIFY
git -C "%GIT_WORKTREE_DIR%" push origin HEAD:refs/heads/%PROD_BRANCH% > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_PROD_PUSH
git fetch origin "%PROD_BRANCH%" > nul 2>&1
for /f "usebackq delims=" %%h in (`git rev-parse "origin/%PROD_BRANCH%"`) do set "REMOTE_PROD_COMMIT=%%h"
if /i not "%DATA_COMMIT%"=="%REMOTE_PROD_COMMIT%" goto FAIL_PROD_VERIFY
echo [OK] feature/hoi push 완료: %DATA_COMMIT%
echo [OK] feature/prod 반영 완료: %DATA_COMMIT%
goto LOCAL_MIRROR

:NO_GIT_CHANGES
echo [OK] 원격 feature/prod와 data\ 내용이 같아 commit/push를 생략합니다.

:LOCAL_MIRROR
echo.
echo [7/7] 현재 저장소 data\ 전체 최신화
echo ------------------------------------------------------------
robocopy "%PULLED_DATA_DIR%" "%LOCAL_DATA_DIR%" /MIR /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set "ROBOCOPY_CODE=%ERRORLEVEL%"
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_LOCAL_MIRROR
echo [OK] 현재 저장소 data\ 전체 최신화 완료

:CLEANUP_SUCCESS
git worktree remove --force "%GIT_WORKTREE_DIR%" > nul 2>&1
rmdir /s /q "%PULL_ROOT%"
del /q "%SYNC_LOG%" > nul 2>&1
goto SUCCESS

:SUCCESS
echo.
echo ============================================================
echo  SUCCESS - LDPlayer 운영 데이터 전체 최신화 완료
echo ============================================================
echo  전체 파일 수: %PULL_COUNT%
echo  로컬 반영: %CD%\%LOCAL_DATA_DIR%
if defined DATA_COMMIT echo  Git commit: %DATA_COMMIT%
echo  원격 반영: feature/hoi -^> feature/prod
echo ============================================================
pause
exit /b 0

:CANCELLED
echo.
echo [CANCEL] MessengerBot 데이터 쓰기를 멈춘 뒤 다시 실행하세요.
pause
exit /b 2

:FAIL_PATH
echo [FAIL] 프로젝트 폴더 이동 실패
goto FAIL_END

:FAIL_ADB_EXE
echo [FAIL] ADB 파일 없음: %ADB_EXE%
goto FAIL_END

:FAIL_LOCAL_DATA
echo [FAIL] 로컬 data 폴더 없음: %LOCAL_DATA_DIR%
goto FAIL_END

:FAIL_GIT_REPO
echo [FAIL] 현재 경로가 Git 저장소가 아님
goto FAIL_END

:FAIL_GIT_STATUS
echo [FAIL] data\ 작업상태 확인 실패
goto FAIL_END

:FAIL_DIRTY_DATA
type "%SYNC_LOG%"
echo [FAIL] data\에 미정리 변경사항이 있어 중단함
goto FAIL_END

:FAIL_ADB
echo [FAIL] adb devices 실행 실패
goto FAIL_END

:FAIL_NO_DEVICE
echo [FAIL] 연결된 ADB 기기 없음
goto FAIL_END

:FAIL_MULTI_DEVICE
echo [FAIL] 연결된 ADB 기기가 2개 이상임
goto FAIL_END

:FAIL_REMOTE_DATA
echo [FAIL] 운영 데이터 폴더 확인 실패: %REMOTE_DATA_DIR%
goto FAIL_END

:FAIL_PULL_ROOT
echo [FAIL] 임시 가져오기 폴더 생성 실패: %PULL_ROOT%
goto FAIL_END

:FAIL_PULL
echo [FAIL] 운영 데이터 전체 가져오기 실패
goto FAIL_END

:FAIL_VALIDATE
echo [FAIL] 가져온 파일의 누락·빈 파일 또는 JSON UTF-8·파싱 검증 실패
goto FAIL_END

:FAIL_GIT_FETCH
echo [FAIL] 원격 feature/hoi 또는 feature/prod 갱신 실패
goto FAIL_END

:FAIL_SOURCE_DIVERGED
echo [FAIL] origin/feature/hoi가 origin/feature/prod와 분기되어 자동 반영할 수 없음
goto FAIL_END

:FAIL_GIT_WORKTREE
echo [FAIL] 임시 Git worktree 생성 실패: %GIT_WORKTREE_DIR%
goto FAIL_END

:FAIL_GIT_MIRROR
echo [FAIL] 임시 Git worktree data\ 최신화 실패
goto FAIL_END

:FAIL_GIT_ADD
echo [FAIL] data\ Git staging 실패
goto FAIL_END

:FAIL_GIT_IGNORED_CHECK
echo [FAIL] Git ignored 파일 확인 실패
goto FAIL_END

:FAIL_GIT_IGNORED
type "%SYNC_LOG%"
echo [FAIL] data\ 안에 Git에서 제외된 파일이 있어 전체 반영을 중단함
goto FAIL_END

:FAIL_GIT_DIFF
echo [FAIL] data\ staged diff 확인 실패
goto FAIL_END

:FAIL_GIT_COMMIT
echo [FAIL] 운영 데이터 commit 실패
goto FAIL_END

:FAIL_SOURCE_PUSH
echo [FAIL] feature/hoi push 실패
goto FAIL_END

:FAIL_SOURCE_VERIFY
echo [FAIL] origin/feature/hoi 원격 commit 검증 실패
goto FAIL_END

:FAIL_PROD_PUSH
echo [FAIL] feature/prod fast-forward push 실패
echo feature/hoi에는 검증된 데이터 commit이 보존되어 있습니다: %DATA_COMMIT%
goto FAIL_END

:FAIL_PROD_VERIFY
echo [FAIL] origin/feature/prod 원격 commit 검증 실패
goto FAIL_END

:FAIL_LOCAL_MIRROR
echo [FAIL] 원격 반영 후 현재 저장소 data\ 전체 최신화 실패
goto FAIL_END

:FAIL_END
echo 원본 운영 데이터는 변경하지 않았습니다.
if exist "%PULL_ROOT%\" echo 임시 pull 경로: %PULL_ROOT%
if exist "%GIT_WORKTREE_DIR%\" echo 임시 Git worktree: %GIT_WORKTREE_DIR%
pause
exit /b 1
