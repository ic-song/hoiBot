param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("BuildRemote", "BuildLocal", "Compare", "CheckRequired")]
    [string]$Mode,
    [string]$StatPath,
    [string]$HashPath,
    [string]$Root,
    [string]$RemoteRoot,
    [string]$OutputPath,
    [string]$LeftPath,
    [string]$RightPath,
    [string]$SnapshotId,
    [string]$CapturedAt,
    [string]$RequiredFiles
)

$ErrorActionPreference = "Stop"

# SHA256 문자열을 계산합니다.
function Get-Sha256Text([string]$Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
    } finally {
        $sha.Dispose()
    }
}

# 상대경로가 snapshot 루트 밖을 가리키지 않는지 확인합니다.
function Assert-SafeRelativePath([string]$RelativePath) {
    if ([string]::IsNullOrWhiteSpace($RelativePath)) { throw "empty relative path" }
    if ($RelativePath.StartsWith("/") -or $RelativePath.StartsWith("\")) { throw "absolute path" }
    $segments = @($RelativePath.Replace("\", "/").Split("/"))
    if ($segments -contains "..") { throw "parent traversal" }
}

# metadata-only manifest를 UTF-8(BOM 없음) JSON으로 저장합니다.
function Write-Manifest($Files, [string]$Destination, [string]$Id, [string]$Timestamp) {
    $rows = New-Object System.Collections.Generic.List[string]
    [long]$totalBytes = 0
    foreach ($file in $Files) {
        $rows.Add($file.relativePath + "|" + $file.size + "|" + $file.sha256)
        $totalBytes += [long]$file.size
    }
    $treeHash = Get-Sha256Text ($rows -join "`n")
    $manifest = [ordered]@{
        schemaVersion = 1
        snapshotId = $Id
        capturedAt = $Timestamp
        fileCount = $Files.Count
        totalBytes = $totalBytes
        treeSha256 = $treeHash
        files = $Files
    }
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Destination, ($manifest | ConvertTo-Json -Depth 5), $utf8)
    Write-Output ("FILE_COUNT=" + $Files.Count)
    Write-Output ("TOTAL_BYTES=" + $totalBytes)
    Write-Output ("TREE_SHA256=" + $treeHash)
}

if ($Mode -eq "BuildRemote") {
    if (-not (Test-Path -LiteralPath $StatPath -PathType Leaf)) { throw "stat output missing" }
    if (-not (Test-Path -LiteralPath $HashPath -PathType Leaf)) { throw "hash output missing" }
    $prefix = $RemoteRoot.TrimEnd("/") + "/"
    $sizes = New-Object 'System.Collections.Generic.Dictionary[string,long]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in [System.IO.File]::ReadAllLines($StatPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch '^([0-9]+)\s+(.+)$') { throw "invalid stat output" }
        $fullPath = $Matches[2].Trim().Trim("'").Replace("\", "/")
        if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::Ordinal)) { throw "path outside remote root" }
        $relativePath = $fullPath.Substring($prefix.Length)
        Assert-SafeRelativePath $relativePath
        if ($sizes.ContainsKey($relativePath)) { throw "duplicate remote path" }
        $sizes.Add($relativePath, [long]$Matches[1])
    }
    $hashes = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($line in [System.IO.File]::ReadAllLines($HashPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch '^([0-9a-fA-F]{64})\s+(.+)$') { throw "invalid hash output" }
        $fullPath = $Matches[2].Trim().Replace("\", "/")
        if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::Ordinal)) { throw "hash path outside remote root" }
        $relativePath = $fullPath.Substring($prefix.Length)
        Assert-SafeRelativePath $relativePath
        if ($hashes.ContainsKey($relativePath)) { throw "duplicate hash path" }
        $hashes.Add($relativePath, $Matches[1].ToUpperInvariant())
    }
    if ($sizes.Count -eq 0 -or $sizes.Count -ne $hashes.Count) { throw "remote metadata count mismatch" }
    $keys = @($sizes.Keys)
    [System.Array]::Sort($keys, [System.StringComparer]::Ordinal)
    $files = New-Object System.Collections.Generic.List[object]
    foreach ($key in $keys) {
        if (-not $hashes.ContainsKey($key)) { throw "remote hash missing" }
        $files.Add([ordered]@{ relativePath = $key.Replace("\", "/"); size = $sizes[$key]; sha256 = $hashes[$key] })
    }
    Write-Manifest $files $OutputPath $SnapshotId $CapturedAt
    exit 0
}

if ($Mode -eq "BuildLocal") {
    $resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")
    $sourceFiles = @(Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse)
    if ($sourceFiles.Count -eq 0) { throw "local snapshot is empty" }
    $byPath = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($sourceFile in $sourceFiles) {
        $relativePath = $sourceFile.FullName.Substring($resolvedRoot.Length).TrimStart("\").Replace("\", "/")
        Assert-SafeRelativePath $relativePath
        if ($byPath.ContainsKey($relativePath)) { throw "case-insensitive duplicate local path" }
        $byPath.Add($relativePath, [ordered]@{
            relativePath = $relativePath
            size = [long]$sourceFile.Length
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceFile.FullName).Hash.ToUpperInvariant()
        })
    }
    $keys = @($byPath.Keys)
    [System.Array]::Sort($keys, [System.StringComparer]::Ordinal)
    $files = New-Object System.Collections.Generic.List[object]
    foreach ($key in $keys) { $files.Add($byPath[$key]) }
    Write-Manifest $files $OutputPath $SnapshotId $CapturedAt
    exit 0
}

if ($Mode -eq "Compare") {
    $left = Get-Content -Raw -LiteralPath $LeftPath | ConvertFrom-Json
    $right = Get-Content -Raw -LiteralPath $RightPath | ConvertFrom-Json
    $leftFileCount = [long]$left.fileCount
    $rightFileCount = [long]$right.fileCount
    $leftTotalBytes = [long]$left.totalBytes
    $rightTotalBytes = [long]$right.totalBytes
    if ($leftFileCount -ne $rightFileCount) { throw "file count mismatch" }
    if ($leftTotalBytes -ne $rightTotalBytes) { throw "total bytes mismatch" }
    if ([string]$left.treeSha256 -cne [string]$right.treeSha256) { throw "tree hash mismatch" }
    Write-Output ("PARITY_FILE_COUNT=" + $left.fileCount)
    Write-Output ("PARITY_TOTAL_BYTES=" + $left.totalBytes)
    Write-Output ("PARITY_TREE_SHA256=" + $left.treeSha256)
    exit 0
}

if ($Mode -eq "CheckRequired") {
    $required = @($RequiredFiles.Split(";") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $missing = 0
    foreach ($relativePath in $required) {
        Assert-SafeRelativePath $relativePath
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relativePath.Replace("/", "\")) -PathType Leaf)) { $missing++ }
    }
    Write-Output ("REQUIRED_COUNT=" + $required.Count)
    Write-Output ("REQUIRED_MISSING_COUNT=" + $missing)
    if ($missing -gt 0) { exit 71 }
    exit 0
}
