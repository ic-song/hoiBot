@echo off
chcp 65001 > nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-runtime-repair.ps1"
if errorlevel 1 (echo [FAIL] 복구가 완료되지 않았습니다.)
pause
