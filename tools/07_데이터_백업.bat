@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe"
set "TARGET_ADB_DEVICE=auto"
set "REMOTE_DATA_DIR=/storage/emulated/0/호이랜드"
set "LOCAL_DATA_DIR=data"
set "SYNC_LOG=%TEMP%\hoibot_data_pull_%RANDOM%.log"
set "REQUIRED_JSON_FILES=member.json board.json carrotBoard.json itemInfo.json trialTowerBoss.json eventTowerBoss.json castleBattle2.json errorLog.json member_title.json pet_title.json miniPet_title.json miniPet_collection.json miniPetCollectionInfo.json member_pet.json petSkillData.json punchRankData.json trialTower.json miniPetData.json petSweetHomeInfo.json petSweetHomeData.json petHomePlacedFurniture.json petHomeComments.json petHomeActivityData.json petExploreData.json attendanceLight.json itemList.json hoiBotChangeLog.json freeMarket.json packageInfo.json packageLog.json currencyLog.json guildData.json requestMonitorConfig.json"
set "PULL_ROOT="
set "INCOMING_DIR="

title hoiBot LDPlayer local data backup

echo.
echo ============================================================
echo  hoiBot LDPlayer 운영 데이터 로컬 백업
echo ============================================================
echo  운영 /storage/emulated/0/호이랜드/ 전체를 TEMP에 가져와
echo  검증한 뒤 이 PC의 data\만 안전하게 교체합니다.
echo  Git commit/push 및 외부 업로드는 절대 수행하지 않습니다.
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
set "PULL_DEST=%PULL_ROOT%\pull"
set "PULLED_DATA_DIR=%PULL_DEST%\호이랜드"
set "REMOTE_BEFORE_FILE=%PULL_ROOT%\remote_before.txt"
set "REMOTE_AFTER_FILE=%PULL_ROOT%\remote_after.txt"
set "LOCAL_DATA_ABS=%CD%\%LOCAL_DATA_DIR%"
set "INCOMING_DIR=%CD%\.hoibot_data_incoming_%RUN_TS%_%RANDOM%"
set "ROLLBACK_DIR=%CD%\.hoibot_data_rollback_%RUN_TS%_%RANDOM%"
set "FAILED_NEW_DIR=%CD%\.hoibot_data_failed_%RUN_TS%_%RANDOM%"
set "REMOTE_FILE_COUNT=0"
set "REMOTE_TOTAL_BYTES=0"
set "STAGING_FILE_COUNT=0"
set "STAGING_TOTAL_BYTES=0"
set "JSON_COUNT=0"
set "REQUIRED_COUNT=0"
set "REQUIRED_MISSING_COUNT=0"
set "STAGING_TREE_HASH="
set "INCOMING_TREE_HASH="
set "LOCAL_TREE_HASH="

mkdir "%PULL_DEST%" > nul 2>&1
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

echo [2/7] 운영 원본 파일수와 총바이트 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "find '%REMOTE_DATA_DIR%' -type f -exec stat -c %%s {} \;" > "%REMOTE_BEFORE_FILE%" 2>&1
if errorlevel 1 goto FAIL_REMOTE_STATS
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lines=@(Get-Content -LiteralPath $env:REMOTE_BEFORE_FILE | ForEach-Object {$_.Trim()} | Where-Object {$_ -ne ''}); $sizes=@(); foreach($line in $lines){$n=0L; if(-not [long]::TryParse($line,[ref]$n)){exit 21}; $sizes+=$n}; if($sizes.Count -eq 0){exit 22}; Write-Output ('REMOTE_FILE_COUNT=' + $sizes.Count); Write-Output ('REMOTE_TOTAL_BYTES=' + (($sizes | Measure-Object -Sum).Sum))" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_REMOTE_STATS
for /f "usebackq tokens=1,2 delims==" %%a in ("%SYNC_LOG%") do set "%%a=%%b"
echo [OK] 운영 원본 집계 완료
echo.

echo [3/7] 운영 데이터 전체 TEMP 가져오기
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" pull "%REMOTE_DATA_DIR%" "%PULL_DEST%" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_PULL
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_PULL
if not exist "%PULLED_DATA_DIR%\" set "PULLED_DATA_DIR=%PULL_DEST%"
echo [OK] TEMP 가져오기 완료
echo.

echo [4/7] 해시·UTF-8·JSON·필수 자산 검증
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path -LiteralPath $env:PULLED_DATA_DIR).Path; $files=@(Get-ChildItem -LiteralPath $root -File -Recurse); if($files.Count -eq 0){exit 31}; $utf8=New-Object System.Text.UTF8Encoding($false,$true); $jsonFiles=@($files | Where-Object {$_.Extension -ieq '.json'}); foreach($file in $jsonFiles){try{$text=$utf8.GetString([IO.File]::ReadAllBytes($file.FullName))}catch{exit 32}; if([string]::IsNullOrWhiteSpace($text)){exit 33}; try{$null=$text | ConvertFrom-Json -ErrorAction Stop}catch{exit 34}}; $rows=@($files | ForEach-Object {$rel=$_.FullName.Substring($root.Length).TrimStart('\').Replace('\','/'); $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash; $rel+'|'+$_.Length+'|'+$hash} | Sort-Object); $sha=[Security.Cryptography.SHA256]::Create(); try{$tree=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($rows -join [Environment]::NewLine))))).Replace('-','')}finally{$sha.Dispose()}; $required=@($env:REQUIRED_JSON_FILES -split ' ' | Where-Object {$_}); $missing=@($required | Where-Object {-not (Test-Path -LiteralPath (Join-Path $root ($_ -replace '/','\')) -PathType Leaf)}); Write-Output ('STAGING_FILE_COUNT=' + $files.Count); Write-Output ('STAGING_TOTAL_BYTES=' + (($files | Measure-Object Length -Sum).Sum)); Write-Output ('JSON_COUNT=' + $jsonFiles.Count); Write-Output ('REQUIRED_COUNT=' + $required.Count); Write-Output ('REQUIRED_MISSING_COUNT=' + $missing.Count); Write-Output ('STAGING_TREE_HASH=' + $tree); foreach($name in $missing){Write-Output ('MISSING_REQUIRED=' + $name)}" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_VALIDATE
for /f "usebackq tokens=1,2 delims==" %%a in ("%SYNC_LOG%") do if /i not "%%a"=="MISSING_REQUIRED" set "%%a=%%b"
if not "%REMOTE_FILE_COUNT%"=="%STAGING_FILE_COUNT%" goto FAIL_REMOTE_STAGING_PARITY
if not "%REMOTE_TOTAL_BYTES%"=="%STAGING_TOTAL_BYTES%" goto FAIL_REMOTE_STAGING_PARITY
echo [OK] 전체 파일 해시 및 JSON 검증 완료
echo [INFO] 필수 JSON %REQUIRED_COUNT%개 중 누락 %REQUIRED_MISSING_COUNT%개
echo.

echo [5/7] 운영 원본 변경 여부 재확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "find '%REMOTE_DATA_DIR%' -type f -exec stat -c %%s {} \;" > "%REMOTE_AFTER_FILE%" 2>&1
if errorlevel 1 goto FAIL_REMOTE_STATS
fc /b "%REMOTE_BEFORE_FILE%" "%REMOTE_AFTER_FILE%" > nul 2>&1
if errorlevel 1 goto FAIL_REMOTE_CHANGED
echo [OK] 가져오기 전후 원본 파일수·크기 동일
echo.

echo [6/7] 교체 후보를 로컬과 같은 볼륨에 준비
echo ------------------------------------------------------------
if exist "%INCOMING_DIR%\" goto FAIL_LOCAL_PREPARE
mkdir "%INCOMING_DIR%" > nul 2>&1
if errorlevel 1 goto FAIL_LOCAL_PREPARE
robocopy "%PULLED_DATA_DIR%" "%INCOMING_DIR%" /E /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set "ROBOCOPY_CODE=%ERRORLEVEL%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_LOCAL_PREPARE
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path -LiteralPath $env:INCOMING_DIR).Path; $files=@(Get-ChildItem -LiteralPath $root -File -Recurse); $rows=@($files | ForEach-Object {$rel=$_.FullName.Substring($root.Length).TrimStart('\').Replace('\','/'); $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash; $rel+'|'+$_.Length+'|'+$hash} | Sort-Object); $sha=[Security.Cryptography.SHA256]::Create(); try{$tree=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($rows -join [Environment]::NewLine))))).Replace('-','')}finally{$sha.Dispose()}; Write-Output ('INCOMING_FILE_COUNT=' + $files.Count); Write-Output ('INCOMING_TOTAL_BYTES=' + (($files | Measure-Object Length -Sum).Sum)); Write-Output ('INCOMING_TREE_HASH=' + $tree)" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_LOCAL_PREPARE
for /f "usebackq tokens=1,2 delims==" %%a in ("%SYNC_LOG%") do set "%%a=%%b"
if not "%STAGING_FILE_COUNT%"=="%INCOMING_FILE_COUNT%" goto FAIL_LOCAL_PREPARE
if not "%STAGING_TOTAL_BYTES%"=="%INCOMING_TOTAL_BYTES%" goto FAIL_LOCAL_PREPARE
if /i not "%STAGING_TREE_HASH%"=="%INCOMING_TREE_HASH%" goto FAIL_LOCAL_PREPARE
echo [OK] 로컬 교체 후보 해시 일치
echo.

echo [7/7] 기존 data 롤백 보관 후 원자적 교체
echo ------------------------------------------------------------
if exist "%ROLLBACK_DIR%\" goto FAIL_SWAP
move "%LOCAL_DATA_ABS%" "%ROLLBACK_DIR%" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_SWAP
if "%HOIBOT_07_TEST_FAIL_AFTER_BACKUP%"=="1" goto FAIL_SWAP_RESTORE
move "%INCOMING_DIR%" "%LOCAL_DATA_ABS%" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_SWAP_RESTORE
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path -LiteralPath $env:LOCAL_DATA_ABS).Path; $files=@(Get-ChildItem -LiteralPath $root -File -Recurse); $rows=@($files | ForEach-Object {$rel=$_.FullName.Substring($root.Length).TrimStart('\').Replace('\','/'); $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash; $rel+'|'+$_.Length+'|'+$hash} | Sort-Object); $sha=[Security.Cryptography.SHA256]::Create(); try{$tree=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($rows -join [Environment]::NewLine))))).Replace('-','')}finally{$sha.Dispose()}; Write-Output ('LOCAL_FILE_COUNT=' + $files.Count); Write-Output ('LOCAL_TOTAL_BYTES=' + (($files | Measure-Object Length -Sum).Sum)); Write-Output ('LOCAL_TREE_HASH=' + $tree)" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_SWAP_RESTORE
for /f "usebackq tokens=1,2 delims==" %%a in ("%SYNC_LOG%") do set "%%a=%%b"
if not "%REMOTE_FILE_COUNT%"=="%LOCAL_FILE_COUNT%" goto FAIL_SWAP_RESTORE
if not "%REMOTE_TOTAL_BYTES%"=="%LOCAL_TOTAL_BYTES%" goto FAIL_SWAP_RESTORE
if /i not "%STAGING_TREE_HASH%"=="%LOCAL_TREE_HASH%" goto FAIL_SWAP_RESTORE
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:ROLLBACK_DIR); $base=[IO.Path]::GetFullPath($env:CD + '\.hoibot_data_rollback_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 41}; Remove-Item -LiteralPath $p -Recurse -Force" > "%SYNC_LOG%" 2>&1
if errorlevel 1 goto FAIL_ROLLBACK_CLEANUP
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[IO.Path]::GetFullPath($env:PULL_ROOT); $base=[IO.Path]::GetFullPath($env:TEMP + '\hoibot_ld_data_'); if(-not $p.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)){exit 42}; Remove-Item -LiteralPath $p -Recurse -Force" > nul 2>&1
del /q "%SYNC_LOG%" > nul 2>&1
goto SUCCESS

:FAIL_SWAP_RESTORE
if exist "%LOCAL_DATA_ABS%\" move "%LOCAL_DATA_ABS%" "%FAILED_NEW_DIR%" > nul 2>&1
if exist "%ROLLBACK_DIR%\" move "%ROLLBACK_DIR%" "%LOCAL_DATA_ABS%" > nul 2>&1
if not exist "%LOCAL_DATA_ABS%\" goto FAIL_RESTORE_FATAL
echo [FAIL] 새 data 교체 검증 실패 - 기존 data 자동 복원 완료
goto FAIL_END

:SUCCESS
echo.
echo ============================================================
echo  SUCCESS - LDPlayer 운영 데이터 로컬 백업 완료
echo ============================================================
echo  원본/TEMP/로컬 파일수·총바이트·해시가 일치합니다.
echo  필수 JSON 누락: %REQUIRED_MISSING_COUNT%개
echo  Git commit/push 및 외부 업로드: 없음
echo  다음 단계: Codex에 "07 백업 완료"라고 알려 주세요.
echo ============================================================
pause
exit /b 0

:CANCELLED
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
echo [FAIL] 운영 원본 파일수·총바이트 집계 실패
goto FAIL_END

:FAIL_PULL
echo [FAIL] 운영 데이터 전체 TEMP 가져오기 실패
goto FAIL_END

:FAIL_VALIDATE
echo [FAIL] 해시·UTF-8 또는 JSON 파싱 검증 실패
goto FAIL_END

:FAIL_REMOTE_STAGING_PARITY
echo [FAIL] 운영 원본과 TEMP의 파일수 또는 총바이트 불일치
goto FAIL_END

:FAIL_REMOTE_CHANGED
echo [FAIL] 가져오기 도중 운영 원본 파일 구성이 변경됨
goto FAIL_END

:FAIL_LOCAL_PREPARE
echo [FAIL] 로컬 교체 후보 준비 또는 해시 검증 실패
goto FAIL_END

:FAIL_SWAP
echo [FAIL] 기존 data 롤백 보관 실패
goto FAIL_END

:FAIL_ROLLBACK_CLEANUP
echo [WARN] 새 data 교체는 완료되었지만 임시 롤백 폴더 정리에 실패함
echo [WARN] 롤백 폴더: %ROLLBACK_DIR%
goto SUCCESS

:FAIL_RESTORE_FATAL
echo [CRITICAL] 기존 data 자동 복원 실패
echo [CRITICAL] 롤백 폴더: %ROLLBACK_DIR%
echo [CRITICAL] 새 data 보존 폴더: %FAILED_NEW_DIR%
goto FAIL_END

:FAIL_END
echo 운영 원본은 변경하지 않았고 Git/외부 업로드는 수행하지 않았습니다.
if defined PULL_ROOT if exist "%PULL_ROOT%\" echo TEMP 진단 경로: %PULL_ROOT%
if defined INCOMING_DIR if exist "%INCOMING_DIR%\" echo 교체 후보 보존 경로: %INCOMING_DIR%
pause
exit /b 1
