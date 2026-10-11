param([switch]$LauncherOnly)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'sync_legacy_backup_source.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('hoibot_sync_mock_' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$groups = 0

# Check synthetic fixture results without accessing any ADB device.
function Assert-Sync($Value, [string]$Message) { if (-not $Value) { throw $Message } }

# Create a local-only working copy at a selected fixture commit.
function New-SyncFixture([string]$Branch, [string]$Head) {
    $root = Join-Path (Join-Path $testRoot '한글 작업(테스트)') ([Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($root) | Out-Null
    Invoke-HoiBackupGit $root @('init', '-q') | Out-Null
    Invoke-HoiBackupGit $root @('config', 'user.name', 'Synthetic Backup Test') | Out-Null
    Invoke-HoiBackupGit $root @('config', 'user.email', 'fixture@example.invalid') | Out-Null
    Invoke-HoiBackupGit $root @('config', 'core.hooksPath', $hooks) | Out-Null
    Invoke-HoiBackupGit $root @('remote', 'add', 'origin', $origin) | Out-Null
    Invoke-HoiBackupGit $root @('fetch', 'origin', '+refs/heads/feature/prod:refs/remotes/origin/feature/prod') | Out-Null
    Invoke-HoiBackupGit $root @('switch', '-c', $Branch, $Head) | Out-Null
    return $root
}

# Reject refresh and verify the original HEAD and local changes are preserved.
function Expect-SyncFailure([string]$Root, [string]$ExpectedMessage) {
    $before = Invoke-HoiBackupGit $Root @('rev-parse', 'HEAD')
    $status = Invoke-HoiBackupGit $Root @('status', '--porcelain=v1', '--untracked-files=all')
    $failed = $false
    try { Sync-HoiBackupSource $Root | Out-Null } catch {
        $failed = $true
        Assert-Sync ($_.Exception.Message.Contains($ExpectedMessage)) ('Wrong failure: ' + $_.Exception.Message)
    }
    Assert-Sync $failed 'Unsafe refresh succeeded.'
    Assert-Sync ((Invoke-HoiBackupGit $Root @('rev-parse', 'HEAD')) -eq $before) 'HEAD was overwritten.'
    Assert-Sync ((Invoke-HoiBackupGit $Root @('status', '--porcelain=v1', '--untracked-files=all')) -ceq $status) 'Local changes were overwritten.'
}

# Group meaningful workflow scenarios and print a compact result.
function Test-SyncGroup([string]$Name, [scriptblock]$Action) {
    if ($LauncherOnly -and -not $Name.StartsWith('Actual launcher')) { return }
    & $Action
    $script:groups++
    Write-Host "PASS $script:groups : $Name"
}

# Record the exit code in cmd itself, independently of PowerShell native status.
function Invoke-SyncLauncher([string]$Entry) {
    $id = [Guid]::NewGuid().ToString('N')
    $codeFile = Join-Path $testRoot ($id + '.txt')
    $harness = Join-Path $testRoot ($id + '.bat')
    $commands = @('@echo off', 'setlocal EnableExtensions EnableDelayedExpansion', 'chcp 65001 > nul',
        ('call "' + $Entry + '"'), ('echo !errorlevel!>"' + $codeFile + '"'), 'exit /b 0')
    [IO.File]::WriteAllText($harness, ($commands -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding($false)))
    $output = @(& $env:ComSpec /d /c $harness 2>&1)
    return @{ Code = [int]([IO.File]::ReadAllText($codeFile).Trim()); Output = $output }
}

try {
    $hooks = Join-Path $testRoot 'empty-hooks'
    [IO.Directory]::CreateDirectory($hooks) | Out-Null
    $origin = Join-Path $testRoot 'origin.git'
    Invoke-HoiBackupGit $testRoot @('init', '--bare', '-q', $origin) | Out-Null
    $seed = Join-Path $testRoot 'seed'
    [IO.Directory]::CreateDirectory((Join-Path $seed 'tools')) | Out-Null
    Invoke-HoiBackupGit $seed @('init', '-q', '-b', 'feature/prod') | Out-Null
    Invoke-HoiBackupGit $seed @('config', 'user.name', 'Synthetic Backup Test') | Out-Null
    Invoke-HoiBackupGit $seed @('config', 'user.email', 'fixture@example.invalid') | Out-Null
    Invoke-HoiBackupGit $seed @('config', 'core.hooksPath', $hooks) | Out-Null
    Invoke-HoiBackupGit $seed @('remote', 'add', 'origin', $origin) | Out-Null
    foreach ($name in @('07_데이터_백업.bat', 'sync_legacy_backup_source.ps1')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $seed ('tools/' + $name))
    }
    $runner = Join-Path $seed 'tools/backup_legacy_data.bat'
    [IO.File]::WriteAllText($runner, "@echo off`r`necho OLD> `"%~dp0..\ran.txt`"`r`nexit /b 11`r`n", [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $seed 'fixture.txt'), 'base')
    Invoke-HoiBackupGit $seed @('add', '.') | Out-Null
    Invoke-HoiBackupGit $seed @('commit', '-q', '-m', 'fixture base') | Out-Null
    $base = Invoke-HoiBackupGit $seed @('rev-parse', 'HEAD')
    [IO.File]::WriteAllText((Join-Path $seed 'fixture.txt'), 'latest')
    [IO.File]::WriteAllText($runner, "@echo off`r`necho NEW> `"%~dp0..\ran.txt`"`r`nexit /b 37`r`n", [Text.Encoding]::ASCII)
    $launcher = Join-Path $seed 'tools/07_데이터_백업.bat'
    $text = [IO.File]::ReadAllText($launcher)
    [IO.File]::WriteAllText($launcher, (('rem changed launcher length' + "`r`n") * 300) + $text, (New-Object Text.UTF8Encoding($false)))
    Invoke-HoiBackupGit $seed @('add', '.') | Out-Null
    Invoke-HoiBackupGit $seed @('commit', '-q', '-m', 'fixture latest runner and launcher') | Out-Null
    $latest = Invoke-HoiBackupGit $seed @('rev-parse', 'HEAD')
    Invoke-HoiBackupGit $seed @('push', '-q', 'origin', 'feature/prod') | Out-Null

    Test-SyncGroup 'Behind and equal hoi/prod update safely; branch is preserved' {
        foreach ($branch in @('feature/hoi', 'feature/prod')) {
            foreach ($head in @($base, $latest)) {
                $root = New-SyncFixture $branch $head
                Assert-Sync ((Sync-HoiBackupSource $root) -eq $latest) 'Latest source not selected.'
                Assert-Sync ((Invoke-HoiBackupGit $root @('branch', '--show-current')) -eq $branch) 'Source branch changed.'
            }
        }
    }
    Test-SyncGroup 'Unstaged, staged and untracked changes remain untouched' {
        foreach ($kind in @('unstaged', 'staged', 'untracked')) {
            $root = New-SyncFixture 'feature/hoi' $base
            $path = Join-Path $root $(if ($kind -eq 'untracked') { 'untracked.txt' } else { 'fixture.txt' })
            [IO.File]::WriteAllText($path, 'operator edit')
            if ($kind -eq 'staged') { Invoke-HoiBackupGit $root @('add', 'fixture.txt') | Out-Null }
            Expect-SyncFailure $root '로컬 변경'
            Assert-Sync ([IO.File]::ReadAllText($path) -ceq 'operator edit') 'Operator edit lost.'
        }
    }
    Test-SyncGroup 'Ahead and divergent unreflected commits are preserved' {
        foreach ($head in @($base, $latest)) {
            $root = New-SyncFixture 'feature/hoi' $head
            [IO.File]::WriteAllText((Join-Path $root 'local.txt'), 'unreflected')
            Invoke-HoiBackupGit $root @('add', 'local.txt') | Out-Null
            Invoke-HoiBackupGit $root @('commit', '-q', '-m', 'unreflected fixture') | Out-Null
            Expect-SyncFailure $root '반영되지 않은 커밋'
        }
    }
    Test-SyncGroup 'Wrong branch and detached HEAD stop before backup' {
        $root = New-SyncFixture 'feature/workflow' $base
        Expect-SyncFailure $root 'feature/hoi 또는 feature/prod'
        Invoke-HoiBackupGit $root @('switch', '--detach', $base) | Out-Null
        Expect-SyncFailure $root 'feature/hoi 또는 feature/prod'
    }
    Test-SyncGroup 'Fetch failure and missing production ref stop without using stale source' {
        $root = New-SyncFixture 'feature/hoi' $base
        Invoke-HoiBackupGit $root @('remote', 'set-url', 'origin', (Join-Path $testRoot 'missing.git')) | Out-Null
        Expect-SyncFailure $root 'Git 실패: fetch'
        $emptyOrigin = Join-Path $testRoot 'empty.git'
        Invoke-HoiBackupGit $testRoot @('init', '--bare', '-q', $emptyOrigin) | Out-Null
        Invoke-HoiBackupGit $root @('remote', 'set-url', 'origin', $emptyOrigin) | Out-Null
        Expect-SyncFailure $root 'Git 실패: fetch'
    }
    Test-SyncGroup 'Actual launcher self-update runs the NEW runner and propagates its exit code' {
        $root = New-SyncFixture 'feature/hoi' $base
        $entry = Join-Path $root 'tools/07_데이터_백업.bat'
        $result = Invoke-SyncLauncher $entry
        Assert-Sync ($result.Code -eq 37) ('Launcher exit code: ' + $result.Code + "`n" + ($result.Output -join "`n"))
        Assert-Sync ([IO.File]::ReadAllText((Join-Path $root 'ran.txt')).Trim() -eq 'NEW') 'Old backup runner executed.'
        Assert-Sync ((Invoke-HoiBackupGit $root @('rev-parse', 'HEAD')) -eq $latest) 'Launcher did not update source.'
    }
    Test-SyncGroup 'Actual launcher failure never invokes the backup runner' {
        $root = New-SyncFixture 'feature/hoi' $base
        [IO.File]::WriteAllText((Join-Path $root 'fixture.txt'), 'dirty')
        $entry = Join-Path $root 'tools/07_데이터_백업.bat'
        $result = Invoke-SyncLauncher $entry
        Assert-Sync ($result.Code -eq 1) ('Failure exit code: ' + $result.Code + "`n" + ($result.Output -join "`n"))
        Assert-Sync (-not (Test-Path -LiteralPath (Join-Path $root 'ran.txt'))) 'Backup ran after failed refresh.'
    }
    Write-Host "All $groups local Git workflow groups passed. No ADB device was accessed."
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char]92) + [char]92
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^hoibot_sync_mock_[a-f0-9]{32}$') { throw 'Unsafe test cleanup target.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
