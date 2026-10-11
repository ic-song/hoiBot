param(
    [string]$AdbExe,
    [string]$Device,
    [string]$RemoteDir,
    [string]$Destination
)

# ADB read commands return an exit code and captured diagnostic output.
function Invoke-HoiBackupAdb {
    param([string]$Executable, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { "$_" })
    return @{ ExitCode = $LASTEXITCODE; Lines = $lines }
}

# List regular files; atomic-save staging files are never part of the backup.
function Get-HoiBackupManifest {
    param([string]$Executable, [string]$Serial, [string]$RemoteRoot)
    $result = Invoke-HoiBackupAdb $Executable @('-s', $Serial, 'shell', "find '$RemoteRoot' -type f")
    if ($result.ExitCode -ne 0) { throw 'ADB file listing failed.' }
    $files = @()
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in $result.Lines) {
        $remote = ([string]$line).TrimEnd([char]13)
        if (-not $remote.StartsWith($RemoteRoot + '/', [StringComparison]::Ordinal)) {
            throw 'Unexpected path in ADB file listing.'
        }
        $relative = $remote.Substring($RemoteRoot.Length + 1)
        if ($relative -match '\.(tmp|rollback)$') { continue }
        if ($relative -match '[\\<>:"|?*\x00-\x1f]' -or @($relative.Split('/') | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' -or $_ -match '[. ]$' }).Count) {
            throw 'Remote filename cannot be represented safely on Windows.'
        }
        if (-not $seen.Add($relative)) { throw 'Remote paths collide on Windows.' }
        $files += $relative
    }
    $files = @($files | Sort-Object -CaseSensitive)
    if (-not $files.Count -or @($files | Select-Object -Unique).Count -ne $files.Count) {
        throw 'Empty or conflicting ADB file listing.'
    }
    return $files
}

# Pull stable files into a new local candidate; no remote files are changed.
function Copy-HoiBackupData {
    param([string]$Executable, [string]$Serial, [string]$RemoteRoot, [string]$LocalRoot)
    if (-not $Executable -or -not $Serial -or -not $LocalRoot -or $RemoteRoot -notmatch '^/[^\r\n'']+$') {
        throw 'Invalid backup arguments.'
    }
    $RemoteRoot = $RemoteRoot.TrimEnd('/')
    if (-not $RemoteRoot) { throw 'Remote root must be a data directory.' }
    $root = [IO.Path]::GetFullPath($LocalRoot)
    if (Test-Path -LiteralPath $root) { throw 'Backup destination already exists.' }
    $files = @(Get-HoiBackupManifest $Executable $Serial $RemoteRoot)
    $required = @('member.json', 'member_pet.json', 'petSkillData.json', 'petHomeActivityData.json')
    foreach ($name in $required) {
        if ($files -cnotcontains $name) { throw "Required data file is missing: $name" }
    }
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $prefix = $root.TrimEnd([char]92) + [char]92
    $utf8 = New-Object Text.UTF8Encoding($false, $true)
    $index = 0
    foreach ($relative in $files) {
        $local = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relative.Replace('/', [char]92)))
        if (-not $local.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup destination escaped its root.' }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($local)) | Out-Null
        $copied = $false
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            if (Test-Path -LiteralPath $local) { Remove-Item -LiteralPath $local -Force }
            $result = Invoke-HoiBackupAdb $Executable @('-s', $Serial, 'pull', ($RemoteRoot + '/' + $relative), $local)
            if ($result.ExitCode -eq 0 -and (Test-Path -LiteralPath $local -PathType Leaf)) {
                $copied = $true
                if ($required -ccontains $relative) {
                    try {
                        $text = [IO.File]::ReadAllText($local, $utf8)
                        if (-not $text.TrimStart().StartsWith('{')) { throw 'Expected JSON object.' }
                        $parsed = ConvertFrom-Json -InputObject $text -ErrorAction Stop
                        if ($null -eq $parsed -or ($relative -eq 'member.json' -and $null -eq $parsed.member)) { throw 'Required JSON structure is missing.' }
                    } catch { $copied = $false }
                }
            }
            if ($copied) { break }
            if ($attempt -lt 3) { Start-Sleep -Milliseconds 200 }
        }
        if (-not $copied) {
            foreach ($line in $result.Lines) { Write-Host $line }
            throw "Data file pull or validation failed after 3 attempts: $relative"
        }
        $index++
        Write-Host ("[PULL {0}/{1}] {2}" -f $index, $files.Count, $relative)
    }
    $after = @(Get-HoiBackupManifest $Executable $Serial $RemoteRoot)
    if (@(Compare-Object -ReferenceObject $files -DifferenceObject $after -CaseSensitive).Count) {
        throw 'Stable file list changed during backup. Retry with a new destination.'
    }
    Write-Host "[OK] $index files pulled; .tmp and .rollback excluded."
    return $index
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    $OutputEncoding = [Console]::OutputEncoding
    try {
        Copy-HoiBackupData $AdbExe $Device $RemoteDir $Destination | Out-Null
        exit 0
    } catch {
        Write-Host ('[FAIL] ' + $_.Exception.Message)
        exit 1
    }
}
