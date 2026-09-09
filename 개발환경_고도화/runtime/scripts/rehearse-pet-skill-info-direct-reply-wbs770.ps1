$ErrorActionPreference = "Stop"

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs770-pet-skill-info-direct-reply-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$pidFile = Join-Path $temporaryRoot "mariadbd.pid"
$errorLog = Join-Path $temporaryRoot "mariadbd.err"
$migrationDirectory = Join-Path $runtimeRoot "migrations"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3340
$databaseName = "hoibot_wbs770_pet_skill_direct"
$password = "wbs770-isolated-root-only"
$serverProcess = $null
$failure = $null
$cleanupErrors = [Collections.Generic.List[string]]::new()
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
$environmentNames = @(
  "DATABASE_ENABLED",
  "DATABASE_HOST",
  "DATABASE_PORT",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "DATABASE_NAME",
  "HOIBOT_ENVIRONMENT_CODE",
  "IRIS_SHARED_TOKEN",
  "USER_VERIFICATION_PEPPER",
  "WBS770_PET_SKILL_INFO_DIRECT_REPLY_MARIADB_TEST"
)
$savedEnvironment = @{}
foreach ($name in $environmentNames) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

function Assert-SafeTemporaryRoot {
  $expectedRoot = $worktreeRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $temporaryRoot.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe WBS770 temporary root: $temporaryRoot"
  }
  if ([IO.Path]::GetFileName($temporaryRoot) -ne "wbs770-pet-skill-info-direct-reply-mariadb") {
    throw "Unexpected WBS770 temporary root name: $temporaryRoot"
  }
}

function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) {
    throw "WBS770 child command failed with exit code $LASTEXITCODE"
  }
}

function Invoke-ExpectedFailure([scriptblock]$command) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $command
    $expectedFailureExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($expectedFailureExitCode -eq 0) {
    throw "WBS770 child command unexpectedly succeeded"
  }
}

function Start-IsolatedMariaDb {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @(
    "--no-defaults",
    "--datadir=$dataDirectory",
    "--port=$port",
    "--bind-address=127.0.0.1",
    "--skip-networking=0",
    "--pid-file=$pidFile",
    "--log-error=$errorLog"
  ) -PassThru -WindowStyle Hidden

  for ($attempt = 0; $attempt -lt 150; $attempt += 1) {
    if ($script:serverProcess.HasExited) {
      throw "WBS770 isolated MariaDB exited early. See $errorLog"
    }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
      if ($owners.Count -ne 1 -or $owners[0] -ne $script:serverProcess.Id) {
        throw "WBS770 listener ownership mismatch on port $port"
      }
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "WBS770 isolated MariaDB startup timed out"
}

function Stop-IsolatedMariaDb {
  if ($null -ne $script:serverProcess -and -not $script:serverProcess.HasExited) {
    $ownedProcessId = $script:serverProcess.Id
    Stop-Process -Id $ownedProcessId -Force
    for ($attempt = 0; $attempt -lt 150; $attempt += 1) {
      if ($null -eq (Get-Process -Id $ownedProcessId -ErrorAction SilentlyContinue)) {
        return
      }
      Start-Sleep -Milliseconds 200
    }
    throw "WBS770 isolated MariaDB did not stop"
  }
}

function Remove-TemporaryRoot {
  Assert-SafeTemporaryRoot
  if (-not (Test-Path -LiteralPath $temporaryRoot)) {
    return
  }
  for ($attempt = 0; $attempt -lt 150; $attempt += 1) {
    try {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
      return
    } catch [UnauthorizedAccessException], [IO.IOException] {
      Start-Sleep -Milliseconds 200
    }
  }
  throw "WBS770 temporary root could not be removed: $temporaryRoot"
}

function Wait-IsolatedPortReleased {
  for ($attempt = 0; $attempt -lt 300; $attempt += 1) {
    if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "WBS770 port $port still has a listener after cleanup"
}

try {
  Assert-SafeTemporaryRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "WBS770 port $port is already in use"
  }
  foreach ($binary in @($installDatabase, $serverBinary, $clientBinary)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
      throw "Missing MariaDB binary: $binary"
    }
  }
  $expectedMigrationCount = @(Get-ChildItem -LiteralPath $migrationDirectory -Filter "*.sql" -File).Count
  if ($expectedMigrationCount -lt 1 -or -not (Test-Path -LiteralPath (Join-Path $migrationDirectory "487_pet_skill_info_direct_reply_canary.sql") -PathType Leaf)) {
    throw "WBS770 migration inventory is invalid"
  }

  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-TemporaryRoot
  }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked {
    & $installDatabase "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent
  }
  Start-IsolatedMariaDb
  Invoke-Checked {
    & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  }

  $env:DATABASE_ENABLED = "true"
  $env:DATABASE_HOST = "127.0.0.1"
  $env:DATABASE_PORT = [string]$port
  $env:DATABASE_USER = "root"
  $env:DATABASE_PASSWORD = $password
  $env:DATABASE_NAME = $databaseName
  $env:HOIBOT_ENVIRONMENT_CODE = "dev"
  $env:IRIS_SHARED_TOKEN = "wbs770-isolated-token"
  $env:USER_VERIFICATION_PEPPER = "wbs770-isolated-pepper"
  $env:WBS770_PET_SKILL_INFO_DIRECT_REPLY_MARIADB_TEST = "true"

  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & node --import tsx scripts/migrate.ts }

    $migrationCounts = @(& $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName --batch --skip-column-names "--execute=SELECT COUNT(*) FROM schema_migrations; SELECT COUNT(*) FROM schema_migrations WHERE version='487_pet_skill_info_direct_reply_canary.sql';")
    if ($LASTEXITCODE -ne 0) {
      throw "WBS770 migration evidence query failed with exit code $LASTEXITCODE"
    }
    if ($migrationCounts.Count -ne 2 -or [int]$migrationCounts[0] -ne $expectedMigrationCount -or [int]$migrationCounts[1] -ne 1) {
      throw "WBS770 migration evidence mismatch: expected=$expectedMigrationCount actual=$($migrationCounts -join ',')"
    }

    Invoke-Checked {
      & node --import tsx --test test/pet-skill-info-direct-reply-migration.test.ts
    }

    $unrelatedBefore = @(& $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName --batch --skip-column-names "--execute=SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|',command_code,handler_key,auth_scope,rollout_state,enabled,version) ORDER BY command_code SEPARATOR '\n'),256) FROM command_registry WHERE command_code<>'PET_SKILL_INFO';")
    if ($LASTEXITCODE -ne 0 -or $unrelatedBefore.Count -ne 1 -or $unrelatedBefore[0] -notmatch '^[0-9a-f]{64}$') {
      throw "WBS770 unrelated registry baseline query failed"
    }

    Invoke-Checked {
      & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName "--execute=UPDATE command_registry SET version=99 WHERE command_code='PET_SKILL_INFO' AND version=2 AND rollout_state='CANARY'"
    }
    Invoke-ExpectedFailure {
      & $clientBinary --abort-source-on-error --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName "--execute=source migrations/rollback/487_pet_skill_info_direct_reply_canary.rollback.sql" 2>$null
    }
    $driftState = @(& $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName --batch --skip-column-names "--execute=SELECT CONCAT(rollout_state,'|',version) FROM command_registry WHERE command_code='PET_SKILL_INFO'; SELECT CONCAT(COLUMN_TYPE,'|',IS_NULLABLE,'|',CHARACTER_SET_NAME,'|',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='command_routing_decisions' AND COLUMN_NAME='event_id';")
    if ($LASTEXITCODE -ne 0 -or $driftState.Count -ne 2 -or $driftState[0] -ne "CANARY|99" -or $driftState[1] -ne "varchar(128)|NO|utf8mb4|utf8mb4_unicode_ci") {
      throw "WBS770 rollback drift guard changed state: $($driftState -join ',')"
    }
    Invoke-Checked {
      & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName "--execute=UPDATE command_registry SET version=2 WHERE command_code='PET_SKILL_INFO' AND version=99 AND rollout_state='CANARY'"
    }

    Invoke-Checked {
      & $clientBinary --abort-source-on-error --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName "--execute=source migrations/rollback/487_pet_skill_info_direct_reply_canary.rollback.sql"
    }
    $rollbackState = @(& $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName --batch --skip-column-names "--execute=SELECT CONCAT(handler_key,'|',auth_scope,'|',rollout_state,'|',enabled,'|',version) FROM command_registry WHERE command_code='PET_SKILL_INFO'; SELECT CONCAT(COLUMN_TYPE,'|',IS_NULLABLE,'|',CHARACTER_SET_NAME,'|',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='command_routing_decisions' AND COLUMN_NAME='event_id'; SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|',command_code,handler_key,auth_scope,rollout_state,enabled,version) ORDER BY command_code SEPARATOR '\n'),256) FROM command_registry WHERE command_code<>'PET_SKILL_INFO';")
    if ($LASTEXITCODE -ne 0 -or $rollbackState.Count -ne 3 -or $rollbackState[0] -ne "pet_skill_info|VERIFIED_USER|SHADOW|1|1" -or $rollbackState[1] -ne "varchar(100)|NO|utf8mb4|utf8mb4_unicode_ci" -or $rollbackState[2] -ne $unrelatedBefore[0]) {
      throw "WBS770 rollback restoration mismatch: $($rollbackState -join ',')"
    }

    Invoke-Checked {
      & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName "--execute=DELETE FROM schema_migrations WHERE version='487_pet_skill_info_direct_reply_canary.sql'"
    }
    Invoke-Checked { & node --import tsx scripts/migrate.ts }
    $reapplyState = @(& $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName --batch --skip-column-names "--execute=SELECT COUNT(*) FROM schema_migrations; SELECT CONCAT(handler_key,'|',auth_scope,'|',rollout_state,'|',enabled,'|',version) FROM command_registry WHERE command_code='PET_SKILL_INFO'; SELECT CONCAT(COLUMN_TYPE,'|',IS_NULLABLE,'|',CHARACTER_SET_NAME,'|',COLLATION_NAME) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='command_routing_decisions' AND COLUMN_NAME='event_id'; SELECT SHA2(GROUP_CONCAT(CONCAT_WS('|',command_code,handler_key,auth_scope,rollout_state,enabled,version) ORDER BY command_code SEPARATOR '\n'),256) FROM command_registry WHERE command_code<>'PET_SKILL_INFO';")
    if ($LASTEXITCODE -ne 0 -or $reapplyState.Count -ne 4 -or [int]$reapplyState[0] -ne $expectedMigrationCount -or $reapplyState[1] -ne "pet_skill_info|VERIFIED_USER|CANARY|1|2" -or $reapplyState[2] -ne "varchar(128)|NO|utf8mb4|utf8mb4_unicode_ci" -or $reapplyState[3] -ne $unrelatedBefore[0]) {
      throw "WBS770 migration reapply mismatch: $($reapplyState -join ',')"
    }

    Invoke-Checked {
      & node --import tsx --test test/pet-skill-info-direct-reply-mariadb.integration.test.ts
    }
  } finally {
    Pop-Location
  }

  $productionAfterTests = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
  if (Compare-Object $productionBefore $productionAfterTests) {
    throw "Production 3306 listener ownership changed during WBS770 rehearsal"
  }
} catch {
  $failure = $_
} finally {
  try {
    Stop-IsolatedMariaDb
    Wait-IsolatedPortReleased
  } catch {
    $cleanupErrors.Add($_.Exception.Message)
  }

  $remainingListeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($remainingListeners.Count -gt 0) {
    $cleanupErrors.Add("WBS770 port $port still has a listener after cleanup")
  } else {
    try {
      Remove-TemporaryRoot
    } catch {
      $cleanupErrors.Add($_.Exception.Message)
    }
  }

  foreach ($name in $environmentNames) {
    if ($null -eq $savedEnvironment[$name]) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -LiteralPath "Env:$name" -Value $savedEnvironment[$name]
    }
  }

  $productionAfterCleanup = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
  if (Compare-Object $productionBefore $productionAfterCleanup) {
    $cleanupErrors.Add("Production 3306 listener ownership changed after WBS770 cleanup")
  }
}

if ($null -ne $failure) {
  throw $failure
}
if ($cleanupErrors.Count -gt 0) {
  throw ($cleanupErrors -join "; ")
}

Write-Output "WBS770_ISOLATED_MARIADB_PASS migrations=$expectedMigrationCount migration487=1 rollback487=restoredExact rollbackDriftGuard=pass migration487Reapply=pass unrelatedRegistryUnchanged=true atomicDirect=1 replayDml=0 deniedOutbox=0 historicalShadowOutbox=0 workerSpySends=1 workerReplay=0 externalNetwork=0 port=3340 database=hoibot_wbs770_pet_skill_direct tempCleaned=true production3306Unchanged=true"
