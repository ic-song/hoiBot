@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
set "REGISTRY=%USERPROFILE%\CODEX-CONFIG"
if defined CODEX_CONFIG_ROOT set "REGISTRY=%CODEX_CONFIG_ROOT%"

echo [hoiBot] CODEX-CONFIG skills install/update
echo ROOT=%ROOT%
echo REGISTRY=%REGISTRY%

if not exist "%REGISTRY%\.git" (
  echo [ERROR] CODEX-CONFIG repository not found: %REGISTRY%
  echo Clone https://github.com/ic-song/CODEX-CONFIG.git first.
  set "EXIT_CODE=1"
  goto finish
)

git -C "%REGISTRY%" pull --ff-only
if errorlevel 1 (
  echo [ERROR] CODEX-CONFIG update failed.
  set "EXIT_CODE=1"
  goto finish
)

node "%REGISTRY%\scripts\validate.mjs"
if errorlevel 1 (
  echo [ERROR] CODEX-CONFIG validation failed.
  set "EXIT_CODE=1"
  goto finish
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REGISTRY%\scripts\link-skills.ps1" -MigrateExisting
if errorlevel 1 (
  echo [ERROR] failed to link personal skills.
  set "EXIT_CODE=1"
  goto finish
)

for /f "delims=" %%B in ('git -C "%ROOT%" branch --show-current') do set "CURRENT_BRANCH=%%B"
if /I "!CURRENT_BRANCH!"=="feature/workflow" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%REGISTRY%\scripts\sync-skills.ps1" -ProjectPath "%ROOT%" -Force
  if errorlevel 1 (
    echo [ERROR] failed to sync the project skill mirror.
    set "EXIT_CODE=1"
    goto finish
  )
) else (
  echo [INFO] project mirror sync skipped on !CURRENT_BRANCH!; use feature/workflow.
)

echo [OK] CODEX-CONFIG and personal skill links are current.
set "EXIT_CODE=0"

:finish
echo.
pause
exit /b %EXIT_CODE%
