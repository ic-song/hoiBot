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
setlocal EnableDelayedExpansion

set "ROOT=%~dp0.."
set "CODEX_HOME=%USERPROFILE%\.codex"

echo [hoiBot] Codex skills install/update
echo ROOT=%ROOT%
echo CODEX_HOME=%CODEX_HOME%

if not exist "%ROOT%\.codex\skills" (
  echo [ERROR] repo skill source not found: %ROOT%\.codex\skills
  set "EXIT_CODE=1"
  goto finish
)

if not exist "%CODEX_HOME%\skills" mkdir "%CODEX_HOME%\skills"
if not exist "%CODEX_HOME%\skill-drafts-ko" mkdir "%CODEX_HOME%\skill-drafts-ko"

robocopy "%ROOT%\.codex\skills" "%CODEX_HOME%\skills" /E /NFL /NDL /NJH /NJS /NP
set "RC1=%ERRORLEVEL%"
if !RC1! GEQ 8 (
  echo [ERROR] failed to sync skills. robocopy exit code=!RC1!
  set "EXIT_CODE=!RC1!"
  goto finish
)

if exist "%ROOT%\.codex\skill-drafts-ko" (
  robocopy "%ROOT%\.codex\skill-drafts-ko" "%CODEX_HOME%\skill-drafts-ko" /E /NFL /NDL /NJH /NJS /NP
  set "RC2=%ERRORLEVEL%"
  if !RC2! GEQ 8 (
    echo [ERROR] failed to sync Korean drafts. robocopy exit code=!RC2!
    set "EXIT_CODE=!RC2!"
    goto finish
  )
)

echo [OK] Codex skills synced.
set "EXIT_CODE=0"

:finish
echo.
pause
exit /b %EXIT_CODE%
