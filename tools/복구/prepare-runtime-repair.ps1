param(
    [string]$AdbExe = 'C:\LDPlayer\LDPlayer9\adb.exe',
    [string]$Device = '',
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = ConvertFrom-Json ([IO.File]::ReadAllText($manifestPath, $utf8))
$snapshot = '19e1b774007ecff2c878c105d045346483658a8a'
if ($manifest.sourceSnapshotCommit -cne $snapshot -or $manifest.targetBotVersion -cne '2.782') { throw '이 복구 도구의 백업 정보가 다릅니다.' }
$memberName = 'member.json.guildwar-rollback'
$journalName = 'guildWarPending.json'
$working = Join-Path ([IO.Path]::GetTempPath()) ('hoiBot-musou-package-' + [guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($working) | Out-Null
$archive = Join-Path $working 'source.zip'
$saved = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $output = @(& git -C $repo archive --format=zip -o $archive $snapshot -- ('data/' + $memberName) ('data/' + $journalName) 2>&1)
    $code = $LASTEXITCODE
} finally { $ErrorActionPreference = $saved }
if ($code -ne 0) { throw ("보존된 백업을 읽지 못했습니다.`n" + ($output -join "`n")) }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$originalRoot = Join-Path $working 'source'
[IO.Compression.ZipFile]::ExtractToDirectory($archive, $originalRoot)
$originalMember = Join-Path (Join-Path $originalRoot 'data') $memberName
$originalJournal = Join-Path (Join-Path $originalRoot 'data') $journalName

# 원본과 생성 파일의 바이트·해시가 검증한 고정 복구 묶음과 같은지 확인한다.
function Assert-PreparedFile([string]$Path, $Entry) {
    if ($null -eq $Entry -or -not [IO.File]::Exists($Path)) { throw '복구 파일 검증 정보가 없습니다.' }
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
    if ((Get-Item -LiteralPath $Path).Length -ne $Entry.bytes -or $hash -cne $Entry.sha256) { throw "검증한 복구 파일과 다릅니다: $Path" }
}
$memberBefore = @($manifest.expected | Where-Object { $_.name -ceq $memberName })
$journalBefore = @($manifest.expected | Where-Object { $_.name -ceq $journalName })
$memberAfter = @($manifest.apply | Where-Object { $_.name -ceq $memberName })
$journalAfter = @($manifest.apply | Where-Object { $_.name -ceq $journalName })
if ($memberBefore.Count -ne 1 -or $journalBefore.Count -ne 1 -or $memberAfter.Count -ne 1 -or $journalAfter.Count -ne 1) { throw '복구 대상 정보가 다릅니다.' }
Assert-PreparedFile $originalMember $memberBefore[0]
Assert-PreparedFile $originalJournal $journalBefore[0]
$text = [IO.File]::ReadAllText($originalMember, $utf8)
$pattern = '("memberStorageSplit20261012"\s*:\s*\{[^{}]*"logsRevision"\s*:\s*)1398(?=\s*[,}])'
$regex = New-Object Text.RegularExpressions.Regex($pattern)
if ($regex.Matches($text).Count -ne 1) { throw '회원 파일의 복구 대상 표시가 다릅니다.' }
$repairedMember = $regex.Replace($text, [Text.RegularExpressions.MatchEvaluator]{ param($match) $match.Groups[1].Value + '1397' })
$journalText = [IO.File]::ReadAllText($originalJournal, $utf8)
if ([regex]::Matches($journalText, [regex]::Escape($memberBefore[0].sha256)).Count -ne 1) { throw '복구 저널의 회원 해시가 다릅니다.' }
$repairedJournal = $journalText.Replace($memberBefore[0].sha256, $memberAfter[0].sha256)
$apply = Join-Path $working 'apply'
[IO.Directory]::CreateDirectory($apply) | Out-Null
[IO.File]::WriteAllText((Join-Path $apply $memberName), $repairedMember, $utf8)
[IO.File]::WriteAllText((Join-Path $apply $journalName), $repairedJournal, $utf8)
Assert-PreparedFile (Join-Path $apply $memberName) $memberAfter[0]
Assert-PreparedFile (Join-Path $apply $journalName) $journalAfter[0]
[IO.File]::Copy($manifestPath, (Join-Path $working 'manifest.json'))
Write-Host "복구 파일 준비 완료: $working"
if ($PrepareOnly) {
    Write-Output $working
} else {
    & (Join-Path $PSScriptRoot 'apply-runtime-repair.ps1') -PackageRoot $working -AdbExe $AdbExe -Device $Device
}
