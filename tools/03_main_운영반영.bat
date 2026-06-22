@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion
if not "%HOIBOT_TOOL_LOG_ACTIVE%"=="1" (
	set "HOIBOT_TOOL_LOG_ACTIVE=1"
	set "HOIBOT_TOOL_LOG_DIR=%~dp0logs"
	set "HOIBOT_TOOL_LOG_SCRIPT=%~f0"
	if not exist "%~dp0logs" mkdir "%~dp0logs" > nul 2>&1
	for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "HOIBOT_TOOL_LOG_FILE=%~dp0logs\%~n0_%%t.log"
	powershell -NoProfile -ExecutionPolicy Bypass -Command "$script=$env:HOIBOT_TOOL_LOG_SCRIPT; $log=$env:HOIBOT_TOOL_LOG_FILE; cmd /d /c call $script 2>&1 | Tee-Object -FilePath $log; $code=$LASTEXITCODE; $toolDir=Split-Path -Parent $script; $helper=Join-Path $toolDir '_push_tool_log.ps1'; $repoRoot=Resolve-Path (Join-Path $toolDir '..'); if (Test-Path $helper) { & $helper -RepoRoot $repoRoot -LogPath $log -Branch 'feature/tool-logs' }; exit $code"
	exit /b !ERRORLEVEL!
)
setlocal EnableExtensions EnableDelayedExpansion

set LD_CONSOLE_EXE=C:\LDPlayer\LDPlayer9\ldconsole.exe
set ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
set TARGET_ADB_DEVICE=auto
set USE_DIRECT_ADB=0
set TARGET_LD_INDEX=auto
set TARGET_BOT_DIR=/storage/emulated/0/hoiland/hoiland/Bots/main
set TARGET_FILE=/storage/emulated/0/hoiland/hoiland/Bots/main/main.js
set SOURCE_FILE=main.js
set CHANGELOG_SOURCE=data\hoiBotChangeLog.json
set TARGET_CHANGELOG=/storage/emulated/0/호이랜드/hoiBotChangeLog.json
set TARGET_CHANGELOG_DIR=/storage/emulated/0/호이랜드
set BOT_NAME=main
set BASE_BRANCH=feature/prod
set DEPLOY_LOG=%TEMP%\hoibot_main_deploy_%RANDOM%.log

title hoiBot main deploy

echo.
echo ============================================================
echo  hoiBot 운영 반영 - main.js
echo ============================================================
echo  LDPlayer와 MessengerBot이 켜진 상태에서 실행하세요.
echo ============================================================
echo  LD_CONSOLE_EXE  = %LD_CONSOLE_EXE%
echo  ADB_EXE         = %ADB_EXE%
echo  TARGET_ADB_DEVICE = %TARGET_ADB_DEVICE%
echo  TARGET_LD_INDEX = %TARGET_LD_INDEX%
echo  TARGET_FILE     = %TARGET_FILE%
echo ============================================================
echo.

echo [1/5] 준비 확인
echo ------------------------------------------------------------
cd /d "%~dp0.."
if errorlevel 1 goto FAIL_PATH
if not exist "%LD_CONSOLE_EXE%" goto FAIL_LD_CONSOLE_EXE
if not exist "%SOURCE_FILE%" goto FAIL_SOURCE
if not exist "%CHANGELOG_SOURCE%" goto FAIL_CHANGELOG_SOURCE
echo [OK] 준비 완료
echo.

echo [2/5] 최신 코드 받기
echo ------------------------------------------------------------
echo [WARN] 현재 작업트리의 수정/미추적 파일을 취소하고 운영 기준으로 맞춥니다.
for /f "usebackq delims=" %%h in (`git rev-parse --short HEAD`) do set BEFORE_GIT_HEAD=%%h
git reset --hard > nul 2>&1
if errorlevel 1 goto FAIL_GIT_RESET
git clean -fd > nul 2>&1
if errorlevel 1 goto FAIL_GIT_CLEAN
git switch %BASE_BRANCH% > nul 2>&1
if errorlevel 1 goto FAIL_GIT_SWITCH
git fetch origin %BASE_BRANCH% > nul 2>&1
if errorlevel 1 goto FAIL_GIT_FETCH
git reset --hard origin/%BASE_BRANCH% > nul 2>&1
if errorlevel 1 goto FAIL_GIT_RESET
git clean -fd > nul 2>&1
if errorlevel 1 goto FAIL_GIT_CLEAN
for /f "usebackq delims=" %%h in (`git rev-parse --short HEAD`) do set CURRENT_GIT_HEAD=%%h
if not "!HOIBOT_DEPLOY_RESTARTED!"=="1" if not "!BEFORE_GIT_HEAD!"=="!CURRENT_GIT_HEAD!" (
	echo [INFO] 배치 파일이 최신 코드로 갱신되었을 수 있어 새 버전으로 다시 시작합니다.
	set HOIBOT_DEPLOY_RESTARTED=1
	call "%~f0"
	exit /b
)
echo [OK] 최신 코드 확인 완료
echo [VERIFY] Git HEAD = !CURRENT_GIT_HEAD!
echo [VERIFY] Local HoiBotVersion:
findstr /n /c:"const HoiBotVersion" "%SOURCE_FILE%"
if errorlevel 1 goto FAIL_LOCAL_VERIFY
echo.

echo [3/5] LDPlayer 인스턴스 연결 확인
echo ------------------------------------------------------------
if exist "%ADB_EXE%" (
	echo [INFO] ADB devices:
	"%ADB_EXE%" devices
	if /i "%TARGET_ADB_DEVICE%"=="auto" (
		set DETECTED_ADB_DEVICE=
		set DETECTED_ADB_COUNT=0
		for /f "skip=1 tokens=1,2" %%a in ('"%ADB_EXE%" devices') do (
			if "%%b"=="device" (
				set /a DETECTED_ADB_COUNT+=1
				set DETECTED_ADB_DEVICE=%%a
			)
		)
		if "!DETECTED_ADB_COUNT!"=="1" (
			set TARGET_ADB_DEVICE=!DETECTED_ADB_DEVICE!
			set USE_DIRECT_ADB=1
			echo [INFO] 직접 ADB device 사용: !TARGET_ADB_DEVICE!
		)
	) else (
		set USE_DIRECT_ADB=1
	)
)
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "ls -l '%TARGET_FILE%'" > "%DEPLOY_LOG%" 2>&1
	type "%DEPLOY_LOG%"
	if errorlevel 1 goto FAIL_REMOTE_VERIFY
	findstr /i /c:"not found" /c:"No such file" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
	if not errorlevel 1 goto FAIL_REMOTE_VERIFY
	echo [OK] 직접 ADB device: %TARGET_ADB_DEVICE%
	echo [OK] TARGET_FILE = %TARGET_FILE%
	echo.
) else (
echo [INFO] LDPlayer list2:
"%LD_CONSOLE_EXE%" list2
if /i "%TARGET_LD_INDEX%"=="auto" (
	echo [INFO] TARGET_LD_INDEX=auto - 고정 TARGET_FILE이 있는 LDPlayer를 찾습니다.
	set DETECTED_LD_INDEX=
	set DETECTED_LD_COUNT=0
	for /f "tokens=1 delims=," %%i in ('"%LD_CONSOLE_EXE%" list2') do (
		"%LD_CONSOLE_EXE%" adb --index %%i --command "shell ls -l %TARGET_FILE%" > "%DEPLOY_LOG%" 2>&1
		findstr /i /c:"No such file" /c:"not found" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
		if errorlevel 1 (
			set /a DETECTED_LD_COUNT+=1
			set DETECTED_LD_INDEX=%%i
			echo [INFO] 고정 TARGET_FILE 확인: LDPlayer index %%i, %TARGET_FILE%
		)
	)
	if "!DETECTED_LD_COUNT!"=="0" goto FAIL_LD_AUTO_INDEX
	if not "!DETECTED_LD_COUNT!"=="1" goto FAIL_LD_MULTI_INDEX
	set TARGET_LD_INDEX=!DETECTED_LD_INDEX!
) else (
	"%LD_CONSOLE_EXE%" list2 | findstr /b "%TARGET_LD_INDEX%," > nul 2>&1
	if errorlevel 1 goto FAIL_LD_INDEX
)
"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell echo ok" > "%DEPLOY_LOG%" 2>&1
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_ADB
findstr /i /c:"not found" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_ADB
echo [OK] LDPlayer index: %TARGET_LD_INDEX%
echo.
)

echo [4/5] main.js 업로드
echo ------------------------------------------------------------
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% push "%SOURCE_FILE%" "%TARGET_FILE%" > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "push %SOURCE_FILE% %TARGET_FILE%" > "%DEPLOY_LOG%" 2>&1
)
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_PUSH
findstr /i /c:"not found" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_PUSH
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "ls -l '%TARGET_FILE%'" > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell ls -l %TARGET_FILE%" > "%DEPLOY_LOG%" 2>&1
)
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_REMOTE_VERIFY
findstr /i /c:"not found" /c:"No such file" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_VERIFY
echo [VERIFY] Uploaded HoiBotVersion:
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "grep -n HoiBotVersion '%TARGET_FILE%'" > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell grep -n HoiBotVersion %TARGET_FILE%" > "%DEPLOY_LOG%" 2>&1
)
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_REMOTE_VERIFY
findstr /i /c:"not found" /c:"No such file" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_REMOTE_VERIFY
echo [OK] main.js uploaded
echo.

echo [5/5] 수정내용 업로드 및 컴파일 요청
echo ------------------------------------------------------------
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "mkdir -p '%TARGET_CHANGELOG_DIR%'" > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell mkdir -p %TARGET_CHANGELOG_DIR%" > "%DEPLOY_LOG%" 2>&1
)
if errorlevel 1 goto FAIL_CHANGELOG
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% push "%CHANGELOG_SOURCE%" "%TARGET_CHANGELOG%" > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "push %CHANGELOG_SOURCE% %TARGET_CHANGELOG%" > "%DEPLOY_LOG%" 2>&1
)
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_CHANGELOG
findstr /i /c:"not found" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_CHANGELOG
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell "ls -l '%TARGET_CHANGELOG%'" > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell ls -l %TARGET_CHANGELOG%" > "%DEPLOY_LOG%" 2>&1
)
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_CHANGELOG
findstr /i /c:"not found" /c:"No such file" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_CHANGELOG
if "%USE_DIRECT_ADB%"=="1" (
	"%ADB_EXE%" -s %TARGET_ADB_DEVICE% shell am broadcast -a com.xfl.msgbot.broadcast.compile -p com.xfl.msgbot --es name %BOT_NAME% > "%DEPLOY_LOG%" 2>&1
) else (
	"%LD_CONSOLE_EXE%" adb --index %TARGET_LD_INDEX% --command "shell am broadcast -a com.xfl.msgbot.broadcast.compile -p com.xfl.msgbot --es name %BOT_NAME%" > "%DEPLOY_LOG%" 2>&1
)
type "%DEPLOY_LOG%"
if errorlevel 1 goto FAIL_COMPILE
findstr /i /c:"not found" /c:"failed" /c:"error" "%DEPLOY_LOG%" > nul 2>&1
if not errorlevel 1 goto FAIL_COMPILE
echo [OK] 수정내용 업로드 및 컴파일 요청 완료
echo.

echo ============================================================
echo  SUCCESS - main.js 운영 반영 완료
echo ============================================================
echo  main.js와 수정내용이 운영 봇에 반영되었습니다.
echo ============================================================
pause
exit /b 0

:FAIL_PATH
echo.
echo ============================================================
echo  FAIL - 프로젝트 폴더 이동 실패
echo ============================================================
echo  BAT 파일 위치가 HOIBOT\tools\ 인지 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_LD_CONSOLE_EXE
echo.
echo ============================================================
echo  FAIL - ldconsole.exe 파일 없음
echo ============================================================
echo  LD_CONSOLE_EXE 경로가 실제 LDPlayer ldconsole.exe 위치와 다릅니다.
echo  LD_CONSOLE_EXE = %LD_CONSOLE_EXE%
echo ============================================================
pause
exit /b 1

:FAIL_SOURCE
echo.
echo ============================================================
echo  FAIL - main.js 파일 없음
echo ============================================================
echo  SOURCE_FILE = %SOURCE_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_CHANGELOG_SOURCE
echo.
echo ============================================================
echo  FAIL - hoiBotChangeLog.json 파일 없음
echo ============================================================
echo  CHANGELOG_SOURCE = %CHANGELOG_SOURCE%
echo ============================================================
pause
exit /b 1

:FAIL_GIT_SWITCH
echo.
echo ============================================================
echo  FAIL - 브랜치 이동 실패
echo ============================================================
echo  BASE_BRANCH = %BASE_BRANCH%
echo ============================================================
pause
exit /b 1

:FAIL_GIT_FETCH
echo.
echo ============================================================
echo  FAIL - Git 최신화 실패
echo ============================================================
echo  충돌, 네트워크, GitHub 권한을 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_RESET
echo.
echo ============================================================
echo  FAIL - Git 변경내용 취소 실패
echo ============================================================
echo  작업트리 상태를 확인한 뒤 다시 실행하세요.
echo ============================================================
pause
exit /b 1

:FAIL_GIT_CLEAN
echo.
echo ============================================================
echo  FAIL - Git 미추적 파일 정리 실패
echo ============================================================
echo  미추적 파일 상태를 확인한 뒤 다시 실행하세요.
echo ============================================================
pause
exit /b 1

:FAIL_LOCAL_VERIFY
echo.
echo ============================================================
echo  FAIL - 로컬 main.js 버전 확인 실패
echo ============================================================
echo  SOURCE_FILE 안에서 HoiBotVersion 줄을 찾지 못했습니다.
echo  SOURCE_FILE = %SOURCE_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_REMOTE_VERIFY
echo.
echo ============================================================
echo  FAIL - 업로드된 main.js 확인 실패
echo ============================================================
echo  TARGET_FILE 경로가 실제 MessengerBot main.js 위치인지 확인하세요.
echo  TARGET_FILE = %TARGET_FILE%
echo ============================================================
pause
exit /b 1

:FAIL_ADB
echo.
echo ============================================================
echo  FAIL - LDPlayer ADB 명령 실패
echo ============================================================
echo  TARGET_LD_INDEX = %TARGET_LD_INDEX%
echo  LDPlayer 실행 상태와 MessengerBot 인스턴스를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_LD_INDEX
echo.
echo ============================================================
echo  FAIL - LDPlayer 인스턴스 없음
echo ============================================================
echo  TARGET_LD_INDEX = %TARGET_LD_INDEX%
echo  ldconsole list2에서 해당 인스턴스 번호를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_LD_AUTO_INDEX
echo.
echo ============================================================
echo  FAIL - 운영 LDPlayer 자동 감지 실패
echo ============================================================
echo  고정 TARGET_FILE 경로를 가진 운영 LDPlayer를 찾지 못했습니다.
echo  TARGET_FILE = %TARGET_FILE%
echo  LDPlayer와 MessengerBot 봇 파일 경로를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_LD_MULTI_INDEX
echo.
echo ============================================================
echo  FAIL - 운영 LDPlayer 후보가 2개 이상입니다
echo ============================================================
echo  안전을 위해 자동 선택하지 않았습니다.
echo  배치 파일 상단의 TARGET_LD_INDEX를 운영 인스턴스 번호로 직접 지정하세요.
echo ============================================================
pause
exit /b 1

:FAIL_PUSH
echo.
echo ============================================================
echo  FAIL - main.js 업로드 실패
echo ============================================================
echo  LDPlayer와 MessengerBot이 켜져 있는지 확인하세요.
echo  계속 실패하면 LDPlayer를 재시작한 뒤 다시 실행하세요.
echo ============================================================
pause
exit /b 1

:FAIL_CHANGELOG
echo.
echo ============================================================
echo  FAIL - hoiBotChangeLog.json 업로드 실패
echo ============================================================
echo  수정내용 파일 업로드에 실패했습니다.
echo  LDPlayer 저장공간 접근 상태를 확인하세요.
echo ============================================================
pause
exit /b 1

:FAIL_COMPILE
echo.
echo ============================================================
echo  FAIL - MessengerBot 컴파일 요청 실패
echo ============================================================
echo  MessengerBot 앱이 실행 중인지 확인하세요.
echo ============================================================
pause
exit /b 1
