$ErrorActionPreference = "Stop"

$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs769-pet-skill-info-actor-context-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$pidFile = Join-Path $temporaryRoot "mariadbd.pid"
$errorLog = Join-Path $temporaryRoot "mariadbd.err"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3339
$databaseName = "hoibot_wbs769_actor_context"
$password = "wbs769-isolated-root-only"
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
  "ACCOUNT_PLATFORM_MARIADB_TEST"
)
$savedEnvironment = @{}
foreach ($name in $environmentNames) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

function Assert-SafeTemporaryRoot {
  $expectedRoot = $worktreeRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $temporaryRoot.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe WBS769 temporary root: $temporaryRoot"
  }
  if ([IO.Path]::GetFileName($temporaryRoot) -ne "wbs769-pet-skill-info-actor-context-mariadb") {
    throw "Unexpected WBS769 temporary root name: $temporaryRoot"
  }
}

function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) {
    throw "WBS769 child command failed with exit code $LASTEXITCODE"
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
      throw "WBS769 isolated MariaDB exited early. See $errorLog"
    }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
      if ($owners.Count -ne 1 -or $owners[0] -ne $script:serverProcess.Id) {
        throw "WBS769 listener ownership mismatch on port $port"
      }
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "WBS769 isolated MariaDB startup timed out"
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
    throw "WBS769 isolated MariaDB did not stop"
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
  throw "WBS769 temporary root could not be removed: $temporaryRoot"
}

function Wait-IsolatedPortReleased {
  for ($attempt = 0; $attempt -lt 300; $attempt += 1) {
    if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "WBS769 port $port still has a listener after cleanup"
}

try {
  Assert-SafeTemporaryRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "WBS769 port $port is already in use"
  }
  foreach ($binary in @($installDatabase, $serverBinary, $clientBinary)) {
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
      throw "Missing MariaDB binary: $binary"
    }
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
  $env:IRIS_SHARED_TOKEN = "wbs769-isolated-token"
  $env:USER_VERIFICATION_PEPPER = "wbs769-isolated-pepper"
  $env:ACCOUNT_PLATFORM_MARIADB_TEST = "true"

  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & node --import tsx scripts/migrate.ts }

    $migrationCounts = @(& $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" --database=$databaseName --batch --skip-column-names "--execute=SELECT COUNT(*) FROM schema_migrations; SELECT COUNT(*) FROM schema_migrations WHERE version IN ('467_account_portal_game_links.sql','468_account_platform_contexts.sql','469_account_active_player_verification.sql');")
    if ($LASTEXITCODE -ne 0) {
      throw "WBS769 migration evidence query failed with exit code $LASTEXITCODE"
    }
    if ($migrationCounts.Count -ne 2 -or [int]$migrationCounts[0] -ne 474 -or [int]$migrationCounts[1] -ne 3) {
      throw "WBS769 migration evidence mismatch: $($migrationCounts -join ',')"
    }

    Invoke-Checked {
      & node --import tsx --test '--test-name-pattern=applies portal ownership and context-scoped selection invariants in one rollback-only fixture' test/account-platform-mariadb.integration.test.ts
    }
    Invoke-Checked {
      & node --import tsx --test test/pet-skill-info-actor-context-provider.test.ts
    }
  } finally {
    Pop-Location
  }

  $productionAfterTests = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
  if (Compare-Object $productionBefore $productionAfterTests) {
    throw "Production 3306 listener ownership changed during WBS769 rehearsal"
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
    $cleanupErrors.Add("WBS769 port $port still has a listener after cleanup")
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
    $cleanupErrors.Add("Production 3306 listener ownership changed after WBS769 cleanup")
  }
}

if ($null -ne $failure) {
  throw $failure
}
if ($cleanupErrors.Count -gt 0) {
  throw ($cleanupErrors -join "; ")
}

Write-Output "WBS769_ISOLATED_MARIADB_PASS migrations=474 accountPlatformMigrations=3 targetedIntegration=true actorProviderUnit=4 port=3339 database=hoibot_wbs769_actor_context tempCleaned=true production3306Unchanged=true"
