param(
  [string]$ConsumerWorktree = "",
  [int]$Port = 3320,
  [string]$DatabaseName = "hoibot_rehearsal_wbs724_gate7",
  [string]$MariaBin = "C:\Program Files\MariaDB 12.2\bin",
  [switch]$CleanupStale
)

$ErrorActionPreference = "Stop"
$expectedConsumerCommit = "69a72a2d4d57d0c64100c6a1f01d501cb9eeeb4f"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if ($ConsumerWorktree -eq "") {
  $ConsumerWorktree = Join-Path (Split-Path $repoRoot -Parent) "object-db-catalog-projection-v1-20260903"
}
$dependencyRoot = [IO.Path]::GetFullPath($ConsumerWorktree)
$tempParent = [IO.Path]::GetFullPath((Join-Path $repoRoot ".tmp"))
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempParent "wbs724-gate7-shadow-auto"))
$expectedTempRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot ".tmp\wbs724-gate7-shadow-auto"))
$allowedPrefix = $tempParent + [IO.Path]::DirectorySeparatorChar
$consumerRoot = Join-Path $tempRoot "consumer"
$runtimeRoot = Join-Path $consumerRoot "개발환경_고도화\runtime"
$harnessPath = Join-Path $repoRoot "tools\test-wbs724-gate7-shadow.mts"
$password = ([Guid]::NewGuid().ToString("N") + "aA1!")
$script:MariaProcess = $null
$initialLocation = Get-Location
$environmentNames = @("MYSQL_PWD", "NODE_ENV", "IRIS_SHARED_TOKEN", "USER_VERIFICATION_PEPPER", "DATABASE_ENABLED", "DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME", "GATE7_CONSUMER_RUNTIME", "WBS742_GATE7_COMBINED")
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
  $originalEnvironment[$name] = [pscustomobject]@{ Exists = (Test-Path -LiteralPath "Env:$name"); Value = [Environment]::GetEnvironmentVariable($name, "Process") }
}

if ($DatabaseName -ne "hoibot_schema_design" -and $DatabaseName -notmatch "^hoibot_rehearsal_[a-z0-9_]+$") {
  throw "Gate7 refuses a non-allowlisted database name."
}
if ($Port -ne 3320) { throw "Gate7 requires the dedicated loopback port 3320." }
if ($tempRoot -ne $expectedTempRoot -or -not $tempRoot.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Gate7 temporary path escaped the exact workspace boundary."
}
$initialMariaServiceStatus = (Get-Service MariaDB).Status.ToString()
if ($initialMariaServiceStatus -ne "Running") { throw "Gate7 requires the existing MariaDB service to remain Running and untouched." }
if ($CleanupStale) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Gate7 refuses stale cleanup while its port is active." }
  if (Test-Path -LiteralPath $tempRoot) {
    $consumerNodeModules = Join-Path $consumerRoot "개발환경_고도화\runtime\node_modules"
    if (Test-Path -LiteralPath $consumerNodeModules) {
      $nodeModulesItem = Get-Item -LiteralPath $consumerNodeModules -Force
      if (($nodeModulesItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw "Gate7 refuses to remove a non-junction dependency path." }
      Remove-Item -LiteralPath $consumerNodeModules -Force
    }
    if ((& git -C $repoRoot worktree list --porcelain) -match [regex]::Escape($consumerRoot)) {
      & git -C $repoRoot worktree remove --force $consumerRoot
      if ($LASTEXITCODE -ne 0) { throw "Gate7 detached consumer worktree cleanup failed." }
    }
    [IO.Directory]::Delete($tempRoot, $true)
  }
  if ((Test-Path -LiteralPath $tempParent) -and [IO.Directory]::GetFileSystemEntries($tempParent).Length -eq 0) { [IO.Directory]::Delete($tempParent, $false) }
  [pscustomobject]@{ event = "stale-cleanup"; withinAllowed = $true; exactExpected = $true; targetExists = (Test-Path -LiteralPath $tempRoot); listenerCount = 0 } | ConvertTo-Json -Compress
  exit 0
}
if (Test-Path -LiteralPath $tempRoot) { throw "Gate7 temporary path already exists." }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Gate7 port is already in use." }
$dependencyNodeModules = Join-Path $dependencyRoot "개발환경_고도화\runtime\node_modules"
if (-not (Test-Path -LiteralPath $dependencyNodeModules) -or -not (Test-Path -LiteralPath $harnessPath)) { throw "Gate7 dependency runtime or harness is missing." }
& git -C $repoRoot cat-file -e "$expectedConsumerCommit`^{commit}"
if ($LASTEXITCODE -ne 0) { throw "Gate7 consumer commit is unavailable." }

function Start-Gate7Maria([string]$pidFileName, [string]$logSuffix) {
  $dataRoot = Join-Path $tempRoot "mariadb\data"
  $logRoot = Join-Path $tempRoot "mariadb"
  $script:MariaProcess = Start-Process -FilePath (Join-Path $MariaBin "mysqld.exe") `
    -ArgumentList @("--defaults-file=$dataRoot\my.ini", "--bind-address=127.0.0.1", "--console") `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logRoot "mysqld-$logSuffix.stdout.log") `
    -RedirectStandardError (Join-Path $logRoot "mysqld-$logSuffix.stderr.log") `
    -PassThru
  Set-Content -LiteralPath (Join-Path $logRoot $pidFileName) -Value $script:MariaProcess.Id -Encoding ascii
  $capturedPid = [int](Get-Content -LiteralPath (Join-Path $logRoot $pidFileName) -Raw)
  $listener = $null
  for ($index = 0; $index -lt 40; $index += 1) {
    Start-Sleep -Milliseconds 500
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { break }
    if ($script:MariaProcess.HasExited) { break }
  }
  if (-not $listener -or $capturedPid -ne $script:MariaProcess.Id -or $listener.OwningProcess -ne $capturedPid) { throw "Gate7 MariaDB start/captured-PID/listener validation failed." }
  [pscustomobject]@{ event = "started"; pid = $script:MariaProcess.Id; capturedPid = $capturedPid; listenerPid = $listener.OwningProcess; address = $listener.LocalAddress; port = $Port } | ConvertTo-Json -Compress
}

function Stop-Gate7Maria() {
  if ($null -eq $script:MariaProcess) { return }
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listener) {
    if ($listener.OwningProcess -ne $script:MariaProcess.Id) { throw "Gate7 refuses to stop a listener it did not start." }
    $env:MYSQL_PWD = $password
    & (Join-Path $MariaBin "mariadb-admin.exe") --protocol=tcp --host=127.0.0.1 --port=$Port --user=root shutdown
    if ($LASTEXITCODE -ne 0) { throw "Gate7 MariaDB shutdown failed." }
  }
  Wait-Process -Id $script:MariaProcess.Id -Timeout 20 -ErrorAction SilentlyContinue
  if (Get-Process -Id $script:MariaProcess.Id -ErrorAction SilentlyContinue) { throw "Gate7 MariaDB process remained after shutdown." }
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Gate7 listener remained after shutdown." }
  [pscustomobject]@{ event = "stopped"; pid = $script:MariaProcess.Id; processExists = $false; listenerCount = 0 } | ConvertTo-Json -Compress
  $script:MariaProcess = $null
}

function Invoke-Gate7Harness([string]$mode) {
  & node --import tsx $harnessPath $mode
  if ($LASTEXITCODE -ne 0) { throw "Gate7 $mode harness failed." }
}

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  & git -C $repoRoot worktree add --detach $consumerRoot $expectedConsumerCommit
  if ($LASTEXITCODE -ne 0) { throw "Gate7 detached consumer worktree creation failed." }
  $consumerNodeModules = Join-Path $runtimeRoot "node_modules"
  New-Item -ItemType Junction -Path $consumerNodeModules -Target $dependencyNodeModules | Out-Null
  $consumerCommit = (& git -C $consumerRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $consumerCommit -ne $expectedConsumerCommit) { throw "Gate7 detached consumer commit mismatch: $consumerCommit" }
  if ((& git -C $consumerRoot status --porcelain).Length -ne 0) { throw "Gate7 detached consumer worktree must be clean." }
  New-Item -ItemType Directory -Path (Join-Path $tempRoot "mariadb") | Out-Null
  $dataRoot = Join-Path $tempRoot "mariadb\data"
  & (Join-Path $MariaBin "mariadb-install-db.exe") --datadir=$dataRoot --password=$password --port=$Port
  if ($LASTEXITCODE -ne 0) { throw "Gate7 MariaDB initialization failed." }
  Start-Gate7Maria "pid.txt" "first"
  $firstMariaPid = $script:MariaProcess.Id

  $env:MYSQL_PWD = $password
  & (Join-Path $MariaBin "mariadb.exe") --protocol=tcp --host=127.0.0.1 --port=$Port --user=root -e "CREATE DATABASE $DatabaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  if ($LASTEXITCODE -ne 0) { throw "Gate7 database creation failed." }
  $env:NODE_ENV = "development"
  $env:IRIS_SHARED_TOKEN = "gate7-isolated-token"
  $env:USER_VERIFICATION_PEPPER = "gate7-isolated-pepper"
  $env:DATABASE_ENABLED = "true"
  $env:DATABASE_HOST = "127.0.0.1"
  $env:DATABASE_PORT = [string]$Port
  $env:DATABASE_USER = "root"
  $env:DATABASE_PASSWORD = $password
  $env:DATABASE_NAME = $DatabaseName
  $env:GATE7_CONSUMER_RUNTIME = $runtimeRoot
  $env:WBS742_GATE7_COMBINED = "false"

  Set-Location $runtimeRoot
  & npm.cmd run db:migrate
  if ($LASTEXITCODE -ne 0) { throw "Gate7 migration failed." }
  Invoke-Gate7Harness "first"
  Stop-Gate7Maria
  Start-Gate7Maria "pid-restart.txt" "restart"
  if ($script:MariaProcess.Id -eq $firstMariaPid) { throw "Gate7 restart reused the first MariaDB PID." }
  Invoke-Gate7Harness "replay"
  Invoke-Gate7Harness "rollback"
  $migrationResult = (& (Join-Path $MariaBin "mariadb.exe") --batch --skip-column-names --protocol=tcp --host=127.0.0.1 --port=$Port --user=root --database=$DatabaseName -e "SELECT COUNT(*),SUM(version='457_data_migration_common_staging.sql'),SUM(version='458_data_migration_catalog_projection.sql'),SUM(version='459_catalog_projection_upstream_envelope.sql') FROM schema_migrations;").Trim()
  if ($LASTEXITCODE -ne 0) { throw "Gate7 final parity query failed." }
  if ($migrationResult -ne "447`t1`t1`t1") { throw "Gate7 migration count assertion failed: $migrationResult" }
  $rollbackResult = (& (Join-Path $MariaBin "mariadb.exe") --batch --skip-column-names --protocol=tcp --host=127.0.0.1 --port=$Port --user=root --database=$DatabaseName -e "SELECT (SELECT COUNT(*) FROM data_migration_raw_runs),(SELECT COUNT(*) FROM data_migration_common_staging_runs),(SELECT COUNT(*) FROM data_migration_catalog_projection_runs);").Trim()
  if ($LASTEXITCODE -ne 0 -or $rollbackResult -ne "0`t0`t0") { throw "Gate7 rollback count assertion failed: $rollbackResult" }
  [pscustomobject]@{ event = "database-assertions"; migrationCount = 447; migration457 = 1; migration458 = 1; migration459 = 1; rawCount = 0; commonCount = 0; projectionCount = 0; restartPidDiffers = $true } | ConvertTo-Json -Compress
  if ((& git -C $consumerRoot status --porcelain).Length -ne 0) { throw "Gate7 modified the consumer worktree." }
} finally {
  Set-Location $initialLocation
  try {
    Stop-Gate7Maria
    if (Test-Path -LiteralPath $tempRoot) {
      $resolvedTarget = [IO.Path]::GetFullPath($tempRoot)
      if ($resolvedTarget -ne $expectedTempRoot -or -not $resolvedTarget.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Gate7 cleanup path validation failed." }
      if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Gate7 refuses cleanup while its port is active." }
      if (Test-Path -LiteralPath $consumerRoot) {
        $consumerNodeModules = Join-Path $consumerRoot "개발환경_고도화\runtime\node_modules"
        if (Test-Path -LiteralPath $consumerNodeModules) {
          $nodeModulesItem = Get-Item -LiteralPath $consumerNodeModules -Force
          if (($nodeModulesItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw "Gate7 refuses to remove a non-junction dependency path." }
          Remove-Item -LiteralPath $consumerNodeModules -Force
        }
        & git -C $repoRoot worktree remove --force $consumerRoot
        if ($LASTEXITCODE -ne 0) { throw "Gate7 detached consumer worktree cleanup failed." }
      }
      [IO.Directory]::Delete($resolvedTarget, $true)
    }
    if ((Test-Path -LiteralPath $tempParent) -and [IO.Directory]::GetFileSystemEntries($tempParent).Length -eq 0) { [IO.Directory]::Delete($tempParent, $false) }
  } finally {
    foreach ($name in $environmentNames) {
      $original = $originalEnvironment[$name]
      if ($original.Exists) { Set-Item -LiteralPath "Env:$name" -Value $original.Value }
      else { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
    }
    foreach ($name in $environmentNames) {
      $original = $originalEnvironment[$name]
      if ((Test-Path -LiteralPath "Env:$name") -ne $original.Exists -or [Environment]::GetEnvironmentVariable($name, "Process") -ne $original.Value) { throw "Gate7 environment restoration failed for $name." }
    }
    $finalMariaServiceStatus = (Get-Service MariaDB).Status.ToString()
    if ($finalMariaServiceStatus -ne $initialMariaServiceStatus -or $finalMariaServiceStatus -ne "Running") { throw "Gate7 existing MariaDB service state changed." }
    [pscustomobject]@{ event = "cleanup"; withinAllowed = $true; exactExpected = $true; targetExists = (Test-Path -LiteralPath $tempRoot); tempParentExists = (Test-Path -LiteralPath $tempParent); listenerCount = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count; existingMariaDBServiceBefore = $initialMariaServiceStatus; existingMariaDBServiceAfter = $finalMariaServiceStatus; environmentRestored = $true } | ConvertTo-Json -Compress
  }
}
