param(
    [string]$AdbExe = 'C:\LDPlayer\LDPlayer9\adb.exe',
    [string]$Device = '',
    [switch]$ValidatePackageOnly,
    [string]$PackageRoot = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$package = [IO.Path]::GetFullPath($PackageRoot)
$manifest = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $package 'manifest.json'), $utf8))
$remoteRoot = '/sdcard/호이랜드'

function Get-RepairHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Assert-RepairFile([string]$Path, $Entry) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "파일 없음: $Path" }
    $bytes = (Get-Item -LiteralPath $Path).Length
    $hash = Get-RepairHash $Path
    foreach ($candidate in (@($Entry) + @($Entry.alternatives))) {
        if ($null -ne $candidate -and $bytes -eq $candidate.bytes -and $hash -ceq $candidate.sha256) { return }
    }
    throw "파일 검증 실패: $Path"
}
function Invoke-RepairAdb([string[]]$Arguments) {
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& $AdbExe @Arguments 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $saved }
    if ($code -ne 0) { throw ("ADB 실패: " + ($Arguments -join ' ') + "`n" + ($lines -join "`n")) }
    return $lines
}
if ($manifest.version -ne 1 -or $manifest.targetBotVersion -ne '2.782' -or @($manifest.apply).Count -ne 2) { throw '복구 묶음 형식 오류' }
$requiredApply = @('member.json.guildwar-rollback', 'guildWarPending.json')
for ($i = 0; $i -lt 2; $i++) {
    if ($manifest.apply[$i].name -cne $requiredApply[$i]) { throw '허용되지 않은 복구 대상' }
    Assert-RepairFile (Join-Path (Join-Path $package 'apply') $requiredApply[$i]) $manifest.apply[$i]
}
foreach ($entry in $manifest.expected) {
    if ($entry.name -notmatch '^[A-Za-z0-9_.-]+$') { throw '잘못된 파일 경로' }
}
if ($ValidatePackageOnly) { Write-Host '[OK] 복구 파일 2개 검증 완료'; exit 0 }
if (-not (Test-Path -LiteralPath $AdbExe -PathType Leaf)) { throw "ADB 실행 파일 없음: $AdbExe" }
Write-Host '메신저봇을 꺼둔 상태에서 실행하는 운영자용 데이터 복구입니다.'
if (-not $Device) {
    $devices = @(Invoke-RepairAdb @('devices') | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] })
    if ($devices.Count -ne 1) { throw '연결된 기기가 하나여야 합니다. 필요하면 -Device로 지정하세요.' }
    $Device = $devices[0]
}
if ($Device -notmatch '^[A-Za-z0-9_.:-]+$') { throw '잘못된 기기 식별자' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('hoiBot-musou-repair-' + [guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($work) | Out-Null
Write-Host "원본 보존 폴더: $work"

# 검사한 중단 시점과 같은 데이터인지 모두 대조한 뒤 첫 업로드를 시작한다.
foreach ($entry in $manifest.expected) {
    $remote = $remoteRoot + '/' + $entry.name
    if ($entry.exists) {
        $local = Join-Path $work $entry.name
        Invoke-RepairAdb @('-s', $Device, 'pull', $remote, $local) | Out-Null
        Assert-RepairFile $local $entry
    } else {
        $result = (Invoke-RepairAdb @('-s', $Device, 'shell', "if [ -e '$remote' ]; then echo PRESENT; else echo ABSENT; fi")) -join ''
        if ($result.Trim() -cne 'ABSENT') { throw "백업 이후 상태가 바뀌었습니다: $($entry.name)" }
    }
}
$staged = @()
$replacing = $false
try {
    foreach ($entry in $manifest.apply) {
        $stage = $remoteRoot + '/' + $entry.name + '.musou-repair-stage'
        $staged += $stage
        Invoke-RepairAdb @('-s', $Device, 'push', (Join-Path (Join-Path $package 'apply') $entry.name), $stage) | Out-Null
        $check = Join-Path $work ($entry.name + '.stage-check')
        Invoke-RepairAdb @('-s', $Device, 'pull', $stage, $check) | Out-Null
        Assert-RepairFile $check $entry
    }
    $replacing = $true
    foreach ($entry in $manifest.apply) {
        $remote = $remoteRoot + '/' + $entry.name
        Invoke-RepairAdb @('-s', $Device, 'shell', "mv -f '$remote.musou-repair-stage' '$remote'" ) | Out-Null
        $check = Join-Path $work ($entry.name + '.applied-check')
        Invoke-RepairAdb @('-s', $Device, 'pull', $remote, $check) | Out-Null
        Assert-RepairFile $check $entry
    }
    $replacing = $false
} catch {
    $originalError = $_
    if ($replacing) {
        foreach ($entry in $manifest.apply) {
            $original = @($manifest.expected | Where-Object { $_.name -ceq $entry.name })
            if ($original.Count -ne 1 -or -not $original[0].exists) { throw "원본 복원 정보 오류. 원본 보존 위치: $work" }
            Invoke-RepairAdb @('-s', $Device, 'push', (Join-Path $work $entry.name), ($remoteRoot + '/' + $entry.name)) | Out-Null
            $check = Join-Path $work ($entry.name + '.restored-check')
            Invoke-RepairAdb @('-s', $Device, 'pull', ($remoteRoot + '/' + $entry.name), $check) | Out-Null
            Assert-RepairFile $check $original[0]
        }
        Write-Host '두 대상 파일을 적용 전 원본으로 복원했습니다.'
    }
    throw $originalError
} finally {
    foreach ($stage in $staged) {
        try { Invoke-RepairAdb @('-s', $Device, 'shell', "rm -f '$stage'") | Out-Null } catch { Write-Warning "임시 업로드 파일 정리 실패: $stage" }
    }
}
Write-Host '[OK] 데이터 복구 요청 적용 완료'
Write-Host '이제 최신 운영 소스로 03_main_운영반영.bat를 실행한 뒤 MessengerBot에서 컴파일하세요.'
Write-Host '컴파일 및 /호이봇버전 결과 ver_2.782를 확인해 주세요.'
