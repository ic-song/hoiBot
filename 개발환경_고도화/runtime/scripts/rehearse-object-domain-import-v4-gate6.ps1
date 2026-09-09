$ErrorActionPreference = "Stop"

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs742-v4-gate6-mariadb"))
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs742-v4-gate6-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$pidFile = Join-Path $temporaryRoot "mariadbd.pid"
$errorLog = Join-Path $temporaryRoot "mariadbd.err"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3365
$databaseName = "hoibot_rehearsal_wbs742_v4_gate6"
$password = "wbs742-v4-gate6-only"
$serverProcess = $null
$initialPid = $null
$success = $null
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$environmentNames = @("DATABASE_ENABLED","DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","HOIBOT_ENVIRONMENT_CODE","IRIS_SHARED_TOKEN","WBS742_V4_GATE6_PHASE")
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

function Assert-SafeTemporaryRoot {
  if ($temporaryRoot -ne $expectedRoot -or -not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe WBS742 V4 Gate6 temporary path: $temporaryRoot" }
}

function Start-IsolatedMariaDb {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$port","--bind-address=127.0.0.1","--skip-networking=0","--pid-file=$pidFile","--log-error=$errorLog") -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 150; $attempt += 1) {
    if ($script:serverProcess.HasExited) { throw "WBS742 V4 Gate6 MariaDB exited early. See $errorLog" }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq "127.0.0.1" }
    if ($null -ne $listener) {
      $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
      if ($owners.Count -ne 1 -or $owners[0] -ne $script:serverProcess.Id) { throw "WBS742 V4 Gate6 listener ownership mismatch" }
      return $script:serverProcess
    }
    Start-Sleep -Milliseconds 200
  }
  throw "Timed out waiting for WBS742 V4 Gate6 MariaDB"
}

function Stop-OwnedMariaDb([Diagnostics.Process]$process) {
  if ($null -eq $process) { return }
  if (-not $process.HasExited) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($null -ne $listener -and ($owners.Count -ne 1 -or $owners[0] -ne $process.Id)) { throw "WBS742 V4 Gate6 listener owner changed" }
    Stop-Process -Id $process.Id
    $process.WaitForExit(10000) | Out-Null
  }
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Milliseconds 200
  }
  throw "WBS742 V4 Gate6 listener remained after stop"
}

function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "WBS742 V4 Gate6 child command failed: $LASTEXITCODE" }
}

try {
  Assert-SafeTemporaryRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "WBS742 V4 Gate6 port $port is already in use" }
  foreach ($binary in @($installDatabase,$serverBinary,$clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Required MariaDB binary missing: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { throw "WBS742 V4 Gate6 temporary directory already exists: $temporaryRoot" }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent }
  $serverProcess = Start-IsolatedMariaDb
  $initialPid = $serverProcess.Id
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }

  $env:DATABASE_ENABLED = "true"
  $env:DATABASE_HOST = "127.0.0.1"
  $env:DATABASE_PORT = [string]$port
  $env:DATABASE_USER = "root"
  $env:DATABASE_PASSWORD = $password
  $env:DATABASE_NAME = $databaseName
  $env:HOIBOT_ENVIRONMENT_CODE = "dev"
  $env:IRIS_SHARED_TOKEN = "wbs742-v4-gate6-isolated-token"
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & npm.cmd run db:migrate }
    Invoke-Checked { & npm.cmd run object-data:validate }
    $env:WBS742_V4_GATE6_PHASE = "verify"
    Invoke-Checked { & node --import tsx --test test/object-domain-import-v4-gate6-parity-mariadb.integration.test.ts }
  } finally { Pop-Location }
  $productionAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionBefore $productionAfter) { throw "Production 3306 listener ownership changed" }
  $success = "WBS742_V4_GATE6_MARIADB_PASS port=$port database=$databaseName pid=$initialPid registeredTables=119 directTargets=47 columns=263 definitions=25 rows=49 comparedValues=272 dmlUnchanged=true driftFailClosed=true production3306Unchanged=true"
} finally {
  $cleanupErrors = [Collections.Generic.List[string]]::new()
  try { Stop-OwnedMariaDb $serverProcess } catch { $cleanupErrors.Add($_.Exception.Message) }
  if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
    try { Assert-SafeTemporaryRoot; if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force } } catch { $cleanupErrors.Add($_.Exception.Message) }
  } else { $cleanupErrors.Add("WBS742 V4 Gate6 listener remained after cleanup") }
  foreach ($name in $environmentNames) {
    try { if ($null -eq $savedEnvironment[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $savedEnvironment[$name] } } catch { $cleanupErrors.Add("Failed to restore $name") }
  }
  if ($cleanupErrors.Count -gt 0) { throw "WBS742 V4 Gate6 cleanup failed: $($cleanupErrors -join ' | ')" }
}

Write-Output $success
