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
        $bat = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '07_데이터_백업.bat'))
        Assert-True ($bat.Contains('-File "%~dp0pull_legacy_data.ps1"')) 'Filtered pull helper not connected.'
        $start = $bat.IndexOf('-File "%~dp0pull_legacy_data.ps1"')
        $fail = $bat.IndexOf('if errorlevel 1 goto FAIL_PULL', $start)
        $replace = $bat.IndexOf('move "%LOCAL_DATA_DIR%" "%ROLLBACK_DIR%"', $start)
        Assert-True ($fail -gt $start -and $replace -gt $fail) 'Missing fail-closed gate.'
    }
    Write-Host "All $script:groups mock backup groups passed. No ADB device was accessed."
} finally {
    $resolved = [IO.Path]::GetFullPath($script:testRoot)
    $parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char]92) + [char]92
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^hoibot_pull_mock_[a-f0-9]{32}$') { throw 'Unsafe test cleanup target.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
