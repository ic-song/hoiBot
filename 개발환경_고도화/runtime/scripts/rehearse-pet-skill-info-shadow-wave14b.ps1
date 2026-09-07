$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wave14b-pet-skill-info-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3332
$databaseName = "hoibot_wave14b_pet_skill_info"
$password = "wave14b-isolated-root-only"
$serverProcess = $null
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$names = @("DATABASE_ENABLED","DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","HOIBOT_ENVIRONMENT_CODE","IRIS_SHARED_TOKEN","USER_VERIFICATION_PEPPER")
$saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,"Process") }
function Assert-SafeRoot { if (-not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe Wave14B temporary path" } }
function Invoke-Checked([scriptblock]$command) { & $command; if ($LASTEXITCODE -ne 0) { throw "Wave14B child command failed: $LASTEXITCODE" } }
function Invoke-Sql([string]$sql) { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--batch" "--skip-column-names" "--execute=$sql" }
function Start-Isolated {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$port","--bind-address=127.0.0.1","--skip-networking=0","--pid-file=$(Join-Path $temporaryRoot 'mariadbd.pid')","--log-error=$(Join-Path $temporaryRoot 'mariadbd.err')") -PassThru -WindowStyle Hidden
  for ($attempt=0; $attempt -lt 150; $attempt+=1) { if ($script:serverProcess.HasExited) { throw "Wave14B MariaDB exited early" }; $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue; if ($null -ne $listener) { return }; Start-Sleep -Milliseconds 200 }
  throw "Wave14B MariaDB startup timeout"
}
function Stop-Isolated { if ($null -ne $script:serverProcess -and -not $script:serverProcess.HasExited) { Stop-Process -Id $script:serverProcess.Id; $script:serverProcess.WaitForExit(10000) | Out-Null } }
try {
  Assert-SafeRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Wave14B port already in use" }
  foreach ($binary in @($installDatabase,$serverBinary,$clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Missing MariaDB binary: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent }
  Start-Isolated
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  $env:DATABASE_ENABLED="true"; $env:DATABASE_HOST="127.0.0.1"; $env:DATABASE_PORT=[string]$port; $env:DATABASE_USER="root"; $env:DATABASE_PASSWORD=$password; $env:DATABASE_NAME=$databaseName; $env:HOIBOT_ENVIRONMENT_CODE="dev"; $env:IRIS_SHARED_TOKEN="wave14b-isolated-token"; $env:USER_VERIFICATION_PEPPER="wave14b-isolated-pepper"
  Push-Location $runtimeRoot
  try { Invoke-Checked { & node --import tsx scripts/migrate.ts }; Invoke-Checked { & node --import tsx scripts/seed-canonical-pet-skill-read.ts } } finally { Pop-Location }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_skill_definitions' AND column_name IN ('raid_charm_bonus','castle_charm_bonus')") -ne "2") { throw "Wave14B charm columns missing" }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM canonical_pet_skill_definitions WHERE active_flag=TRUE AND (raid_charm_bonus IS NULL OR castle_charm_bonus IS NULL)") -ne "0") { throw "Wave14B charm metadata incomplete" }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM canonical_pet_skill_definitions WHERE legacy_source_key BETWEEN 'skill_060' AND 'skill_089' AND tier_exclusive_flag=TRUE AND raid_charm_bonus=castle_charm_bonus AND raid_charm_bonus>0") -ne "30") { throw "Wave14B tier crosswalk mismatch" }
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=source migrations/rollback/484_pet_skill_info_shadow_ingress.rollback.sql" }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_skill_definitions' AND column_name IN ('raid_charm_bonus','castle_charm_bonus')") -ne "0") { throw "Wave14B rollback retained columns" }
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=source migrations/484_pet_skill_info_shadow_ingress.sql" }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='canonical_pet_skill_definitions' AND column_name IN ('raid_charm_bonus','castle_charm_bonus')") -ne "2") { throw "Wave14B forward replay failed" }
  $productionAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionBefore $productionAfter) { throw "Production 3306 listener changed" }
  Write-Output "WAVE14B_ISOLATED_MARIADB_PASS migrations=all seed=93 rollback=true forward=true port=$port production3306Unchanged=true"
} finally {
  Stop-Isolated
  if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { Assert-SafeRoot; if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force } }
  foreach ($name in $names) { if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $saved[$name] } }
}
