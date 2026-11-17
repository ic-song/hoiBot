param(
    [string]$AdbExe = 'C:\LDPlayer\LDPlayer9\adb.exe',
    [string]$LdConsoleExe = 'C:\LDPlayer\LDPlayer9\ldconsole.exe',
    [string]$TargetLdIndex = 'auto',
    [string]$TargetDevice = 'auto'
)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '..\data\dollCatalog.json'
$target = '/sdcard/호이랜드/dollCatalog.json'
$staged = $target + '.upload-' + [guid]::NewGuid().ToString('N')
$work = Join-Path ([IO.Path]::GetTempPath()) ('hoibot-doll-deploy-' + [guid]::NewGuid().ToString('N'))
$device = $null

# ADB 종료 코드와 오류 응답을 확인하는 함수
function Invoke-DollAdb([string[]]$Arguments) {
    $output = & $AdbExe -s $device @Arguments 2>&1
    if ($LASTEXITCODE -ne 0 -or ($output -join "`n") -match '(?im)\b(error|failed|not found|no such file)\b') {
        throw ('ADB failed: ' + ($output -join "`n"))
    }
}

try {
    $catalog = Get-Content -LiteralPath $source -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($catalog.schemaVersion -ne 1 -or $catalog.dolls -isnot [array] -or $catalog.dolls.Count -ne 1344) {
        throw 'Local catalog must contain 1,344 dolls with schemaVersion 1.'
    }
    for ($i = 0; $i -lt 1344; $i++) {
        if ($catalog.dolls[$i].id -cne ('D{0:0000}' -f ($i + 1))) { throw 'Invalid local doll ID order.' }
    }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    New-Item -ItemType Directory -Path $work | Out-Null
    $connection = Join-Path $work 'connection.txt'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'connect_legacy_adb.ps1') -AdbExe $AdbExe -LdConsoleExe $LdConsoleExe -TargetFile '/storage/emulated/0/hoiland/hoiland/Bots/main/main.js' -TargetLdIndex $TargetLdIndex -TargetDevice $TargetDevice -ResultFile $connection
    if ($LASTEXITCODE -ne 0) { throw 'Device selection failed.' }
    $settings = Get-Content -LiteralPath $connection -Encoding UTF8 | ConvertFrom-StringData
    $device = $settings.TARGET_ADB_DEVICE
    if (-not $device -or $settings.USE_DIRECT_ADB -ne '1') { throw 'Verified direct ADB connection is required.' }

    $oldFile = Join-Path $work 'old.json'
    Invoke-DollAdb @('pull', $target, $oldFile)
    $old = Get-Content -LiteralPath $oldFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($old.schemaVersion -ne 1 -or $old.dolls -isnot [array] -or $old.dolls.Count -notin @(1000, 1344)) {
        throw 'Existing catalog is invalid. No catalog was replaced.'
    }
    # 기존 ID 정의가 달라진 상태에서는 교체하지 않는다.
    foreach ($i in 0..($old.dolls.Count - 1)) {
        foreach ($field in @('id', 'name', 'grade', 'minTenths', 'maxTenths', 'largeTenths', 'giantTenths')) {
            if ($old.dolls[$i].$field -cne $catalog.dolls[$i].$field) { throw ('Existing doll differs: ' + $old.dolls[$i].id + '/' + $field) }
        }
        if (($old.dolls[$i].special -eq $true) -ne ($catalog.dolls[$i].special -eq $true)) { throw 'Existing special flag differs.' }
    }
    if ((Get-FileHash -LiteralPath $oldFile -Algorithm SHA256).Hash -eq $sourceHash) {
        Write-Host '[OK] Catalog is already current. No upload needed.'
        exit 0
    }

    Invoke-DollAdb @('push', $source, $staged)
    $checkFile = Join-Path $work 'uploaded.json'
    Invoke-DollAdb @('pull', $staged, $checkFile)
    if ((Get-FileHash -LiteralPath $checkFile -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Uploaded catalog hash mismatch.' }
    Invoke-DollAdb @('shell', "mv '$staged' '$target'")
    Write-Host '[OK] Updated dollCatalog.json (1,344 dolls). Run 03_main deployment to refresh the catalog cache.'
    exit 0
} catch {
    Write-Host ('[FAIL] ' + $_.Exception.Message)
    exit 1
} finally {
    if ($device) {
        try { Invoke-DollAdb @('shell', "rm -f '$staged'") } catch { Write-Warning 'Could not remove the staged catalog.' }
    }
    foreach ($name in @('connection.txt', 'old.json', 'uploaded.json')) {
        $temporaryFile = Join-Path $work $name
        if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
    }
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Force }
}
