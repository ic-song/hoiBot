param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [string]$Branch = "feature/tool-logs"
)

$ErrorActionPreference = "Stop"

try {
    if (-not (Test-Path -LiteralPath $LogPath)) {
        Write-Host "[LOG] log file not found, skip git push: $LogPath"
        exit 0
    }

    $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
    $log = (Resolve-Path -LiteralPath $LogPath).Path
    Push-Location $repo

    $relativePath = [System.IO.Path]::GetRelativePath($repo, $log).Replace("\", "/")
    $indexPath = Join-Path $env:TEMP ("hoibot_tool_log_index_" + [System.Guid]::NewGuid().ToString("N"))
    $oldIndex = $env:GIT_INDEX_FILE
    $env:GIT_INDEX_FILE = $indexPath

    git fetch origin $Branch --quiet 2>$null
    $baseCommit = $null
    $baseResult = git rev-parse --verify "origin/$Branch^{commit}" 2>$null
    if ($LASTEXITCODE -eq 0 -and $baseResult) {
        $baseCommit = $baseResult.Trim()
        git read-tree $baseCommit
    } else {
        git read-tree --empty
    }

    $blob = (git hash-object -w -- $log).Trim()
    git update-index --add --cacheinfo "100644,$blob,$relativePath"
    $tree = (git write-tree).Trim()
    $message = "로그: " + [System.IO.Path]::GetFileName($log)

    if ($baseCommit) {
        $commit = ($message | git commit-tree $tree -p $baseCommit).Trim()
    } else {
        $commit = ($message | git commit-tree $tree).Trim()
    }

    git push origin "$commit`:refs/heads/$Branch" --quiet
    Write-Host "[LOG] pushed execution log to $Branch`: $relativePath"
} catch {
    Write-Host "[LOG][WARN] execution log git push failed: $($_.Exception.Message)"
} finally {
    if ($oldIndex) {
        $env:GIT_INDEX_FILE = $oldIndex
    } else {
        Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue
    }
    if ($indexPath -and (Test-Path -LiteralPath $indexPath)) {
        Remove-Item -LiteralPath $indexPath -Force -ErrorAction SilentlyContinue
    }
    Pop-Location -ErrorAction SilentlyContinue
}
