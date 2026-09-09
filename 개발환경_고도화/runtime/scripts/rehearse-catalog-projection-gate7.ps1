param([switch]$ForceStartupFailure)

$ErrorActionPreference = "Stop"
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs725-gate7-mariadb"))
$expectedTemporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs725-gate7-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$pidFile = Join-Path $temporaryRoot "mariadbd.pid"
$errorLog = Join-Path $temporaryRoot "mariadbd.err"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$rehearsalPort = 3322
$rehearsalDatabase = "hoibot_rehearsal_wbs725_gate7"
$rehearsalPassword = "wbs725-gate7-only"
$serverProcess = $null
$initialServerPid = $null
$restartServerPid = $null
$successMessage = $null
$productionListenerBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$savedEnvironment = @{
  DATABASE_ENABLED = $env:DATABASE_ENABLED
  DATABASE_HOST = $env:DATABASE_HOST
  DATABASE_PORT = $env:DATABASE_PORT
  DATABASE_USER = $env:DATABASE_USER
  DATABASE_PASSWORD = $env:DATABASE_PASSWORD
  DATABASE_NAME = $env:DATABASE_NAME
  IRIS_SHARED_TOKEN = $env:IRIS_SHARED_TOKEN
  CATALOG_PROJECTION_GATE7_PHASE = $env:CATALOG_PROJECTION_GATE7_PHASE
}

function Assert-ExactTemporaryPath {
  if ($temporaryRoot -ne $expectedTemporaryRoot -or -not $temporaryRoot.StartsWith($worktreeRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe Gate7 temporary path: $temporaryRoot"
  }
}

function Start-IsolatedMariaDb {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @(
    "--no-defaults", "--datadir=$dataDirectory", "--port=$rehearsalPort", "--bind-address=127.0.0.1",
    "--skip-networking=0", "--pid-file=$pidFile", "--log-error=$errorLog"
  ) -PassThru -WindowStyle Hidden
  $process = $script:serverProcess
  if ($ForceStartupFailure) { throw "WBS725_GATE7_FORCED_STARTUP_FAILURE" }
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

function Stop-OwnedMariaDb([System.Diagnostics.Process]$process) {
  if ($null -eq $process) { return }
  if (-not $process.HasExited) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue
    $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($null -ne $listener -and ($owners.Count -ne 1 -or $owners[0] -ne $process.Id)) {
      Stop-Process -Id $process.Id
      $process.WaitForExit(10000) | Out-Null
      throw "Gate7 listener ownership changed before owned process cleanup."
    }
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
    if (-not $process.HasExited) { throw "Isolated MariaDB did not stop." }
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

function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "Gate7 child command failed with exit code $LASTEXITCODE" }
}

try {
  Assert-ExactTemporaryPath
  if (Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue) { throw "Gate7 port $rehearsalPort is already in use." }
  foreach ($binary in @($installDatabase, $serverBinary, $clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Required MariaDB binary missing: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { throw "Gate7 temporary directory already exists: $temporaryRoot" }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$rehearsalPassword" "--port=$rehearsalPort" --allow-remote-root-access --silent }
  $serverProcess = Start-IsolatedMariaDb
  $initialServerPid = $serverProcess.Id
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$rehearsalPort" --user=root "--password=$rehearsalPassword" --execute="CREATE DATABASE $rehearsalDatabase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }

  $env:DATABASE_ENABLED = "true"
  $env:DATABASE_HOST = "127.0.0.1"
  $env:DATABASE_PORT = [string]$rehearsalPort
  $env:DATABASE_USER = "root"
  $env:DATABASE_PASSWORD = $rehearsalPassword
  $env:DATABASE_NAME = $rehearsalDatabase
  $env:IRIS_SHARED_TOKEN = "wbs725-gate7-isolated-token"
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & npm.cmd run db:migrate }
    $env:CATALOG_PROJECTION_GATE7_PHASE = "prepare"
    Invoke-Checked { & node --import tsx --test test/data-migration-catalog-projection-shadow-mariadb.integration.test.ts }
    Stop-OwnedMariaDb $serverProcess
    $serverProcess = Start-IsolatedMariaDb
    $restartServerPid = $serverProcess.Id
    if ($restartServerPid -eq $initialServerPid) { throw "MariaDB restart did not produce a new PID." }
    $env:CATALOG_PROJECTION_GATE7_PHASE = "replay-rollback"
    Invoke-Checked { & node --import tsx --test test/data-migration-catalog-projection-shadow-mariadb.integration.test.ts }
  } finally {
    Pop-Location
  }
  $productionListenerAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionListenerBefore $productionListenerAfter) { throw "Production 3306 listener ownership changed during Gate7 Shadow." }
  $successMessage = "GATE7_SHADOW_PASS port=$rehearsalPort database=$rehearsalDatabase initialPid=$initialServerPid restartPid=$restartServerPid projectionOracleDiff=0 replayDml=0 production3306Unchanged=true"
} finally {
  $cleanupErrors = [System.Collections.Generic.List[string]]::new()
  try { if ($null -ne $serverProcess) { Stop-OwnedMariaDb $serverProcess } } catch { $cleanupErrors.Add($_.Exception.Message) }
  $remainingListener = Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue
  if ($null -ne $remainingListener) { $cleanupErrors.Add("Gate7 listener remained after cleanup.") }
  if ($null -eq $remainingListener) {
    try {
      Assert-ExactTemporaryPath
      if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
    } catch { $cleanupErrors.Add($_.Exception.Message) }
  }
  foreach ($name in $savedEnvironment.Keys) {
    $value = $savedEnvironment[$name]
    try {
      if ($null -eq $value) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $value }
    } catch { $cleanupErrors.Add("Failed to restore environment variable $name`: $($_.Exception.Message)") }
  }
  if ($cleanupErrors.Count -gt 0) { throw "Gate7 cleanup failed: $($cleanupErrors -join ' | ')" }
}

Write-Output $successMessage
