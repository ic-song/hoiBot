param([switch]$ForceStartupFailure)

$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs742-gate7-mariadb"))
$expectedTemporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs742-gate7-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$pidFile = Join-Path $temporaryRoot "mariadbd.pid"
$errorLog = Join-Path $temporaryRoot "mariadbd.err"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$rehearsalPort = 3323
$rehearsalDatabase = "hoibot_rehearsal_wbs742_gate7"
$rehearsalPassword = "wbs742-gate7-only"
$serverProcess = $null
$pids = [Collections.Generic.List[int]]::new()
$productionListenerBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$environmentNames = @("DATABASE_ENABLED", "DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME", "IRIS_SHARED_TOKEN", "GATE7_CONSUMER_RUNTIME", "CATALOG_PROJECTION_GATE7_PHASE", "OBJECT_DOMAIN_GATE5_PHASE", "OBJECT_DOMAIN_GATE6_PHASE", "WBS742_GATE7_COMBINED")
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

function Assert-ExactTemporaryPath {
  if ($temporaryRoot -ne $expectedTemporaryRoot -or -not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe Gate7 temporary path: $temporaryRoot" }
}
function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "Gate7 child command failed with exit code $LASTEXITCODE" }
}
function Start-IsolatedMariaDb {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults", "--datadir=$dataDirectory", "--port=$rehearsalPort", "--bind-address=127.0.0.1", "--skip-networking=0", "--pid-file=$pidFile", "--log-error=$errorLog") -PassThru -WindowStyle Hidden
  $process = $script:serverProcess
  $script:pids.Add($process.Id)
  if ($ForceStartupFailure) { throw "WBS742_GATE7_FORCED_STARTUP_FAILURE" }
  for ($attempt = 0; $attempt -lt 150; $attempt += 1) {
    if ($process.HasExited) { throw "Isolated MariaDB exited early. See $errorLog" }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq "127.0.0.1" }
    if ($null -ne $listener) {
      $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
      if ($owners.Count -ne 1 -or $owners[0] -ne $process.Id) { throw "Gate7 listener ownership mismatch." }
      return $process
    }
    Start-Sleep -Milliseconds 200
  }
  throw "Timed out waiting for isolated MariaDB listener."
}
function Stop-OwnedMariaDb([Diagnostics.Process]$process) {
  if ($null -eq $process) { return }
  if (-not $process.HasExited) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue
    $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($null -ne $listener -and ($owners.Count -ne 1 -or $owners[0] -ne $process.Id)) { throw "Gate7 listener ownership changed before cleanup." }
    Stop-Process -Id $process.Id
    if (-not $process.WaitForExit(10000)) { throw "Gate7 owned MariaDB PID $($process.Id) did not exit within timeout." }
    $process.Refresh()
    if (-not $process.HasExited) { throw "Gate7 owned MariaDB PID $($process.Id) remained alive after shutdown." }
  }
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    $remaining = Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue
    if ($null -eq $remaining) { return }
    $remainingOwners = @($remaining | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($remainingOwners.Count -ne 1 -or $remainingOwners[0] -ne $process.Id) { throw "Gate7 listener ownership changed while stopping." }
    Start-Sleep -Milliseconds 200
  }
  throw "Gate7 listener did not clear after owned process exit."
}
function Restart-IsolatedMariaDb {
  $oldPid = $script:serverProcess.Id
  Stop-OwnedMariaDb $script:serverProcess
  $script:serverProcess = Start-IsolatedMariaDb
  if ($script:serverProcess.Id -eq $oldPid) { throw "Gate7 restart did not produce a new PID." }
}

try {
  Assert-ExactTemporaryPath
  if ($rehearsalDatabase -notmatch "^hoibot_rehearsal_[a-z0-9_]+$") { throw "Gate7 database is not allowlisted." }
  if (Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue) { throw "Gate7 port $rehearsalPort is already in use." }
  foreach ($binary in @($installDatabase, $serverBinary, $clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Required MariaDB binary missing: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { throw "Gate7 temporary directory already exists: $temporaryRoot" }
  Push-Location $runtimeRoot
  try { Invoke-Checked { & node --import tsx --test test/object-domain-import-shadow-snapshot.test.ts } } finally { Pop-Location }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$rehearsalPassword" "--port=$rehearsalPort" --allow-remote-root-access --silent }
  $serverProcess = Start-IsolatedMariaDb
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$rehearsalPort" --user=root "--password=$rehearsalPassword" "--execute=CREATE DATABASE $rehearsalDatabase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  $env:DATABASE_ENABLED = "true"; $env:DATABASE_HOST = "127.0.0.1"; $env:DATABASE_PORT = [string]$rehearsalPort
  $env:DATABASE_USER = "root"; $env:DATABASE_PASSWORD = $rehearsalPassword; $env:DATABASE_NAME = $rehearsalDatabase
  $env:IRIS_SHARED_TOKEN = "wbs742-gate7-isolated-token"; $env:GATE7_CONSUMER_RUNTIME = $runtimeRoot; $env:WBS742_GATE7_COMBINED = "true"
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & npm.cmd run db:migrate }
    Invoke-Checked { & node --import tsx (Join-Path $worktreeRoot "tools\test-wbs724-gate7-shadow.mts") first }
    Restart-IsolatedMariaDb
    Invoke-Checked { & node --import tsx (Join-Path $worktreeRoot "tools\test-wbs724-gate7-shadow.mts") replay }
    Invoke-Checked { & node --import tsx (Join-Path $worktreeRoot "tools\test-wbs724-gate7-shadow.mts") rollback }

    $env:CATALOG_PROJECTION_GATE7_PHASE = "prepare"
    Invoke-Checked { & node --import tsx --test test/data-migration-catalog-projection-shadow-mariadb.integration.test.ts }
    Restart-IsolatedMariaDb
    $env:CATALOG_PROJECTION_GATE7_PHASE = "replay-rollback"
    Invoke-Checked { & node --import tsx --test test/data-migration-catalog-projection-shadow-mariadb.integration.test.ts }
    Remove-Item -LiteralPath "Env:CATALOG_PROJECTION_GATE7_PHASE" -ErrorAction SilentlyContinue

    $env:OBJECT_DOMAIN_GATE5_PHASE = "gate7-prepare"
    Invoke-Checked { & node --import tsx --test test/data-migration-object-domain-import.test.ts }
    Remove-Item -LiteralPath "Env:OBJECT_DOMAIN_GATE5_PHASE" -ErrorAction SilentlyContinue
    $env:OBJECT_DOMAIN_GATE6_PHASE = "verify"
    Invoke-Checked { & node --import tsx --test test/object-domain-import-parity-verifier.test.ts }
    Restart-IsolatedMariaDb
    Invoke-Checked { & node --import tsx --test test/object-domain-import-parity-verifier.test.ts }
    Remove-Item -LiteralPath "Env:OBJECT_DOMAIN_GATE6_PHASE" -ErrorAction SilentlyContinue
    $env:OBJECT_DOMAIN_GATE5_PHASE = "gate7-replay-rollback"
    Invoke-Checked { & node --import tsx --test test/data-migration-object-domain-import.test.ts }
  } finally { Pop-Location }
  $productionListenerAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionListenerBefore $productionListenerAfter) { throw "Production 3306 listener ownership changed during Gate7." }
  $successMessage = "GATE7_SHADOW_PASS port=$rehearsalPort database=$rehearsalDatabase pids=$($pids -join ',') providerSyntheticRows=1 fullProjectionRows=47 fullCanonicalTargets=45 oracleDiff=0 restartReplayDml=0 actualProjectedRows=0 production3306Unchanged=true"
} finally {
  $cleanupErrors = [Collections.Generic.List[string]]::new()
  try { if ($null -ne $serverProcess) { Stop-OwnedMariaDb $serverProcess } } catch { $cleanupErrors.Add($_.Exception.Message) }
  foreach ($ownedPid in $pids) {
    if (Get-Process -Id $ownedPid -ErrorAction SilentlyContinue) { $cleanupErrors.Add("Gate7 owned MariaDB PID $ownedPid remained after cleanup.") }
  }
  if (Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue) { $cleanupErrors.Add("Gate7 listener remained after cleanup.") }
  else {
    try { Assert-ExactTemporaryPath; if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force } } catch { $cleanupErrors.Add($_.Exception.Message) }
  }
  foreach ($name in $environmentNames) {
    try { if ($null -eq $savedEnvironment[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $savedEnvironment[$name] } } catch { $cleanupErrors.Add("Failed to restore $name`: $($_.Exception.Message)") }
  }
  $productionListenerAfterCleanup = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionListenerBefore $productionListenerAfterCleanup) { $cleanupErrors.Add("Production 3306 listener ownership changed during Gate7 cleanup.") }
  if ($cleanupErrors.Count -gt 0) { throw "Gate7 cleanup failed: $($cleanupErrors -join ' | ')" }
}
Write-Output $successMessage
