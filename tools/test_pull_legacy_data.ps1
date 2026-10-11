$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'pull_legacy_data.ps1')
$script:testRoot = Join-Path ([IO.Path]::GetTempPath()) ('hoibot_pull_mock_' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($script:testRoot) | Out-Null
$script:groups = 0

function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
function Reset-Fixture {
    $script:files = @{
        'member.json' = '{"member":{"fixture":{"point":7}}}'
        'member_pet.json' = '{}'
        'petSkillData.json' = '{}'
        'petHomeActivityData.json' = '{}'
        'member_back.json' = '{"member":{}}'
        'archive/sub folder/data.txt' = 'fixture'
        'member.json.tmp' = '{'
        'member.json.rollback' = '{"member":{}}'
    }
    $script:pulls = @{}
    $script:lists = 0
    $script:failFile = ''
    $script:failCount = 0
    $script:badJsonCount = 0
    $script:extraAfter = ''
    $script:manifestExtra = ''
}

# Fake ADB only reads synthetic data; no external processes or devices are used.
function Invoke-HoiBackupAdb {
    param([string]$Executable, [string[]]$Arguments)
    Assert-True ($Executable -eq 'mock-adb' -and $Arguments[0] -eq '-s' -and $Arguments[1] -eq 'mock-device') 'Unexpected ADB target.'
    if ($Arguments[2] -eq 'shell') {
        Assert-True ($Arguments[3] -eq "find '/mock/data' -type f") 'Only read-only find is permitted.'
        $script:lists++
        $names = @($script:files.Keys | ForEach-Object { '/mock/data/' + $_ })
        if ($script:lists -gt 1 -and $script:extraAfter) { $names += '/mock/data/' + $script:extraAfter }
        if ($script:manifestExtra) { $names += '/mock/data/' + $script:manifestExtra }
        return @{ ExitCode = 0; Lines = $names }
    }
    Assert-True ($Arguments[2] -eq 'pull') 'Remote mutation command rejected.'
    $relative = $Arguments[3].Substring('/mock/data/'.Length)
    Assert-True ($relative -notmatch '\.(tmp|rollback)$') 'Transient file was pulled.'
    $script:pulls[$relative]++
    if ($relative -eq $script:failFile -and $script:pulls[$relative] -le $script:failCount) {
        return @{ ExitCode = 1; Lines = @('remote open failed: No such file or directory') }
    }
    $text = $script:files[$relative]
    if ($relative -eq 'member.json' -and $script:pulls[$relative] -le $script:badJsonCount) { $text = '{' }
    [IO.File]::WriteAllText($Arguments[4], $text, (New-Object Text.UTF8Encoding($false)))
    return @{ ExitCode = 0; Lines = @() }
}

function Run-Pull {
    $destination = Join-Path $script:testRoot ([Guid]::NewGuid().ToString('N'))
    $count = Copy-HoiBackupData 'mock-adb' 'mock-device' '/mock/data' $destination
    return @{ Count = $count; Destination = $destination }
}
function Expect-Failure([scriptblock]$Action) {
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-True $failed 'Expected fail-closed backup.'
}
function Test-Group($Name, [scriptblock]$Action) {
    Reset-Fixture
    & $Action
    $script:groups++
    Write-Host "PASS $script:groups : $Name"
}

try {
    Test-Group 'Transient exclusion; real backups and nested files preserved' {
        $r = Run-Pull
        Assert-True ($r.Count -eq 6) 'Wrong file count.'
        Assert-True ((Get-Content -LiteralPath (Join-Path $r.Destination 'member.json') -Raw) -eq $script:files['member.json']) 'Original content changed.'
        Assert-True (Test-Path -LiteralPath (Join-Path $r.Destination 'member_back.json')) 'Real backup was excluded.'
        Assert-True (Test-Path -LiteralPath (Join-Path $r.Destination 'archive/sub folder/data.txt')) 'Nested file lost.'
    }
    Test-Group 'Atomic replacement gap retries then succeeds' {
        $script:failFile = 'member.json'; $script:failCount = 2
        $r = Run-Pull
        Assert-True ($script:pulls['member.json'] -eq 3 -and $r.Count -eq 6) 'Retry failed.'
    }
    Test-Group 'Stable pull failure aborts before data replacement' {
        $script:failFile = 'member.json'; $script:failCount = 3
        Expect-Failure { Run-Pull }
        Assert-True ($script:pulls['member.json'] -eq 3) 'Wrong retry limit.'
    }
    Test-Group 'Invalid primary JSON retries; permanent corruption fails' {
        $script:badJsonCount = 2
        Run-Pull | Out-Null
        Assert-True ($script:pulls['member.json'] -eq 3) 'Invalid JSON was accepted.'
        Reset-Fixture; $script:badJsonCount = 3
        Expect-Failure { Run-Pull }
    }
    Test-Group 'Missing required file fails before creating candidate' {
        $script:files.Remove('member.json')
        Expect-Failure { Run-Pull }
        Assert-True ($script:pulls.Count -eq 0) 'Incomplete manifest was pulled.'
    }
    Test-Group 'New stable file fails; disappearing staging files are ignored' {
        $script:extraAfter = 'new.json'
        Expect-Failure { Run-Pull }
        Reset-Fixture; $script:extraAfter = 'other.json.tmp'
        Run-Pull | Out-Null
    }
    Test-Group 'Traversal and Windows case collisions rejected' {
        foreach ($name in @('../escape.json', 'Member.json', 'wrong\path.txt', 'file.')) {
            Reset-Fixture; $script:manifestExtra = $name
            Expect-Failure { Run-Pull }
            Assert-True ($script:pulls.Count -eq 0) 'Unsafe path was copied.'
        }
    }
    Test-Group 'Existing destination remains intact' {
        $target = Join-Path $script:testRoot 'existing'
        [IO.Directory]::CreateDirectory($target) | Out-Null
        [IO.File]::WriteAllText((Join-Path $target 'keep.txt'), 'keep')
        Expect-Failure { Copy-HoiBackupData 'mock-adb' 'mock-device' '/mock/data' $target }
        Assert-True ((Get-Content -LiteralPath (Join-Path $target 'keep.txt') -Raw) -eq 'keep') 'Existing data was changed.'
    }
    Test-Group 'Large JSON and UTF-8 filename/content survive without rewriting' {
        $script:files['member.json'] = '{"member":{},"fixture":"' + ('x' * 4000000) + '"}'
        $name = ([char]0xD638).ToString() + ' folder/data.txt'
        $script:files[$name] = ([char]0xAC00).ToString()
        $r = Run-Pull
        Assert-True ($r.Count -eq 7) 'Unicode filename lost.'
        $text = [IO.File]::ReadAllText((Join-Path $r.Destination 'member.json'))
        Assert-True ($text -ceq $script:files['member.json']) 'Large JSON changed.'
        Assert-True ([IO.File]::ReadAllText((Join-Path $r.Destination $name)) -ceq $script:files[$name]) 'UTF-8 content changed.'
    }
    Test-Group 'BAT calls filtered pull and retains failure gate before replacement' {
        $bat = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'backup_legacy_data.bat'))
        Assert-True ($bat.Contains('-File "%~dp0pull_legacy_data.ps1"')) 'Filtered pull helper not connected.'
        $start = $bat.IndexOf('-File "%~dp0pull_legacy_data.ps1"')
        $fail = $bat.IndexOf('if errorlevel 1 goto FAIL_PULL', $start)
        $replace = $bat.IndexOf('move "%LOCAL_DATA_DIR%" "%ROLLBACK_DIR%"', $start)
        Assert-True ($fail -gt $start -and $replace -gt $fail) 'Missing fail-closed gate.'
    }
    Test-Group 'Actual BAT guards allow clean latest hoi/prod; reject other, stale or dirty' {
        $bat = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'backup_legacy_data.bat'))
        $lines = $bat -split '\r?\n'
        $branchGuard = @($lines | Where-Object { $_.StartsWith('if not "!CURRENT_BRANCH!"') })
        $dirtyGuard = @($lines | Where-Object { $_.StartsWith('for %%A in ("%GIT_STATUS_FILE%")') })
        $baseGuard = @($lines | Where-Object { $_.StartsWith('if /i not "!START_HEAD!"') })
        Assert-True ($branchGuard.Count -eq 1 -and $dirtyGuard.Count -eq 1 -and $baseGuard.Count -eq 1) 'Missing BAT guard.'
        $status = Join-Path $script:testRoot 'status.txt'
        $testBat = Join-Path $script:testRoot 'guards.bat'
        $commands = @('@echo off', 'setlocal EnableExtensions EnableDelayedExpansion',
            'set "PROD_BRANCH=feature/prod"', 'set "WORK_BRANCH=feature/hoi"',
            'set "CURRENT_BRANCH=%~1"', 'set "START_HEAD=%~2"', 'set "REMOTE_PROD_HEAD=base"',
            ('set "GIT_STATUS_FILE=' + $status + '"'), $branchGuard[0], $dirtyGuard[0], $baseGuard[0],
            'exit /b 0', ':FAIL_SOURCE_BRANCH', 'exit /b 31', ':FAIL_GIT_DIRTY', 'exit /b 32', ':FAIL_GIT_BASE', 'exit /b 33')
        [IO.File]::WriteAllText($testBat, ($commands -join "`r`n") + "`r`n", [Text.Encoding]::ASCII)
        foreach ($case in @(
            @{Branch='feature/hoi'; Head='base'; Dirty=$false; Code=0},
            @{Branch='feature/prod'; Head='base'; Dirty=$false; Code=0},
            @{Branch='feature/workflow'; Head='base'; Dirty=$false; Code=31},
            @{Branch='feature/hoi'; Head='old'; Dirty=$false; Code=33},
            @{Branch='feature/hoi'; Head='base'; Dirty=$true; Code=32}
        )) {
            [IO.File]::WriteAllText($status, $(if ($case.Dirty) { ' M fixture.txt' } else { '' }))
            & $env:ComSpec /d /c $testBat $case.Branch $case.Head
            Assert-True ($LASTEXITCODE -eq $case.Code) ('Wrong guard result for ' + $case.Branch + ': ' + $LASTEXITCODE)
        }
    }
    Test-Group 'UTF-8 startup in Korean path with spaces and parentheses' {
        $bat = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'backup_legacy_data.bat'))
        $startup = $bat.Substring(0, $bat.IndexOf('if not exist "%ADB_EXE%"'))
        $folder = Join-Path $script:testRoot '한글 작업(테스트)/tools'
        [IO.Directory]::CreateDirectory($folder) | Out-Null
        $testBat = Join-Path $folder 'startup.bat'
        [IO.File]::WriteAllText($testBat, $startup + "exit /b 0`r`n", (New-Object Text.UTF8Encoding($false)))
        $output = @(& $env:ComSpec /d /c $testBat 2>&1)
        Assert-True ($LASTEXITCODE -eq 0 -and -not ($output -match 'not recognized')) 'Startup parsed as unintended commands.'
    }
    Write-Host "All $script:groups mock backup groups passed. No ADB device was accessed."
} finally {
    $resolved = [IO.Path]::GetFullPath($script:testRoot)
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char]92) + [char]92
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^hoibot_pull_mock_[a-f0-9]{32}$') { throw 'Unsafe test cleanup target.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
