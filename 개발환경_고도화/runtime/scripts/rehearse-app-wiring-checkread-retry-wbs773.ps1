$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs773-app-wiring-checkread-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3338
$databaseName = "hoibot_wbs773_checkread_retry"
$password = "wbs773-isolated-root-only"
$serverProcess = $null
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$names = @("DATABASE_ENABLED","DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","HOIBOT_ENVIRONMENT_CODE","IRIS_SHARED_TOKEN","USER_VERIFICATION_PEPPER")
$saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,"Process") }
function Assert-SafeRoot { if (-not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe WBS773 temporary path" } }
function Invoke-Checked([scriptblock]$command) { & $command; if ($LASTEXITCODE -ne 0) { throw "WBS773 child command failed: $LASTEXITCODE" } }
function Start-Isolated {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$port","--bind-address=127.0.0.1","--skip-networking=0","--innodb-lock-wait-timeout=1","--pid-file=$(Join-Path $temporaryRoot 'mariadbd.pid')","--log-error=$(Join-Path $temporaryRoot 'mariadbd.err')") -PassThru -WindowStyle Hidden
  for ($attempt=0; $attempt -lt 150; $attempt+=1) { if ($script:serverProcess.HasExited) { throw "WBS773 MariaDB exited early" }; if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { return }; Start-Sleep -Milliseconds 200 }
  throw "WBS773 MariaDB startup timeout"
}
function Stop-Isolated { if ($null -ne $script:serverProcess -and -not $script:serverProcess.HasExited) { Stop-Process -Id $script:serverProcess.Id; $script:serverProcess.WaitForExit(10000) | Out-Null } }
try {
  Assert-SafeRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "WBS773 port already in use" }
  foreach ($binary in @($installDatabase,$serverBinary,$clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Missing MariaDB binary: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent }
  Start-Isolated
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  $env:DATABASE_ENABLED="true"; $env:DATABASE_HOST="127.0.0.1"; $env:DATABASE_PORT=[string]$port; $env:DATABASE_USER="root"; $env:DATABASE_PASSWORD=$password; $env:DATABASE_NAME=$databaseName; $env:HOIBOT_ENVIRONMENT_CODE="dev"; $env:IRIS_SHARED_TOKEN="wbs773-isolated-token"; $env:USER_VERIFICATION_PEPPER="wbs773-isolated-pepper"
  Push-Location $runtimeRoot
  try { Invoke-Checked { & node --import tsx scripts/migrate.ts }; Invoke-Checked { & node --import tsx scripts/probe-app-wiring-checkread-retry-wbs773.ts } } finally { Pop-Location }
  $productionAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionBefore $productionAfter) { throw "Production 3306 listener changed" }
  Write-Output "WBS773_ISOLATED_MARIADB_PASS both202=true exactCheckreadRetry=true commonOutbox0=true externalSend0=true port=$port production3306Unchanged=true"
} finally {
  Stop-Isolated
  if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { Assert-SafeRoot; if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force } }
  foreach ($name in $names) { if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $saved[$name] } }
}
