param(
    [Parameter(Mandatory = $true)][string]$AdbExe,
    [Parameter(Mandatory = $true)][string]$LdConsoleExe,
    [Parameter(Mandatory = $true)][string]$TargetFile,
    [ValidatePattern('^(auto|[0-9]+)$')][string]$TargetLdIndex = 'auto',
    [ValidatePattern('^[a-zA-Z0-9._:-]+$')][string]$TargetDevice = 'auto',
    [Parameter(Mandatory = $true)][string]$ResultFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

# Run each CLI command in an isolated worker so blocked output cannot stall the watchdog.
function Invoke-HoiConnectionCommand {
    param([string]$Executable, [string[]]$Arguments)
    $commandResultFile = [IO.Path]::GetTempFileName()
    $request = @{ Executable = $Executable; Arguments = @($Arguments); ResultFile = $commandResultFile } | ConvertTo-Json -Compress
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
    $worker = @'
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$request = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')))
try {
    $nativeArguments = @($request.Arguments)
    $lines = @(& $request.Executable @nativeArguments 2>&1 | ForEach-Object { "$_" })
    $result = @{ ExitCode = $LASTEXITCODE; Text = ($lines -join "`n").Trim() }
} catch {
    $result = @{ ExitCode = -1; Text = $_.Exception.Message }
}
[IO.File]::WriteAllText($request.ResultFile, ($result | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
'@
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = (Get-Command powershell.exe -ErrorAction Stop).Source
    $info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker.Replace('__PAYLOAD__', $payload)))
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    Write-Host ('[RUN] {0} {1}' -f [IO.Path]::GetFileName($Executable), ($Arguments -join ' '))
    try {
        [void]$process.Start()
        if (-not $process.WaitForExit(10000)) {
            # Stop only this worker's process tree, including its hung ADB client.
            $stopInfo = New-Object Diagnostics.ProcessStartInfo
            $stopInfo.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
            $stopInfo.Arguments = '/PID ' + $process.Id + ' /T /F'
            $stopInfo.UseShellExecute = $false
            $stopInfo.CreateNoWindow = $true
            $stopInfo.RedirectStandardOutput = $true
            $stopInfo.RedirectStandardError = $true
            $stopProcess = [Diagnostics.Process]::Start($stopInfo)
            try {
                if (-not $stopProcess.WaitForExit(1000)) { $stopProcess.Kill() }
            } finally { $stopProcess.Dispose() }
            if (-not $process.HasExited) { $process.Kill() }
            [void]$process.WaitForExit(1000)
            return @{ ExitCode = -1; Text = 'Command/response timed out after 10 seconds; continuing recovery.' }
        }
        $resultText = [IO.File]::ReadAllText($commandResultFile, [Text.Encoding]::UTF8)
        if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($resultText)) {
            return @{ ExitCode = -1; Text = 'Command worker ended without a result.' }
        }
        $result = ConvertFrom-Json $resultText -ErrorAction Stop
        if ($null -eq $result.ExitCode) { return @{ ExitCode = -1; Text = 'Command worker returned no exit code.' } }
        return @{ ExitCode = [int]$result.ExitCode; Text = [string]$result.Text }
    } finally {
        $process.Dispose()
        [IO.File]::Delete($commandResultFile)
    }
}

# Map the emulator and loopback aliases of one running LDPlayer to the same index.
function Get-HoiConnectionIndex {
    param([string]$Serial)
    foreach ($instance in $script:instances) {
        if ($Serial -eq $instance.Emulator -or $Serial -eq $instance.Endpoint -or $Serial -eq ('localhost:' + $instance.Port)) {
            return $instance.Index
        }
    }
    return ''
}

# Verify the fixed bot file and count distinct devices rather than duplicate ADB aliases.
function Find-HoiConnectedBot {
    $devices = Invoke-HoiConnectionCommand $AdbExe @('devices')
    Write-Host '[INFO] ADB devices:'
    Write-Host $devices.Text
    $found = @{}
    $reachable = @{}
    $probeFailed = $devices.ExitCode -ne 0
    $candidateCount = 0
    foreach ($line in ($devices.Text -split '\r?\n')) {
        if ($line -notmatch '^([a-zA-Z0-9._:-]+)\s+device\s*$') { continue }
        $serial = $Matches[1]
        $index = Get-HoiConnectionIndex $serial
        if ($TargetDevice -ne 'auto' -and $serial -ne $TargetDevice -and ($script:explicitIndex -eq '' -or $index -ne $script:explicitIndex)) { continue }
        if ($TargetLdIndex -ne 'auto' -and $index -ne $TargetLdIndex) { continue }
        $candidateCount++
        $key = if ($index -ne '') { 'ld:' + $index } else { 'adb:' + $serial }
        $probe = Invoke-HoiConnectionCommand $AdbExe @('-s', $serial, 'shell', "if [ -f '$TargetFile' ]; then echo HOIBOT_TARGET_FOUND; else echo HOIBOT_TARGET_MISSING; fi")
        Write-Host ('[PROBE] {0}: exit={1}, {2}' -f $serial, $probe.ExitCode, $probe.Text)
        if ($probe.ExitCode -eq 0 -and $probe.Text -eq 'HOIBOT_TARGET_FOUND') {
            $reachable[$key] = $true
            if (-not $found.ContainsKey($key)) { $found[$key] = @{ Serial = $serial; Index = $index } }
        } elseif ($probe.ExitCode -eq 0 -and $probe.Text -eq 'HOIBOT_TARGET_MISSING') {
            $reachable[$key] = $true
        } else { $probeFailed = $true }
    }
    $needsRecovery = $probeFailed -or $candidateCount -eq 0
    foreach ($instance in $script:recoveryInstances) {
        if (-not $reachable.ContainsKey('ld:' + $instance.Index)) { $needsRecovery = $true }
    }
    return @{ Found = @($found.Values); NeedsRecovery = $needsRecovery }
}

try {
    if ($TargetFile -notmatch '^/[a-zA-Z0-9_./-]+$') { throw 'Invalid fixed bot file path.' }
    $listing = Invoke-HoiConnectionCommand $LdConsoleExe @('list2')
    Write-Host '[INFO] LDPlayer list2:'
    Write-Host $listing.Text
    if ($listing.ExitCode -ne 0) { throw 'LDPlayer list2 failed.' }
    $script:instances = @()
    foreach ($line in ($listing.Text -split '\r?\n')) {
        if ($line -notmatch '^(\d+),[^,]*,\d+,\d+,1,') { continue }
        $index = $Matches[1]
        $port = 5555 + 2 * [int]$index # LDPlayer index 0/1 uses ADB port 5555/5557.
        if ($port -gt 65535) { throw 'Invalid LDPlayer ADB port.' }
        $script:instances += @{ Index = $index; Port = $port; Endpoint = '127.0.0.1:' + $port; Emulator = 'emulator-' + ($port - 1) }
    }
    $script:recoveryInstances = @($script:instances | Where-Object { $TargetLdIndex -eq 'auto' -or $_.Index -eq $TargetLdIndex })
    if ($TargetLdIndex -ne 'auto' -and $script:recoveryInstances.Count -eq 0) { throw 'Selected LDPlayer index is not running.' }
    $script:explicitIndex = ''
    if ($TargetDevice -ne 'auto') {
        $script:explicitIndex = Get-HoiConnectionIndex $TargetDevice
        $script:recoveryInstances = @($script:recoveryInstances | Where-Object { $_.Index -eq $script:explicitIndex })
    }
    for ($attempt = 0; $attempt -le 2; $attempt++) {
        if ($attempt -gt 0) {
            Write-Host ('[RECOVER] ADB connection recovery {0}/2' -f $attempt)
            if ($attempt -eq 2) {
                Write-Host '[WARN] Restarting the local ADB server; other ADB sessions may disconnect briefly.'
                $result = Invoke-HoiConnectionCommand $AdbExe @('kill-server')
                Write-Host ('[RECOVER] kill-server: exit={0}, {1}' -f $result.ExitCode, $result.Text)
            }
            $result = Invoke-HoiConnectionCommand $AdbExe @('start-server')
            Write-Host ('[RECOVER] start-server: exit={0}, {1}' -f $result.ExitCode, $result.Text)
            $result = Invoke-HoiConnectionCommand $AdbExe @('reconnect', 'offline')
            Write-Host ('[RECOVER] reconnect offline: exit={0}, {1}' -f $result.ExitCode, $result.Text)
            foreach ($instance in $script:recoveryInstances) {
                $result = Invoke-HoiConnectionCommand $AdbExe @('connect', $instance.Endpoint)
                Write-Host ('[RECOVER] connect {0}: exit={1}, {2}' -f $instance.Endpoint, $result.ExitCode, $result.Text)
            }
        }
        $selection = Find-HoiConnectedBot
        if ($selection.Found.Count -gt 1) { throw 'Multiple devices contain the fixed bot file. Set TARGET_LD_INDEX or TARGET_ADB_DEVICE explicitly.' }
        if ($selection.Found.Count -eq 1) {
            $chosen = $selection.Found[0]
            $selectedIndex = if ($chosen.Index -ne '') { $chosen.Index } else { $TargetLdIndex }
            [IO.File]::WriteAllLines($ResultFile, @(('TARGET_ADB_DEVICE=' + $chosen.Serial), ('TARGET_LD_INDEX=' + $selectedIndex), 'USE_DIRECT_ADB=1'), (New-Object Text.UTF8Encoding($false)))
            Write-Host ('[OK] Verified bot file: {0}, device: {1}' -f $TargetFile, $chosen.Serial)
            exit 0
        }
        if (-not $selection.NeedsRecovery) { throw ('ADB is connected, but the fixed bot file was not found: ' + $TargetFile) }
    }
    throw 'ADB recovery failed. Check the per-device responses, LDPlayer ADB setting and port conflicts.'
} catch {
    Write-Host ('[FAIL] ' + $_.Exception.Message)
    exit 1
}
