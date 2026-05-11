@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0.."
set "CODEX_HOME=%USERPROFILE%\.codex"

echo [hoiBot] Codex skills install/update
echo ROOT=%ROOT%
echo CODEX_HOME=%CODEX_HOME%

if not exist "%ROOT%\.codex\skills" (
  echo [ERROR] repo skill source not found: %ROOT%\.codex\skills
  exit /b 1
)

if not exist "%CODEX_HOME%\skills" mkdir "%CODEX_HOME%\skills"
if not exist "%CODEX_HOME%\skill-drafts-ko" mkdir "%CODEX_HOME%\skill-drafts-ko"

robocopy "%ROOT%\.codex\skills" "%CODEX_HOME%\skills" /E /NFL /NDL /NJH /NJS /NP
set "RC1=%ERRORLEVEL%"
if !RC1! GEQ 8 (
  echo [ERROR] failed to sync skills. robocopy exit code=!RC1!
  exit /b !RC1!
)

if exist "%ROOT%\.codex\skill-drafts-ko" (
  robocopy "%ROOT%\.codex\skill-drafts-ko" "%CODEX_HOME%\skill-drafts-ko" /E /NFL /NDL /NJH /NJS /NP
  set "RC2=%ERRORLEVEL%"
  if !RC2! GEQ 8 (
    echo [ERROR] failed to sync Korean drafts. robocopy exit code=!RC2!
    exit /b !RC2!
  )
)

echo [OK] Codex skills synced.
exit /b 0
