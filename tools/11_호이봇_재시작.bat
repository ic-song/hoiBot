@echo off
chcp 65001 > nul
setlocal EnableExtensions

set "LD_CONSOLE_EXE=C:\LDPlayer\LDPlayer9\ldconsole.exe"

title hoiBot LDPlayer restart - index 1
echo.
echo  1번 호이봇 종료 후 재실행 - 카카오톡 - 메신저봇R
echo  실행 중인 1번도 종료합니다. 0번 알림봇은 유지합니다.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart_hoibot_ldplayer.ps1" -LdConsoleExe "%LD_CONSOLE_EXE%"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
