param([string]$LdConsoleExe = 'C:\LDPlayer\LDPlayer9\ldconsole.exe')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# Run only fixed index-1 commands, with bounded process and output waits.
function Invoke-HoiLdCommand {
    param([string]$Arguments)
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $LdConsoleExe
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $captureOutput = $Arguments -notmatch '^(launch|quit) ' # Emulator children may inherit launch output handles.
    $info.RedirectStandardOutput = $captureOutput
    $info.RedirectStandardError = $captureOutput
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        if ($captureOutput) {
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
        }
        if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            throw "LDPlayer command timed out: $Arguments"
        }
        if ($captureOutput -and (-not $stdout.Wait(1000) -or -not $stderr.Wait(1000))) {
            throw "LDPlayer output timed out: $Arguments"
        }
        if ($process.ExitCode -ne 0) {
            throw "LDPlayer command failed (exit $($process.ExitCode)): $Arguments"
        }
        if ($captureOutput) { return ($stdout.Result + "`n" + $stderr.Result).Trim() }
    } finally { $process.Dispose() }
}

# Read index 1 and reject missing or malformed instance information.
function Get-HoiLdInstance {
    $listing = Invoke-HoiLdCommand 'list2'
    $rows = @($listing -split '\r?\n' | Where-Object { $_ -match '^1,' })
    if ($rows.Count -ne 1) { throw 'LDPlayer index 1 was not found. Check the multi-manager.' }
    $fields = $rows[0] -split ','
    if ($fields.Count -ne 7 -or $fields[5] -notmatch '^-?\d+$' -or $fields[6] -notmatch '^-?\d+$') {
        throw 'Unexpected LDPlayer list2 response for index 1.'
    }
    return ,$fields
}

try {
    if (-not (Test-Path -LiteralPath $LdConsoleExe -PathType Leaf)) {
        throw "ldconsole.exe not found. Update LD_CONSOLE_EXE in the batch file: $LdConsoleExe"
    }

    $instance = Get-HoiLdInstance
    if ([int]$instance[5] -gt 0 -or [int]$instance[6] -gt 0) {
        Write-Host '[1/4] Stopping LDPlayer index 1...'
        [void](Invoke-HoiLdCommand 'quit --index 1')
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        do {
            $instance = Get-HoiLdInstance
            if ([int]$instance[5] -le 0 -and [int]$instance[6] -le 0) { break }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'Index 1 did not stop within 60 seconds.' }
            Start-Sleep -Seconds 2
        } while ($true)
    }

    Write-Host '[2/4] Starting LDPlayer index 1; waiting for Android boot...'
    [void](Invoke-HoiLdCommand 'launch --index 1')
    $deadline = [DateTime]::UtcNow.AddSeconds(180)
    do {
        # ADB may be offline while Android is starting; retry within the boot deadline.
        try { $boot = Invoke-HoiLdCommand 'adb --index 1 --command "shell getprop sys.boot_completed"' }
        catch { $boot = $_.Exception.Message }
        if ($boot -eq '1') { break }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Android did not boot within 180 seconds. Check local ADB debugging in LDPlayer.`n$boot"
        }
        Start-Sleep -Seconds 2
    } while ($true)

    foreach ($package in @('com.kakao.talk', 'com.xfl.msgbot')) {
        $label = if ($package -eq 'com.kakao.talk') { '[3/4] KakaoTalk' } else { '[4/4] MessengerBotR' }
        Write-Host "$label - checking installation and launching..."
        $installed = Invoke-HoiLdCommand ('adb --index 1 --command "shell pm path ' + $package + '"')
        if ($installed -notmatch '(?m)^package:.+\.apk\s*$') {
            throw "App is not installed or ADB is unavailable: $package`n$installed"
        }
        $result = Invoke-HoiLdCommand ('adb --index 1 --command "shell monkey -p ' + $package + ' -c android.intent.category.LAUNCHER 1"')
        if ($result -notmatch 'Events injected:\s*1\b' -or $result -match '(?i)error|exception|aborted|no activities') {
            throw "App launch failed: $package`n$result"
        }
        if ($package -eq 'com.kakao.talk') { Start-Sleep -Seconds 5 }
    }
    Write-Host '[OK] Index 1 apps launched. Check bot activation in MessengerBotR.'
    exit 0
} catch {
    Write-Host ('[FAIL] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
