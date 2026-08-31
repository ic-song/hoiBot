@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe"
set "TARGET_ADB_DEVICE=auto"
set "REMOTE_DATA_DIR=/storage/emulated/0/호이랜드"
set "TARGET_REPO=C:\Users\user\Desktop\hoiBot"
set "LOCAL_DATA_ABS=%TARGET_REPO%\data"
set "SNAPSHOT_BASE=%LOCALAPPDATA%\hoiBot\raw-snapshots"
set "MANIFEST_TOOL=%~dp007_raw_snapshot_manifest.ps1"
set "REQUIRED_JSON_FILES=member.json;board.json;carrotBoard.json;itemInfo.json;trialTowerBoss.json;eventTowerBoss.json;castleBattle2.json;errorLog.json;member_title.json;pet_title.json;miniPet_title.json;miniPet_collection.json;miniPetCollectionInfo.json;member_pet.json;petSkillData.json;punchRankData.json;trialTower.json;miniPetData.json;petSweetHomeInfo.json;petSweetHomeData.json;petHomePlacedFurniture.json;petHomeComments.json;petHomeActivityData.json;petExploreData.json;attendanceLight.json;itemList.json;hoiBotChangeLog.json;freeMarket.json;packageInfo.json;packageLog.json;currencyLog.json;guildData.json;requestMonitorConfig.json"
set "PULL_ROOT="
set "SNAPSHOT_ROOT="
set "INCOMING_DIR="
set "ROLLBACK_DIR="
set "FAILED_NEW_DIR="

title hoiBot LDPlayer immutable RAW snapshot

echo.
echo ============================================================
echo  hoiBot LDPlayer 운영 데이터 RAW 스냅샷 및 로컬 적재
echo ============================================================
echo  운영 호이랜드 전체를 읽기 전용으로 가져옵니다.
echo  원본 전/후와 TEMP의 경로, 크기, SHA256이 같을 때만
echo  C:\Users\user\Desktop\hoiBot\data 를 완전 교체합니다.
echo  Git commit/push, 외부 업로드, DB import는 수행하지 않습니다.
echo  일관된 스냅샷을 위해 MessengerBot 데이터 쓰기를 멈춰 주세요.
echo ============================================================
echo.

choice /C YN /N /M "MessengerBot 데이터 쓰기를 멈췄습니까? [Y/N] "
if errorlevel 2 goto CANCELLED

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%MANIFEST_TOOL%" goto FAIL_MANIFEST_TOOL
if not exist "%LOCAL_DATA_ABS%\" goto FAIL_LOCAL_DATA

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RUN_TS=%%t"
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format o"') do set "CAPTURED_AT=%%t"
set "SNAPSHOT_ID=hoibot_%RUN_TS%_%RANDOM%"
set "PULL_ROOT=%TEMP%\hoibot_raw_capture_%SNAPSHOT_ID%"
set "PULLED_DATA_DIR=%PULL_ROOT%\raw"
set "SNAPSHOT_ROOT=%SNAPSHOT_BASE%\%SNAPSHOT_ID%"
set "INCOMING_DIR=%TARGET_REPO%\.hoibot_data_incoming_%SNAPSHOT_ID%"
set "ROLLBACK_DIR=%TARGET_REPO%\.hoibot_data_rollback_%SNAPSHOT_ID%"
set "FAILED_NEW_DIR=%TARGET_REPO%\.hoibot_data_failed_%SNAPSHOT_ID%"
set "LOCAL_VERIFY_MANIFEST=%TEMP%\hoibot_local_verify_%SNAPSHOT_ID%.json"

if exist "%PULL_ROOT%\" goto FAIL_PATH_COLLISION
if exist "%SNAPSHOT_ROOT%\" goto FAIL_PATH_COLLISION
if exist "%INCOMING_DIR%\" goto FAIL_PATH_COLLISION
if exist "%ROLLBACK_DIR%\" goto FAIL_PATH_COLLISION
mkdir "%PULL_ROOT%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_ROOT

echo [1/7] ADB device 확인
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
echo [OK] ADB device 1개 확인 완료
echo.

echo [2/7] 운영 원본 before manifest 생성
echo ------------------------------------------------------------
set "CAPTURE_NAME=before"
call :CAPTURE_REMOTE_MANIFEST
if errorlevel 1 goto FAIL_REMOTE_STATS
echo [OK] before 경로, 크기, SHA256 manifest 생성 완료
echo.

echo [3/7] 운영 데이터 전체 TEMP 가져오기
echo ------------------------------------------------------------
rem 목적지 raw 폴더는 미리 만들지 않아 ADB 결과 경로를 고정합니다.
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" pull "%REMOTE_DATA_DIR%" "%PULLED_DATA_DIR%" > "%PULL_ROOT%\adb_pull.stdout.txt" 2> "%PULL_ROOT%\adb_pull.stderr.txt"
set "PULL_EXIT=%ERRORLEVEL%"
> "%PULL_ROOT%\adb_pull.exit.txt" echo %PULL_EXIT%
if not "%PULL_EXIT%"=="0" goto FAIL_PULL
if not exist "%PULLED_DATA_DIR%\" goto FAIL_PULL_VERIFY
echo [OK] TEMP 가져오기 완료
echo.

echo [4/7] TEMP manifest 및 필수 JSON 검증
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode BuildLocal -Root "%PULLED_DATA_DIR%" -OutputPath "%PULL_ROOT%\temp.manifest.json" -SnapshotId "%SNAPSHOT_ID%" -CapturedAt "%CAPTURED_AT%" > "%PULL_ROOT%\temp_manifest.summary.txt" 2> "%PULL_ROOT%\temp_manifest.stderr.txt"
if errorlevel 1 goto FAIL_VALIDATE
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode Compare -LeftPath "%PULL_ROOT%\remote_before.manifest.json" -RightPath "%PULL_ROOT%\temp.manifest.json" > "%PULL_ROOT%\before_temp_parity.summary.txt" 2> "%PULL_ROOT%\before_temp_parity.stderr.txt"
if errorlevel 1 goto FAIL_REMOTE_STAGING_PARITY
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode CheckRequired -Root "%PULLED_DATA_DIR%" -RequiredFiles "%REQUIRED_JSON_FILES%" > "%PULL_ROOT%\required.summary.txt" 2> "%PULL_ROOT%\required.stderr.txt"
if errorlevel 1 goto FAIL_REQUIRED
echo [OK] before/TEMP 경로, 크기, SHA256 일치
echo [OK] 필수 JSON 33개 중 누락 0개
echo.

echo [5/7] 운영 원본 after manifest 및 변경 여부 확인
echo ------------------------------------------------------------
set "CAPTURE_NAME=after"
call :CAPTURE_REMOTE_MANIFEST
if errorlevel 1 goto FAIL_REMOTE_STATS
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode Compare -LeftPath "%PULL_ROOT%\remote_before.manifest.json" -RightPath "%PULL_ROOT%\remote_after.manifest.json" > "%PULL_ROOT%\before_after_parity.summary.txt" 2> "%PULL_ROOT%\before_after_parity.stderr.txt"
if errorlevel 1 goto FAIL_REMOTE_CHANGED
echo [OK] before/after 경로, 크기, SHA256 일치
echo.

echo [6/7] 불변 RAW 보관 및 로컬 교체 후보 준비
echo ------------------------------------------------------------
mkdir "%INCOMING_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_LOCAL_PREPARE
robocopy "%PULLED_DATA_DIR%" "%INCOMING_DIR%" /E /COPY:DAT /R:1 /W:1 > "%PULL_ROOT%\incoming_copy.log" 2>&1
set "ROBOCOPY_CODE=%ERRORLEVEL%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_LOCAL_PREPARE
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode BuildLocal -Root "%INCOMING_DIR%" -OutputPath "%PULL_ROOT%\incoming.manifest.json" -SnapshotId "%SNAPSHOT_ID%" -CapturedAt "%CAPTURED_AT%" > "%PULL_ROOT%\incoming_manifest.summary.txt" 2> "%PULL_ROOT%\incoming_manifest.stderr.txt"
if errorlevel 1 goto FAIL_LOCAL_PREPARE
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode Compare -LeftPath "%PULL_ROOT%\remote_before.manifest.json" -RightPath "%PULL_ROOT%\incoming.manifest.json" > "%PULL_ROOT%\incoming_parity.summary.txt" 2> "%PULL_ROOT%\incoming_parity.stderr.txt"
if errorlevel 1 goto FAIL_LOCAL_PREPARE
copy /y "%PULL_ROOT%\remote_before.manifest.json" "%PULL_ROOT%\manifest.json" > nul
> "%PULL_ROOT%\snapshot.complete" echo %SNAPSHOT_ID% %CAPTURED_AT%
if not exist "%SNAPSHOT_BASE%\" mkdir "%SNAPSHOT_BASE%" > nul 2>&1
if errorlevel 1 goto FAIL_SNAPSHOT_STORE
move "%PULL_ROOT%" "%SNAPSHOT_ROOT%" > nul 2>&1
if errorlevel 1 goto FAIL_SNAPSHOT_STORE
echo [OK] metadata-only manifest와 RAW snapshot 보관 완료
echo.

echo [7/7] 기존 data 롤백 보관 후 원자적 완전 교체
echo ------------------------------------------------------------
move "%LOCAL_DATA_ABS%" "%ROLLBACK_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_SWAP
move "%INCOMING_DIR%" "%LOCAL_DATA_ABS%" > nul 2>&1
if errorlevel 1 goto FAIL_SWAP_RESTORE
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode BuildLocal -Root "%LOCAL_DATA_ABS%" -OutputPath "%LOCAL_VERIFY_MANIFEST%" -SnapshotId "%SNAPSHOT_ID%" -CapturedAt "%CAPTURED_AT%" > nul 2>&1
if errorlevel 1 goto FAIL_SWAP_RESTORE
powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode Compare -LeftPath "%SNAPSHOT_ROOT%\manifest.json" -RightPath "%LOCAL_VERIFY_MANIFEST%" > nul 2>&1
if errorlevel 1 goto FAIL_SWAP_RESTORE
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:ROLLBACK_DIR); $base=[IO.Path]::GetFullPath($env:TARGET_REPO + '\.hoibot_data_rollback_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 81}; Remove-Item -LiteralPath $p -Recurse -Force"
if errorlevel 1 goto FAIL_ROLLBACK_CLEANUP
del /q "%LOCAL_VERIFY_MANIFEST%" > nul 2>&1
goto SUCCESS

:CAPTURE_REMOTE_MANIFEST
for /L %%r in (1,1,3) do (
    set "ATTEMPT_PREFIX=%PULL_ROOT%\remote_!CAPTURE_NAME!_attempt%%r"
    "%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "find '%REMOTE_DATA_DIR%' -type f -exec stat -c '%%s %%n' {} \;" > "!ATTEMPT_PREFIX!.stat.stdout.txt" 2> "!ATTEMPT_PREFIX!.stat.stderr.txt"
    set "STAT_EXIT=!ERRORLEVEL!"
    > "!ATTEMPT_PREFIX!.stat.exit.txt" echo !STAT_EXIT!
    if "!STAT_EXIT!"=="0" (
        "%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "find '%REMOTE_DATA_DIR%' -type f -exec sha256sum {} \;" > "!ATTEMPT_PREFIX!.hash.stdout.txt" 2> "!ATTEMPT_PREFIX!.hash.stderr.txt"
        set "HASH_EXIT=!ERRORLEVEL!"
    ) else (
        set "HASH_EXIT=99"
        > "!ATTEMPT_PREFIX!.hash.stdout.txt" echo.
        > "!ATTEMPT_PREFIX!.hash.stderr.txt" echo stat command failed before hash command
    )
    > "!ATTEMPT_PREFIX!.hash.exit.txt" echo !HASH_EXIT!
    if "!STAT_EXIT!"=="0" if "!HASH_EXIT!"=="0" (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%MANIFEST_TOOL%" -Mode BuildRemote -StatPath "!ATTEMPT_PREFIX!.stat.stdout.txt" -HashPath "!ATTEMPT_PREFIX!.hash.stdout.txt" -RemoteRoot "%REMOTE_DATA_DIR%" -OutputPath "%PULL_ROOT%\remote_!CAPTURE_NAME!.manifest.json" -SnapshotId "%SNAPSHOT_ID%" -CapturedAt "%CAPTURED_AT%" > "!ATTEMPT_PREFIX!.manifest.summary.txt" 2> "!ATTEMPT_PREFIX!.manifest.stderr.txt"
        set "MANIFEST_EXIT=!ERRORLEVEL!"
        > "!ATTEMPT_PREFIX!.manifest.exit.txt" echo !MANIFEST_EXIT!
        if "!MANIFEST_EXIT!"=="0" exit /b 0
    )
    if not "%%r"=="3" timeout /t 1 /nobreak > nul
)
exit /b 1

:FAIL_SWAP_RESTORE
if exist "%LOCAL_DATA_ABS%\" move "%LOCAL_DATA_ABS%" "%FAILED_NEW_DIR%" > nul 2>&1
if exist "%ROLLBACK_DIR%\" move "%ROLLBACK_DIR%" "%LOCAL_DATA_ABS%" > nul 2>&1
if not exist "%LOCAL_DATA_ABS%\" goto FAIL_RESTORE_FATAL
echo [FAIL] 새 data 검증 실패 - 기존 data 자동 복원 완료
goto FAIL_END

:SUCCESS
echo.
echo ============================================================
echo  SUCCESS - 운영 RAW 스냅샷 및 로컬 data 적재 완료
echo ============================================================
echo  snapshot_id: %SNAPSHOT_ID%
echo  RAW 보관 경로: %SNAPSHOT_ROOT%
echo  remote-before/TEMP/remote-after/local parity: PASS
echo  필수 JSON 33/33: PASS
echo  Git commit/push, 외부 업로드, DB import: 없음
echo ============================================================
pause
exit /b 0

:CANCELLED
echo [CANCEL] MessengerBot 데이터 쓰기를 멈춘 뒤 다시 실행하세요.
pause
exit /b 2

:FAIL_ADB_EXE
echo [FAIL] ADB 파일 없음: %ADB_EXE%
goto FAIL_END
:FAIL_MANIFEST_TOOL
echo [FAIL] manifest 검증 도구 없음: %MANIFEST_TOOL%
goto FAIL_END
:FAIL_LOCAL_DATA
echo [FAIL] 로컬 data 폴더 없음: %LOCAL_DATA_ABS%
goto FAIL_END
:FAIL_PATH_COLLISION
echo [FAIL] snapshot 또는 교체 임시 경로가 이미 존재함
goto FAIL_END
:FAIL_PULL_ROOT
echo [FAIL] TEMP 가져오기 폴더 생성 실패
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
:FAIL_REMOTE_STATS
echo [FAIL] 운영 원본 manifest 생성 실패 - 시도별 stdout/stderr/exit 보존
goto FAIL_END
:FAIL_PULL
echo [FAIL] 운영 데이터 전체 TEMP 가져오기 실패
goto FAIL_END
:FAIL_PULL_VERIFY
echo [FAIL] TEMP raw 폴더 확인 실패
goto FAIL_END
:FAIL_VALIDATE
echo [FAIL] TEMP metadata manifest 생성 실패
goto FAIL_END
:FAIL_REQUIRED
echo [FAIL] 필수 JSON 33개 중 누락 발생
goto FAIL_END
:FAIL_REMOTE_STAGING_PARITY
echo [FAIL] 운영 before와 TEMP 경로, 크기, SHA256 불일치
goto FAIL_END
:FAIL_REMOTE_CHANGED
echo [FAIL] 가져오기 전후 운영 원본 경로, 크기, SHA256 변경 감지
goto FAIL_END
:FAIL_LOCAL_PREPARE
echo [FAIL] 로컬 교체 후보 준비 또는 parity 검증 실패
goto FAIL_END
:FAIL_SNAPSHOT_STORE
echo [FAIL] 불변 RAW snapshot 보관 실패
goto FAIL_END
:FAIL_SWAP
echo [FAIL] 기존 data 롤백 보관 실패
goto FAIL_END
:FAIL_ROLLBACK_CLEANUP
echo [WARN] data 교체는 완료되었지만 롤백 폴더 정리에 실패함
echo [WARN] 롤백 폴더: %ROLLBACK_DIR%
goto SUCCESS
:FAIL_RESTORE_FATAL
echo [CRITICAL] 기존 data 자동 복원 실패
echo [CRITICAL] 롤백 폴더: %ROLLBACK_DIR%
echo [CRITICAL] 새 data 보존 폴더: %FAILED_NEW_DIR%
goto FAIL_END

:FAIL_END
echo 운영 원본은 변경하지 않았고 Git/외부 업로드/DB import는 수행하지 않았습니다.
if defined PULL_ROOT if exist "%PULL_ROOT%\" echo TEMP 진단 경로: %PULL_ROOT%
if defined SNAPSHOT_ROOT if exist "%SNAPSHOT_ROOT%\" echo RAW snapshot 경로: %SNAPSHOT_ROOT%
if defined INCOMING_DIR if exist "%INCOMING_DIR%\" echo 교체 후보 보존 경로: %INCOMING_DIR%
pause
exit /b 1
