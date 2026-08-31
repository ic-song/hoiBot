@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe"
set "TARGET_ADB_DEVICE=auto"
set "REMOTE_DATA_DIR=/storage/emulated/0/호이랜드"
for %%I in ("%~dp0..") do set "TARGET_REPO=%%~fI"
set "LOCAL_DATA_DIR=%TARGET_REPO%\data"

title hoiBot LDPlayer data pull

echo.
echo ============================================================
echo  hoiBot LDPlayer 운영 데이터 전체 내려받기
echo ============================================================
echo  %REMOTE_DATA_DIR% 전체를 ADB pull하여
echo  %LOCAL_DATA_DIR% 로 교체합니다.
echo  Git 작업과 DB import는 수행하지 않습니다.
echo ============================================================
echo.

if not exist "%ADB_EXE%" goto FAIL_ADB_EXE
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_LOCAL_DATA

for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RUN_TS=%%t"
set "PULL_ROOT=%TEMP%\hoibot_adb_pull_%RUN_TS%_%RANDOM%"
set "PULLED_DATA_DIR=%PULL_ROOT%\data"
set "INCOMING_DIR=%TARGET_REPO%\.hoibot_data_incoming_%RUN_TS%_%RANDOM%"
set "ROLLBACK_DIR=%TARGET_REPO%\.hoibot_data_rollback_%RUN_TS%_%RANDOM%"
set "FAILED_PULL_DIR=%TARGET_REPO%\.hoibot_data_failed_%RUN_TS%_%RANDOM%"

if exist "%PULL_ROOT%\" goto FAIL_PATH_COLLISION
if exist "%INCOMING_DIR%\" goto FAIL_PATH_COLLISION
if exist "%ROLLBACK_DIR%\" goto FAIL_PATH_COLLISION
if exist "%FAILED_PULL_DIR%\" goto FAIL_PATH_COLLISION
mkdir "%PULL_ROOT%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_ROOT

echo [1/4] ADB device 확인
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

echo [2/4] LDPlayer /호이랜드 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "ls -ld '%REMOTE_DATA_DIR%'"
if errorlevel 1 goto FAIL_REMOTE_DATA
echo [OK] %REMOTE_DATA_DIR%
echo.

echo [3/4] /호이랜드 전체를 짧은 TEMP 경로로 ADB pull
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" pull "%REMOTE_DATA_DIR%" "%PULLED_DATA_DIR%"
if errorlevel 1 goto FAIL_PULL
if not exist "%PULLED_DATA_DIR%\" goto FAIL_PULL

for /f %%c in ('powershell -NoProfile -Command "$files=@(Get-ChildItem -LiteralPath $env:PULLED_DATA_DIR -File -Recurse); Write-Output $files.Count"') do set "PULL_COUNT=%%c"
if not defined PULL_COUNT goto FAIL_PULL
if "%PULL_COUNT%"=="0" goto FAIL_PULL
echo [OK] /호이랜드 전체 %PULL_COUNT%개 TEMP 내려받기 완료
echo.

echo [4/4] 내려받은 전체 데이터로 저장소 data 교체
echo ------------------------------------------------------------
robocopy "%PULLED_DATA_DIR%" "%INCOMING_DIR%" /E /COPY:DAT /R:1 /W:1 > "%PULL_ROOT%\incoming_copy.log" 2>&1
set "ROBOCOPY_CODE=%ERRORLEVEL%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_COPY

move "%LOCAL_DATA_DIR%" "%ROLLBACK_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_ROLLBACK
move "%INCOMING_DIR%" "%LOCAL_DATA_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_PULL_RESTORE

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:ROLLBACK_DIR); $base=[IO.Path]::GetFullPath($env:TARGET_REPO + '\.hoibot_data_rollback_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 81}; Remove-Item -LiteralPath $p -Recurse -Force"
if errorlevel 1 goto FAIL_ROLLBACK_CLEANUP
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:PULL_ROOT); $base=[IO.Path]::GetFullPath($env:TEMP + '\hoibot_adb_pull_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 82}; Remove-Item -LiteralPath $p -Recurse -Force"
if errorlevel 1 goto FAIL_TEMP_CLEANUP
goto SUCCESS

:FAIL_PULL_RESTORE
if exist "%LOCAL_DATA_DIR%\" move "%LOCAL_DATA_DIR%" "%FAILED_PULL_DIR%" > nul 2>&1
if exist "%ROLLBACK_DIR%\" move "%ROLLBACK_DIR%" "%LOCAL_DATA_DIR%" > nul 2>&1
if not exist "%LOCAL_DATA_DIR%\" goto FAIL_RESTORE_FATAL
echo [FAIL] ADB pull 실패 - 기존 data 자동 복원 완료
goto FAIL_END

:SUCCESS
echo.
echo ============================================================
echo  SUCCESS - /호이랜드 전체 ADB pull 완료
echo ============================================================
echo  내려받은 파일: %PULL_COUNT%개
echo  대상 data: %LOCAL_DATA_DIR%
echo ============================================================
pause
exit /b 0

:FAIL_ADB_EXE
echo [FAIL] ADB 파일 없음: %ADB_EXE%
goto FAIL_END
:FAIL_LOCAL_DATA
echo [FAIL] 기존 data 폴더 없음: %LOCAL_DATA_DIR%
goto FAIL_END
:FAIL_PATH_COLLISION
echo [FAIL] 임시 롤백 경로가 이미 존재함
goto FAIL_END
:FAIL_PULL_ROOT
echo [FAIL] TEMP 폴더 생성 실패: %PULL_ROOT%
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
:FAIL_ROLLBACK_CLEANUP
echo [WARN] ADB pull은 완료됐지만 이전 data 롤백 폴더 정리에 실패함
echo [WARN] 롤백 폴더: %ROLLBACK_DIR%
goto SUCCESS
:FAIL_TEMP_CLEANUP
echo [WARN] data 교체는 완료됐지만 TEMP 폴더 정리에 실패함
echo [WARN] TEMP 폴더: %PULL_ROOT%
goto SUCCESS
:FAIL_RESTORE_FATAL
echo [CRITICAL] 기존 data 자동 복원 실패
echo [CRITICAL] 롤백 폴더: %ROLLBACK_DIR%
echo [CRITICAL] 실패한 pull 보존 폴더: %FAILED_PULL_DIR%
goto FAIL_END

:FAIL_END
echo 운영 원본은 변경하지 않았고 Git 작업 및 DB import는 수행하지 않았습니다.
if defined PULL_ROOT if exist "%PULL_ROOT%\" echo TEMP 진단 경로: %PULL_ROOT%
if defined INCOMING_DIR if exist "%INCOMING_DIR%\" echo 교체 후보 보존 경로: %INCOMING_DIR%
pause
exit /b 1
