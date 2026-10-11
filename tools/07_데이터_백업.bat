@echo off
chcp 65001 > nul
setlocal EnableExtensions EnableDelayedExpansion
rem Parse this entire block before updating this launcher on disk.
(
    echo [0/7] 최신 운영 소스로 갱신
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_legacy_backup_source.ps1" -RepoPath "%~dp0.."
    if errorlevel 1 (
        echo [FAIL] 최신화 실패 - 백업을 시작하지 않았습니다.
        pause
        exit /b 1
    ) else (
        rem Resolve the backup runner only after source refresh has completed.
        call "%~dp0backup_legacy_data.bat"
        exit /b !errorlevel!
    )
)
