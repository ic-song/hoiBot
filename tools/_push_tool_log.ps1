param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [string]$Branch = "feature/prod"
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

try {
    if (-not (Test-Path -LiteralPath $LogPath)) {
        Write-Host "[LOG] log file not found, skip git push: $LogPath"
        exit 0
    }

    $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
    $log = (Resolve-Path -LiteralPath $LogPath).Path
    Push-Location $repo

    $repoWithSlash = $repo.TrimEnd("\") + "\"
    $relativeUri = (New-Object System.Uri($repoWithSlash)).MakeRelativeUri((New-Object System.Uri($log)))
    $relativePath = [System.Uri]::UnescapeDataString($relativeUri.ToString())
    $indexPath = Join-Path $env:TEMP ("hoibot_tool_log_index_" + [System.Guid]::NewGuid().ToString("N"))
    $oldIndex = $env:GIT_INDEX_FILE
    $env:GIT_INDEX_FILE = $indexPath
    if (-not $env:GIT_AUTHOR_NAME) { $env:GIT_AUTHOR_NAME = "hoiBot tool log" }
    if (-not $env:GIT_AUTHOR_EMAIL) { $env:GIT_AUTHOR_EMAIL = "hoibot-tool-log@example.local" }
    if (-not $env:GIT_COMMITTER_NAME) { $env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME }
    if (-not $env:GIT_COMMITTER_EMAIL) { $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL }

    $pushed = $false
    for ($attempt = 1; $attempt -le 3 -and -not $pushed; $attempt++) {
        $baseCommit = $null
        $remoteBranch = git ls-remote --heads origin $Branch 2>$null
        if ($LASTEXITCODE -eq 0 -and $remoteBranch) {
            git fetch origin "$Branch`:refs/remotes/origin/$Branch" --quiet
            $baseResult = git rev-parse --verify "origin/$Branch^{commit}" 2>$null
            if ($LASTEXITCODE -eq 0 -and $baseResult) {
                $baseCommit = $baseResult.Trim()
            }
        }

        if ($baseCommit) {
            git read-tree $baseCommit
        } else {
            git read-tree --empty
        }

        $blob = (git hash-object -w -- $log).Trim()
        git update-index --add --cacheinfo "100644,$blob,$relativePath"
        $tree = (git write-tree).Trim()
        $message = "log: tool execution log"

        if ($baseCommit) {
            $commit = (git commit-tree $tree -p $baseCommit -m $message).Trim()
        } else {
            $commit = (git commit-tree $tree -m $message).Trim()
        }

        $pushOut = Join-Path $env:TEMP ("hoibot_tool_log_push_out_" + [System.Guid]::NewGuid().ToString("N"))
        $pushErr = Join-Path $env:TEMP ("hoibot_tool_log_push_err_" + [System.Guid]::NewGuid().ToString("N"))
        $push = Start-Process -FilePath "git" -ArgumentList @("push", "origin", "$commit`:refs/heads/$Branch", "--quiet") -NoNewWindow -Wait -PassThru -RedirectStandardOutput $pushOut -RedirectStandardError $pushErr
        Remove-Item -LiteralPath $pushOut, $pushErr -Force -ErrorAction SilentlyContinue

        if ($push.ExitCode -eq 0) {
            $pushed = $true
            Write-Host "[LOG] pushed execution log to $Branch`: $relativePath"
        } elseif ($attempt -lt 3) {
            Write-Host "[LOG][WARN] execution log push conflict, retrying ($attempt/3)"
            Start-Sleep -Seconds 1
        }
    }

    if (-not $pushed) {
        Write-Host "[LOG][WARN] execution log git push failed after retries: $relativePath"
    }
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
