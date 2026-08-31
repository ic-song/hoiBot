@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe"
set "TARGET_ADB_DEVICE=auto"
set "REMOTE_DATA_DIR=/storage/emulated/0/호이랜드"
set "LOCAL_DATA_DIR=data"
set "SYNC_LOG=%TEMP%\hoibot_data_pull_%RANDOM%.log"
set "REQUIRED_JSON_FILES=member.json board.json carrotBoard.json itemInfo.json trialTowerBoss.json eventTowerBoss.json castleBattle2.json errorLog.json member_title.json pet_title.json miniPet_title.json miniPet_collection.json miniPetCollectionInfo.json member_pet.json petSkillData.json punchRankData.json trialTower.json miniPetData.json petSweetHomeInfo.json petSweetHomeData.json petHomePlacedFurniture.json petHomeComments.json petHomeActivityData.json petExploreData.json attendanceLight.json itemList.json hoiBotChangeLog.json freeMarket.json packageInfo.json packageLog.json currencyLog.json guildData.json requestMonitorConfig.json"

title hoiBot LDPlayer data pull

echo.
echo ============================================================
echo  hoiBot LDPlayer 운영 JSON 가져오기
echo ============================================================
echo  ADB로 현재 이관 대상 JSON만 data\에 가져옵니다.
echo  과거 백업 JSON과 Git 작업은 처리하지 않습니다.
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
mkdir "%PULLED_DATA_DIR%" > nul 2>&1
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

echo [2/4] LDPlayer 운영 데이터 폴더 확인
echo ------------------------------------------------------------
"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" shell "ls -ld '%REMOTE_DATA_DIR%'" > "%SYNC_LOG%" 2>&1
type "%SYNC_LOG%"
if errorlevel 1 goto FAIL_REMOTE_DATA
findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%SYNC_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_DATA
echo [OK] 운영 데이터 폴더 확인 완료
echo.

echo [3/4] 이관 대상 운영 JSON 가져오기
echo ------------------------------------------------------------
set "PULL_COUNT=0"
for %%f in (%REQUIRED_JSON_FILES%) do (
	set "RELATIVE_FILE=%%f"
	set "LOCAL_TARGET=!PULLED_DATA_DIR!\!RELATIVE_FILE:/=\!"
	for %%p in ("!LOCAL_TARGET!") do if not exist "%%~dpp" mkdir "%%~dpp" > nul 2>&1
	"%ADB_EXE%" -s "%TARGET_ADB_DEVICE%" pull "%REMOTE_DATA_DIR%/!RELATIVE_FILE!" "!LOCAL_TARGET!" > "%SYNC_LOG%" 2>&1
	if errorlevel 1 (
		type "%SYNC_LOG%"
		set "FAILED_FILE=!RELATIVE_FILE!"
		goto FAIL_PULL
	)
	if not exist "!LOCAL_TARGET!" (
		set "FAILED_FILE=!RELATIVE_FILE!"
		goto FAIL_PULL_VERIFY
	)
	for %%s in ("!LOCAL_TARGET!") do if %%~zs LEQ 0 (
		set "FAILED_FILE=!RELATIVE_FILE!"
		goto FAIL_EMPTY_FILE
	)
	set /a PULL_COUNT+=1
	echo [OK] !RELATIVE_FILE!
)
echo.

echo [4/4] 검증된 JSON을 data\에 반영
echo ------------------------------------------------------------
robocopy "%PULLED_DATA_DIR%" "%LOCAL_DATA_DIR%" /E /COPY:DAT /R:1 /W:1 > "%SYNC_LOG%" 2>&1
set "ROBOCOPY_CODE=%ERRORLEVEL%"
type "%SYNC_LOG%"
if %ROBOCOPY_CODE% GEQ 8 goto FAIL_COPY
rmdir /s /q "%PULL_ROOT%"
del /q "%SYNC_LOG%" > nul 2>&1
echo [OK] 운영 JSON %PULL_COUNT%개를 data\에 가져왔습니다.
echo.

:SUCCESS
echo ============================================================
echo  SUCCESS - LDPlayer 운영 JSON 가져오기 완료
echo ============================================================
echo  다음 단계: Codex에 "07 백업 완료"라고 알려 주세요.
echo ============================================================
pause
exit /b 0

:CANCELLED
echo.
echo [CANCEL] MessengerBot 데이터 쓰기를 멈춘 뒤 다시 실행하세요.
pause
exit /b 2

:FAIL_PATH
echo.
echo [FAIL] 프로젝트 폴더 이동 실패
pause
exit /b 1

:FAIL_ADB_EXE
echo.
echo [FAIL] ADB 파일 없음: %ADB_EXE%
pause
exit /b 1

:FAIL_LOCAL_DATA
echo.
echo [FAIL] 로컬 data 폴더 없음: %LOCAL_DATA_DIR%
pause
exit /b 1

:FAIL_PULL_ROOT
echo.
echo [FAIL] 임시 가져오기 폴더 생성 실패: %PULL_ROOT%
pause
exit /b 1

:FAIL_ADB
echo.
echo [FAIL] adb devices 실행 실패
pause
exit /b 1

:FAIL_NO_DEVICE
echo.
echo [FAIL] 연결된 ADB 기기 없음
pause
exit /b 1

:FAIL_MULTI_DEVICE
echo.
echo [FAIL] 연결된 ADB 기기가 2개 이상임
echo 운영 봇이 실행 중인 LDPlayer만 켜거나 TARGET_ADB_DEVICE를 지정하세요.
pause
exit /b 1

:FAIL_REMOTE_DATA
echo.
echo [FAIL] LDPlayer 운영 데이터 폴더 확인 실패: %REMOTE_DATA_DIR%
pause
exit /b 1

:FAIL_PULL
echo.
echo [FAIL] 운영 JSON 가져오기 실패: %FAILED_FILE%
echo 원본과 data\는 변경하지 않았습니다.
pause
exit /b 1

:FAIL_PULL_VERIFY
echo.
echo [FAIL] 가져온 운영 JSON을 찾을 수 없음: %FAILED_FILE%
echo 원본과 data\는 변경하지 않았습니다.
pause
exit /b 1

:FAIL_EMPTY_FILE
echo.
echo [FAIL] 가져온 운영 JSON이 비어 있음: %FAILED_FILE%
echo 원본과 data\는 변경하지 않았습니다.
pause
exit /b 1

:FAIL_COPY
echo.
echo [FAIL] 검증된 JSON의 data\ 반영 실패
echo 임시 가져오기 폴더: %PULL_ROOT%
pause
exit /b 1
