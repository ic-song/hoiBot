@echo off
chcp 65001 > nul
setlocal EnableExtensions

title hoiBot ADB connection trace
echo ============================================================
echo  hoiBot 최근 ADB 연결 진단 기록
echo  ADB 연결이나 업로드 명령은 실행하지 않습니다.
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $trace = Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Filter 'hoibot_*_deploy_*.log.trace.log' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($null -eq $trace) { Write-Host '[FAIL] ADB connection trace was not found. Run 03 or 04 with the latest tools first.'; exit 1 }; Write-Host ('[SUPERVISOR] ' + $trace.FullName); Get-Content -LiteralPath $trace.FullName -Encoding UTF8; $worker = $trace.FullName + '.worker.log'; if (Test-Path -LiteralPath $worker) { Write-Host ('[WORKER] ' + $worker); Get-Content -LiteralPath $worker -Encoding UTF8 }"
set "TRACE_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %TRACE_EXIT_CODE%
