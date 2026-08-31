@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe"
set "TARGET_ADB_DEVICE=auto"
set "REMOTE_DATA_DIR=/storage/emulated/0/호이랜드"
set "SOURCE_BRANCH=feature/hoi"
set "PROD_BRANCH=feature/prod"
for %%I in ("%~dp0..") do set "TARGET_REPO=%%~fI"
set "LOCAL_DATA_DIR=%TARGET_REPO%\data"
set "DID_PUSHD=0"
set "DATA_REPLACED=0"

title hoiBot LDPlayer data pull and prod push

echo.
echo ============================================================
echo  hoiBot LDPlayer 운영 데이터 전체 내려받기 + PROD 반영
echo ============================================================
echo  %REMOTE_DATA_DIR% 전체를 ADB pull하여
echo  !LOCAL_DATA_DIR! 로 교체한 뒤
echo  data만 %SOURCE_BRANCH%와 %PROD_BRANCH%에 반영합니다.
echo  DB import와 main 브랜치 동기화는 수행하지 않습니다.
echo ============================================================
echo.

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_LOCAL_DATA
pushd "%TARGET_REPO%"
if errorlevel 1 goto FAIL_REPO_PATH
set "DID_PUSHD=1"

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RUN_TS=%%t"
set "PULL_ROOT=%TEMP%\hoibot_adb_pull_%RUN_TS%_%RANDOM%"
set "PULLED_DATA_DIR=%PULL_ROOT%\data"
set "INCOMING_DIR=%TARGET_REPO%\.hoibot_data_incoming_%RUN_TS%_%RANDOM%"
set "ROLLBACK_DIR=%TARGET_REPO%\.hoibot_data_rollback_%RUN_TS%_%RANDOM%"
set "FAILED_PULL_DIR=%TARGET_REPO%\.hoibot_data_failed_%RUN_TS%_%RANDOM%"
set "GIT_STATUS_FILE=%TEMP%\hoibot_git_status_%RUN_TS%_%RANDOM%.txt"

echo [1/7] Git 사전 안전 확인
echo ------------------------------------------------------------
for /f "delims=" %%b in ('git branch --show-current') do set "CURRENT_BRANCH=%%b"
if not "!CURRENT_BRANCH!"=="%SOURCE_BRANCH%" goto FAIL_SOURCE_BRANCH

git status --porcelain=v1 --untracked-files=all > "%GIT_STATUS_FILE%"
if errorlevel 1 goto FAIL_GIT_STATUS
for %%A in ("%GIT_STATUS_FILE%") do if not "%%~zA"=="0" goto FAIL_GIT_DIRTY

git fetch origin %SOURCE_BRANCH% %PROD_BRANCH%
if errorlevel 1 goto FAIL_GIT_FETCH
for /f %%h in ('git rev-parse HEAD') do set "START_HEAD=%%h"
for /f %%h in ('git rev-parse origin/%SOURCE_BRANCH%') do set "REMOTE_SOURCE_HEAD=%%h"
for /f %%h in ('git rev-parse origin/%PROD_BRANCH%') do set "REMOTE_PROD_HEAD=%%h"
if /i not "!START_HEAD!"=="!REMOTE_SOURCE_HEAD!" goto FAIL_GIT_BASE
if /i not "!START_HEAD!"=="!REMOTE_PROD_HEAD!" goto FAIL_GIT_BASE
echo [OK] clean %SOURCE_BRANCH% = origin/%SOURCE_BRANCH% = origin/%PROD_BRANCH%
echo.

if exist "%PULL_ROOT%\" goto FAIL_PATH_COLLISION
if exist "%INCOMING_DIR%\" goto FAIL_PATH_COLLISION
if exist "%ROLLBACK_DIR%\" goto FAIL_PATH_COLLISION
if exist "%FAILED_PULL_DIR%\" goto FAIL_PATH_COLLISION
mkdir "%PULL_ROOT%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_ROOT

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
echo [OK] TARGET_ADB_DEVICE = !TARGET_ADB_DEVICE!
echo.

echo [3/7] LDPlayer /호이랜드 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s "!TARGET_ADB_DEVICE!" shell "ls -ld '%REMOTE_DATA_DIR%'"
if errorlevel 1 goto FAIL_REMOTE_DATA
echo [OK] %REMOTE_DATA_DIR%
echo.

echo [4/7] /호이랜드 전체를 짧은 TEMP 경로로 ADB pull
echo ------------------------------------------------------------
"%ADB_EXE%" -s "!TARGET_ADB_DEVICE!" pull "%REMOTE_DATA_DIR%" "%PULLED_DATA_DIR%"
if errorlevel 1 goto FAIL_PULL
if not exist "%PULLED_DATA_DIR%\" goto FAIL_PULL

for /f %%c in ('powershell -NoProfile -Command "$files=@(Get-ChildItem -LiteralPath $env:PULLED_DATA_DIR -File -Recurse); Write-Output $files.Count"') do set "PULL_COUNT=%%c"
if not defined PULL_COUNT goto FAIL_PULL
if "!PULL_COUNT!"=="0" goto FAIL_PULL
echo [OK] /호이랜드 전체 !PULL_COUNT!개 TEMP 내려받기 완료
echo.

echo [5/7] 내려받은 전체 데이터로 저장소 data 교체
echo ------------------------------------------------------------
robocopy "%PULLED_DATA_DIR%" "%INCOMING_DIR%" /E /COPY:DAT /R:1 /W:1 > "%PULL_ROOT%\incoming_copy.log" 2>&1
set "ROBOCOPY_CODE=!ERRORLEVEL!"
if !ROBOCOPY_CODE! GEQ 8 goto FAIL_COPY

move "%LOCAL_DATA_DIR%" "%ROLLBACK_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_ROLLBACK
move "%INCOMING_DIR%" "%LOCAL_DATA_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_RESTORE
set "DATA_REPLACED=1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:ROLLBACK_DIR); $base=[IO.Path]::GetFullPath($env:TARGET_REPO + '\.hoibot_data_rollback_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 81}; Remove-Item -LiteralPath $p -Recurse -Force"
if errorlevel 1 echo [WARN] 이전 data 롤백 폴더 정리 실패: !ROLLBACK_DIR!
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:PULL_ROOT); $base=[IO.Path]::GetFullPath($env:TEMP + '\hoibot_adb_pull_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 82}; Remove-Item -LiteralPath $p -Recurse -Force"
if errorlevel 1 echo [WARN] TEMP 폴더 정리 실패: !PULL_ROOT!
echo [OK] 저장소 data 전체 교체 완료
echo.

echo [6/7] data-only 커밋 및 %SOURCE_BRANCH% push
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lines=@(git -c core.quotepath=false status --porcelain=v1 --untracked-files=all); if($LASTEXITCODE -ne 0){exit 91}; if($lines.Count -eq 0){exit 92}; foreach($line in $lines){if($line.Length -lt 4){exit 93}; $p=$line.Substring(3).Trim([char]34); if($p.Contains(' -> ')){$p=$p.Substring($p.LastIndexOf(' -> ') + 4).Trim([char]34)}; if(-not ($p -eq 'data' -or $p.StartsWith('data/'))){exit 94}}"
set "DATA_STATUS_CODE=!ERRORLEVEL!"
if "!DATA_STATUS_CODE!"=="92" goto NO_DATA_CHANGES
if not "!DATA_STATUS_CODE!"=="0" goto FAIL_NON_DATA_CHANGE

git add -A -- data
if errorlevel 1 goto FAIL_GIT_ADD
git diff --cached --quiet -- data
if not errorlevel 1 goto NO_DATA_CHANGES

git commit -m "운영 데이터 스냅샷 %RUN_TS%"
if errorlevel 1 goto FAIL_GIT_COMMIT
for /f %%h in ('git rev-parse HEAD') do set "SNAPSHOT_COMMIT=%%h"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$names=@(git -c core.quotepath=false diff-tree --no-commit-id --name-only -r HEAD); if($LASTEXITCODE -ne 0 -or $names.Count -eq 0){exit 95}; foreach($p in $names){if(-not ($p -eq 'data' -or $p.StartsWith('data/'))){exit 96}}"
if errorlevel 1 goto FAIL_COMMIT_SCOPE

git push origin %SOURCE_BRANCH%
if errorlevel 1 goto FAIL_SOURCE_PUSH
git fetch origin %SOURCE_BRANCH%
if errorlevel 1 goto FAIL_GIT_FETCH
for /f %%h in ('git rev-parse origin/%SOURCE_BRANCH%') do set "REMOTE_SOURCE_HEAD=%%h"
if /i not "!SNAPSHOT_COMMIT!"=="!REMOTE_SOURCE_HEAD!" goto FAIL_SOURCE_VERIFY
echo [OK] origin/%SOURCE_BRANCH% = !SNAPSHOT_COMMIT!
goto REFLECT_PROD

:NO_DATA_CHANGES
git reset > nul 2>&1
set "SNAPSHOT_COMMIT=!START_HEAD!"
echo [INFO] data 변경 없음 - 기존 원격 commit을 검증합니다.

:REFLECT_PROD
echo.
echo [7/7] 동일 commit을 %PROD_BRANCH%에 반영 및 원격 검증
echo ------------------------------------------------------------
git fetch origin %PROD_BRANCH%
if errorlevel 1 goto FAIL_GIT_AFTER_DATA
git switch %PROD_BRANCH%
if errorlevel 1 goto FAIL_PROD_SWITCH
git merge --ff-only origin/%PROD_BRANCH%
if errorlevel 1 goto FAIL_PROD_SYNC
git merge --ff-only !SNAPSHOT_COMMIT!
if errorlevel 1 goto FAIL_PROD_REFLECT
git push origin %PROD_BRANCH%
if errorlevel 1 goto FAIL_PROD_PUSH
git fetch origin %PROD_BRANCH%
if errorlevel 1 goto FAIL_GIT_AFTER_DATA
for /f %%h in ('git rev-parse origin/%PROD_BRANCH%') do set "REMOTE_PROD_HEAD=%%h"
if /i not "!SNAPSHOT_COMMIT!"=="!REMOTE_PROD_HEAD!" goto FAIL_PROD_VERIFY
git switch %SOURCE_BRANCH%
if errorlevel 1 goto FAIL_RETURN_SOURCE
echo [OK] origin/%PROD_BRANCH% = !SNAPSHOT_COMMIT!
goto SUCCESS

:FAIL_PULL_RESTORE
if exist "%LOCAL_DATA_DIR%\" move "%LOCAL_DATA_DIR%" "%FAILED_PULL_DIR%" > nul 2>&1
if exist "%ROLLBACK_DIR%\" move "%ROLLBACK_DIR%" "%LOCAL_DATA_DIR%" > nul 2>&1
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_RESTORE_FATAL
echo [FAIL] ADB pull 또는 data 교체 실패 - 기존 data 자동 복원 완료
goto FAIL_END

:SUCCESS
if exist "%GIT_STATUS_FILE%" del /q "%GIT_STATUS_FILE%" > nul 2>&1
echo.
echo ============================================================
echo  SUCCESS - 운영 데이터 pull + PROD 반영 완료
echo ============================================================
echo  내려받은 파일: !PULL_COUNT!개
echo  대상 data: !LOCAL_DATA_DIR!
echo  source/prod commit: !SNAPSHOT_COMMIT!
echo ============================================================
goto SUCCESS_END

:FAIL_ADB_EXE
echo [FAIL] ADB 파일 없음: %ADB_EXE%
goto FAIL_END
:FAIL_LOCAL_DATA
echo [FAIL] 기존 data 폴더 없음: !LOCAL_DATA_DIR!
goto FAIL_END
:FAIL_REPO_PATH
echo [FAIL] 저장소 경로 이동 실패: !TARGET_REPO!
goto FAIL_END
:FAIL_SOURCE_BRANCH
echo [FAIL] 시작 브랜치는 %SOURCE_BRANCH%여야 합니다. 현재: !CURRENT_BRANCH!
goto FAIL_END
:FAIL_GIT_STATUS
echo [FAIL] Git 상태 확인 실패
goto FAIL_END
:FAIL_GIT_DIRTY
echo [FAIL] 실행 전 working tree가 깨끗하지 않습니다. 01로 최신화한 뒤 다시 실행하세요.
goto FAIL_END
:FAIL_GIT_FETCH
echo [FAIL] 원격 Git 정보 갱신 실패
if "!DATA_REPLACED!"=="1" goto FAIL_GIT_AFTER_DATA
goto FAIL_END
:FAIL_GIT_BASE
echo [FAIL] HEAD, origin/%SOURCE_BRANCH%, origin/%PROD_BRANCH%가 일치하지 않습니다. 01을 먼저 실행하세요.
goto FAIL_END
:FAIL_PATH_COLLISION
echo [FAIL] 임시 또는 롤백 경로가 이미 존재함
goto FAIL_END
:FAIL_PULL_ROOT
echo [FAIL] TEMP 폴더 생성 실패: !PULL_ROOT!
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
echo [FAIL] LDPlayer 경로 확인 실패: %REMOTE_DATA_DIR%
goto FAIL_END
:FAIL_PULL
echo [FAIL] /호이랜드 전체 TEMP ADB pull 실패
goto FAIL_END
:FAIL_COPY
echo [FAIL] 내려받은 데이터의 저장소 교체 후보 복사 실패
goto FAIL_END
:FAIL_ROLLBACK
echo [FAIL] 기존 data 롤백 보관 실패
goto FAIL_END
:FAIL_NON_DATA_CHANGE
echo [FAIL] data 외 변경이 감지되어 Git 반영을 중단합니다.
goto FAIL_GIT_AFTER_DATA
:FAIL_GIT_ADD
echo [FAIL] data stage 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_GIT_COMMIT
echo [FAIL] data snapshot commit 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_COMMIT_SCOPE
echo [FAIL] 생성된 commit에 data 외 파일이 포함되어 반영을 중단합니다.
goto FAIL_GIT_AFTER_DATA
:FAIL_SOURCE_PUSH
echo [FAIL] origin/%SOURCE_BRANCH% push 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_SOURCE_VERIFY
echo [FAIL] origin/%SOURCE_BRANCH% commit SHA 검증 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_PROD_SWITCH
echo [FAIL] %PROD_BRANCH% 전환 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_PROD_SYNC
echo [FAIL] %PROD_BRANCH% 최신화 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_PROD_REFLECT
echo [FAIL] 동일 source commit을 %PROD_BRANCH%에 fast-forward 반영할 수 없습니다.
goto FAIL_GIT_AFTER_DATA
:FAIL_PROD_PUSH
echo [FAIL] origin/%PROD_BRANCH% push 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_PROD_VERIFY
echo [FAIL] origin/%PROD_BRANCH% commit SHA 검증 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_RETURN_SOURCE
echo [FAIL] 반영 후 %SOURCE_BRANCH% 복귀 실패
goto FAIL_GIT_AFTER_DATA
:FAIL_RESTORE_FATAL
echo [CRITICAL] 기존 data 자동 복원 실패
echo [CRITICAL] 롤백 폴더: !ROLLBACK_DIR!
echo [CRITICAL] 실패한 pull 보존 폴더: !FAILED_PULL_DIR!
goto FAIL_END

:FAIL_GIT_AFTER_DATA
for /f "delims=" %%b in ('git branch --show-current') do set "CURRENT_BRANCH=%%b"
if "!CURRENT_BRANCH!"=="%PROD_BRANCH%" git switch %SOURCE_BRANCH% > nul 2>&1
echo [FAIL] data 로컬 교체는 완료됐지만 Git/PROD 반영은 완료되지 않았습니다.
goto FAIL_END

:FAIL_END
if exist "%GIT_STATUS_FILE%" del /q "%GIT_STATUS_FILE%" > nul 2>&1
echo 운영 원본과 DB는 변경하지 않았습니다.
if defined PULL_ROOT if exist "%PULL_ROOT%\" echo TEMP 진단 경로: !PULL_ROOT!
if defined INCOMING_DIR if exist "%INCOMING_DIR%\" echo 교체 후보 보존 경로: !INCOMING_DIR!
if "%DID_PUSHD%"=="1" popd > nul 2>&1
pause
exit /b 1

:SUCCESS_END
if "%DID_PUSHD%"=="1" popd > nul 2>&1
pause
exit /b 0
