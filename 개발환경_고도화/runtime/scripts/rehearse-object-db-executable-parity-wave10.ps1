$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wave10-executable-parity-mariadb"))
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wave10-executable-parity-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3330
$databaseName = "hoibot_wave10_executable_parity"
$password = "wave10-isolated-root-only"
$serverProcess = $null
$success = $null
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$names = @("DATABASE_ENABLED", "DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME", "HOIBOT_ENVIRONMENT_CODE", "IRIS_SHARED_TOKEN", "USER_VERIFICATION_PEPPER", "WAVE10_ISOLATED_MARIADB_TEST")
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }

function Assert-SafeRoot {
  if ($temporaryRoot -ne $expectedRoot -or -not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe Wave10 temporary path: $temporaryRoot"
  }
}
function Start-Isolated {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults", "--datadir=$dataDirectory", "--port=$port", "--bind-address=127.0.0.1", "--skip-networking=0", "--pid-file=$(Join-Path $temporaryRoot 'mariadbd.pid')", "--log-error=$(Join-Path $temporaryRoot 'mariadbd.err')") -PassThru -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 150; $attempt += 1) {
    if ($script:serverProcess.HasExited) { throw "Wave10 MariaDB exited early" }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($null -ne $listener) {
      $owners = @($listener | Select-Object -ExpandProperty OwningProcess -Unique)
      if ($owners.Count -ne 1 -or $owners[0] -ne $script:serverProcess.Id) { throw "Wave10 listener ownership mismatch" }
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "Wave10 MariaDB startup timeout"
}
function Stop-Isolated {
  if ($null -eq $script:serverProcess) { return }
  if (-not $script:serverProcess.HasExited) { Stop-Process -Id $script:serverProcess.Id; $script:serverProcess.WaitForExit(10000) | Out-Null }
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Milliseconds 200
  }
  throw "Wave10 listener did not clear"
}
function Invoke-Checked([scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "Wave10 child command failed: $LASTEXITCODE" }
}

try {
  Assert-SafeRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Wave10 port already in use" }
  foreach ($binary in @($installDatabase, $serverBinary, $clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Missing MariaDB binary: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { throw "Wave10 temporary directory exists" }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent }
  Start-Isolated
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  $env:DATABASE_ENABLED = "true"; $env:DATABASE_HOST = "127.0.0.1"; $env:DATABASE_PORT = [string]$port; $env:DATABASE_USER = "root"; $env:DATABASE_PASSWORD = $password; $env:DATABASE_NAME = $databaseName
  $env:HOIBOT_ENVIRONMENT_CODE = "dev"; $env:IRIS_SHARED_TOKEN = "wave10-isolated-token"; $env:USER_VERIFICATION_PEPPER = "wave10-isolated-pepper"; $env:WAVE10_ISOLATED_MARIADB_TEST = "true"
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & node --import tsx scripts/migrate.ts }
    Invoke-Checked { & node --import tsx --test test/object-db-consumer-executable-parity-wave10-mariadb.integration.test.ts }
  } finally { Pop-Location }
  $productionAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionBefore $productionAfter) { throw "Production 3306 listener changed" }
  $success = "WAVE10_ISOLATED_MARIADB_PASS consumers=3 actualHttpIngress=true concurrency=3 rollback=3 pendingForUpdateObserved=true secondCallBlocked=true singleWriterPersisted=true persistedRollbackZero=true production3306Unchanged=true"
} finally {
  $errors = [Collections.Generic.List[string]]::new()
  try { Stop-Isolated } catch { $errors.Add($_.Exception.Message) }
  $remaining = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($null -ne $remaining) { $errors.Add("Wave10 listener remained") }
  if ($null -eq $remaining) {
    try { Assert-SafeRoot; if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force } } catch { $errors.Add($_.Exception.Message) }
  }
  foreach ($name in $names) { if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $saved[$name] } }
  if ($errors.Count -gt 0) { throw "Wave10 cleanup failed: $($errors -join ' | ')" }
}
Write-Output $success
