@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0.."
if errorlevel 1 exit /b 1
echo 인형 고정 목록만 갱신합니다. 수집 기록과 누적 매력은 변경하지 않습니다.
echo 완료 후 03_main_운영반영.bat으로 main을 반영하여 목록 캐시를 갱신하세요.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy_doll_catalog.ps1"
set RESULT=%ERRORLEVEL%
pause
exit /b %RESULT%
