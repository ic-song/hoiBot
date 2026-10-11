param([string]$RepoPath)

$ErrorActionPreference = 'Stop'

# Execute Git and reject failed commands before any backup can start.
function Invoke-HoiBackupGit([string]$Root, [string[]]$Arguments) {
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& git -C $Root @Arguments 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($code -ne 0) { throw ('Git 실패: ' + ($Arguments -join ' ') + "`n" + ($lines -join "`n")) }
    return ($lines -join "`n").Trim()
}

# Update only clean hoi/prod branches that can advance without losing commits.
function Sync-HoiBackupSource([string]$Root) {
    if (-not $Root) { throw '저장소 경로가 필요합니다.' }
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd([char]92, [char]47)
    $actualRoot = Invoke-HoiBackupGit $rootPath @('rev-parse', '--show-toplevel')
    if (-not [IO.Path]::GetFullPath($actualRoot).Equals($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw '저장소 최상위 폴더에서만 실행할 수 있습니다.'
    }
    $branch = Invoke-HoiBackupGit $rootPath @('branch', '--show-current')
    if ($branch -ne 'feature/hoi' -and $branch -ne 'feature/prod') {
        throw "feature/hoi 또는 feature/prod에서 실행하세요. 현재: $branch"
    }
    $dirty = Invoke-HoiBackupGit $rootPath @('status', '--porcelain=v1', '--untracked-files=all')
    if ($dirty) { throw '로컬 변경 파일이 있습니다. 변경 내용을 보존하고 중단합니다.' }
    $before = Invoke-HoiBackupGit $rootPath @('rev-parse', 'HEAD')
    Invoke-HoiBackupGit $rootPath @('fetch', 'origin', '+refs/heads/feature/prod:refs/remotes/origin/feature/prod') | Out-Null
    $target = Invoke-HoiBackupGit $rootPath @('rev-parse', 'origin/feature/prod')
    try {
        Invoke-HoiBackupGit $rootPath @('merge-base', '--is-ancestor', $before, $target) | Out-Null
    } catch { throw '운영에 반영되지 않은 커밋 또는 갈라진 이력이 있습니다. 덮어쓰지 않고 중단합니다.' }
    $currentBranch = Invoke-HoiBackupGit $rootPath @('branch', '--show-current')
    $currentHead = Invoke-HoiBackupGit $rootPath @('rev-parse', 'HEAD')
    $dirty = Invoke-HoiBackupGit $rootPath @('status', '--porcelain=v1', '--untracked-files=all')
    if ($currentBranch -ne $branch -or $currentHead -ne $before -or $dirty) {
        throw '최신화 중 로컬 상태가 바뀌어 중단합니다.'
    }
    Invoke-HoiBackupGit $rootPath @('-c', 'merge.autoStash=false', 'merge', '--ff-only', $target) | Out-Null
    $after = Invoke-HoiBackupGit $rootPath @('rev-parse', 'HEAD')
    $dirty = Invoke-HoiBackupGit $rootPath @('status', '--porcelain=v1', '--untracked-files=all')
    if ($after -ne $target -or $dirty) { throw '최신 운영 소스와 일치하지 않아 백업을 중단합니다.' }
    Write-Host "[OK] $branch = origin/feature/prod ($after)"
    return $after
}

if ($MyInvocation.InvocationName -ne '.') {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    try { Sync-HoiBackupSource $RepoPath | Out-Null; exit 0 }
    catch { Write-Host ('[FAIL] ' + $_.Exception.Message); exit 1 }
}
