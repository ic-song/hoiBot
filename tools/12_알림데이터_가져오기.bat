@echo off
chcp 65001 > nul
setlocal
echo noticeData.json 한 파일을 PC 백업 폴더로 가져옵니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull_notice_data.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
