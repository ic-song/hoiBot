param(
    [string]$AdbExe = 'C:\LDPlayer\LDPlayer9\adb.exe',
    [string]$LdConsoleExe = 'C:\LDPlayer\LDPlayer9\ldconsole.exe',
    [string]$TargetLdIndex = 'auto',
    [string]$TargetDevice = 'auto',
    [string]$DestinationRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'public\hoiBot-notice-backups')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$remote = '/sdcard/호이랜드_notice/noticeData.json'
$backup = Join-Path $DestinationRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))

try {
    if (-not (Test-Path -LiteralPath $AdbExe -PathType Leaf)) { throw "ADB not found: $AdbExe" }
    [IO.Directory]::CreateDirectory($backup) | Out-Null
    $connection = Join-Path $backup 'connection.txt'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'connect_legacy_adb.ps1') -AdbExe $AdbExe -LdConsoleExe $LdConsoleExe -TargetFile '/storage/emulated/0/hoiland/hoiland/Bots/main/main.js' -TargetLdIndex $TargetLdIndex -TargetDevice $TargetDevice -ResultFile $connection
    if ($LASTEXITCODE -ne 0) { throw 'Device selection failed.' }
    $settings = Get-Content -LiteralPath $connection -Encoding UTF8 | ConvertFrom-StringData
    $device = $settings.TARGET_ADB_DEVICE
    if (-not $device -or $device -notmatch '^[a-zA-Z0-9._:-]+$' -or $settings.USE_DIRECT_ADB -ne '1') {
        throw 'Verified direct ADB connection is required.'
    }

    # 파싱하지 않고 원본 바이트 그대로 복사하여 손상된 JSON도 조사용으로 보존합니다.
    $local = Join-Path $backup 'noticeData.json'
    & $AdbExe -s $device pull $remote $local
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $local -PathType Leaf)) {
        throw 'noticeData.json pull failed. Any partial local file is not a complete backup.'
    }
    Write-Host ('[OK] Saved: ' + $local)
    Write-Host ('[SHA256] ' + (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash)
    Write-Host '이 파일을 Codex 채팅에 첨부해주세요. 기기의 원본 파일은 변경하지 않았습니다.'
    exit 0
} catch {
    Write-Host ('[FAIL] ' + $_.Exception.Message)
    Write-Host ('[LOG] ' + $backup)
    exit 1
}
