param([string]$DataRoot = (Join-Path $PSScriptRoot '..\data'), [int]$Limit = 10)

# Read complete diagnostic rows; a partial append never hides preceding records.
function Get-HoiMainDiagnostics {
    param([string]$Root, [int]$Count = 10)
    $rows = @()
    foreach ($name in @('mainDiagnostics.previous.jsonl', 'mainDiagnostics.jsonl')) {
        $path = Join-Path $Root $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $lineNumber = 0
        foreach ($line in [IO.File]::ReadAllLines($path, (New-Object Text.UTF8Encoding($false, $false)))) {
            $lineNumber++
            if (-not $line.Trim()) { continue }
            try {
                if ($line.IndexOf([char]0xfffd) -ge 0) { throw 'Incomplete UTF-8 append.' }
                $row = ConvertFrom-Json -InputObject $line -ErrorAction Stop
                if (-not $row.at -or -not $row.kind -or -not $row.id) { throw 'Required diagnostic fields are missing.' }
                $rows += $row
            } catch { Write-Host ("[WARN] Incomplete or invalid diagnostic row: {0}:{1}" -f $name, $lineNumber) }
        }
    }
    return @($rows | Sort-Object -Property at -Descending | Select-Object -First ([Math]::Max(1, $Count)))
}

# Print a read-only summary from the local 07 candidate, including failed publication file states.
function Show-HoiMainDiagnostics {
    param([string]$Root, [int]$Count = 10)
    try {
        $rows = @(Get-HoiMainDiagnostics -Root $Root -Count $Count)
        Write-Host '[DIAGNOSTICS] Main error/slow request records from 07 backup'
        if (-not $rows.Count) { Write-Host '[INFO] No diagnostic records. Older runtime versions may not create these files.'; return }
        foreach ($row in $rows) {
            $displayTime = if ($row.atKst) { $row.atKst + ' KST' } else { $row.at }
            Write-Host ("[{0}] {1} {2} id={3} command={4}" -f $row.kind, $displayTime, $row.version, $row.id, $row.command)
            Write-Host ("  queue={0}ms work={1}ms stage={2}" -f $row.queueMs, $row.workMs, $row.stage)
            if ($row.error) { Write-Host ('  error=' + $row.error) }
            if ($row.observedOwner) { Write-Host ('  observedOwner=' + $row.observedOwner) }
            foreach ($write in @($row.writes)) {
                if ($null -eq $write) { continue }
                Write-Host ("  write={0} stage={1} freeBytes={2} restored={3} retried={4}" -f $write.path, $write.stage, $write.freeBytes, $write.originalRestored, $write.retried)
                foreach ($file in @($write.files)) { Write-Host ("    {0} exists={1} bytes={2} writable={3}" -f $file.path, $file.exists, $file.bytes, $file.writable) }
            }
        }
    } catch { Write-Host ('[WARN] Diagnostic summary failed: ' + $_.Exception.Message) }
}

if ($MyInvocation.InvocationName -ne '.') {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    Show-HoiMainDiagnostics -Root $DataRoot -Count $Limit
}
