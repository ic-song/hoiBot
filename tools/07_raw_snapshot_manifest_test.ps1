$ErrorActionPreference = "Stop"

$tool = Join-Path $PSScriptRoot "07_raw_snapshot_manifest.ps1"
$testRoot = Join-Path $env:TEMP ("hoibot-raw-manifest-test-" + [System.Guid]::NewGuid().ToString("N"))
$rawRoot = Join-Path $testRoot "raw"
$nestedRoot = Join-Path $rawRoot "nested"
$utf8 = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Path $nestedRoot -Force | Out-Null
try {
    [System.IO.File]::WriteAllText((Join-Path $rawRoot "member.json"), '{"member":{}}', $utf8)
    [System.IO.File]::WriteAllText((Join-Path $nestedRoot "game.txt"), "synthetic-value", $utf8)

    $statLines = New-Object System.Collections.Generic.List[string]
    $hashLines = New-Object System.Collections.Generic.List[string]
    foreach ($file in @(Get-ChildItem -LiteralPath $rawRoot -File -Recurse | Sort-Object Name -Descending)) {
        $relativePath = $file.FullName.Substring($rawRoot.Length).TrimStart("\").Replace("\", "/")
        $remotePath = "/storage/emulated/0/호이랜드/" + $relativePath
        $statLines.Add([string]$file.Length + " " + $remotePath)
        $hashLines.Add((Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash + "  " + $remotePath)
    }
    [System.IO.File]::WriteAllLines((Join-Path $testRoot "stat.txt"), $statLines, $utf8)
    [System.IO.File]::WriteAllLines((Join-Path $testRoot "hash.txt"), $hashLines, $utf8)

    & powershell -NoProfile -ExecutionPolicy Bypass -File $tool -Mode BuildRemote -StatPath (Join-Path $testRoot "stat.txt") -HashPath (Join-Path $testRoot "hash.txt") -RemoteRoot "/storage/emulated/0/호이랜드" -OutputPath (Join-Path $testRoot "remote.json") -SnapshotId "synthetic-1" -CapturedAt "2026-08-31T00:00:00+09:00" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "BuildRemote failed" }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tool -Mode BuildLocal -Root $rawRoot -OutputPath (Join-Path $testRoot "local.json") -SnapshotId "synthetic-1" -CapturedAt "2026-08-31T00:00:00+09:00" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "BuildLocal failed" }
    $remoteManifest = Get-Content -Raw -LiteralPath (Join-Path $testRoot "remote.json") | ConvertFrom-Json
    $localManifest = Get-Content -Raw -LiteralPath (Join-Path $testRoot "local.json") | ConvertFrom-Json
    Write-Output ("SYNTHETIC_REMOTE_TOTAL=" + $remoteManifest.totalBytes)
    Write-Output ("SYNTHETIC_LOCAL_TOTAL=" + $localManifest.totalBytes)
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tool -Mode Compare -LeftPath (Join-Path $testRoot "remote.json") -RightPath (Join-Path $testRoot "local.json") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Compare failed" }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tool -Mode CheckRequired -Root $rawRoot -RequiredFiles "member.json" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "CheckRequired failed" }

    [System.IO.File]::AppendAllText((Join-Path $rawRoot "member.json"), "x", $utf8)
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tool -Mode BuildLocal -Root $rawRoot -OutputPath (Join-Path $testRoot "tampered.json") -SnapshotId "synthetic-1" -CapturedAt "2026-08-31T00:00:00+09:00" 2>$null | Out-Null
    $ErrorActionPreference = "Continue"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $tool -Mode Compare -LeftPath (Join-Path $testRoot "remote.json") -RightPath (Join-Path $testRoot "tampered.json") 2>$null | Out-Null
    $tamperExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($tamperExitCode -eq 0) { throw "tamper was not detected" }

    $manifestText = [System.IO.File]::ReadAllText((Join-Path $testRoot "local.json"))
    if ($manifestText.Contains("synthetic-value")) { throw "raw content leaked into manifest" }
    Write-Output "SYNTHETIC_PARITY=PASS"
    Write-Output "TAMPER_DETECTION=PASS"
    Write-Output "CONTENT_NON_DISCLOSURE=PASS"
} finally {
    $resolved = [System.IO.Path]::GetFullPath($testRoot)
    $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
    if ($resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolved)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
