$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs764-admin-bag-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$port = 3334
$databaseName = "hoibot_wbs764_admin_bag_projection"
$password = "wbs764-isolated-root-only"
$serverProcess = $null
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$names = @("DATABASE_ENABLED","DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","HOIBOT_ENVIRONMENT_CODE","IRIS_SHARED_TOKEN","USER_VERIFICATION_PEPPER")
$saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,"Process") }
function Assert-SafeRoot { if (-not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe WBS764 temporary path" } }
function Invoke-Checked([scriptblock]$command) { & $command; if ($LASTEXITCODE -ne 0) { throw "WBS764 child command failed: $LASTEXITCODE" } }
function Invoke-Sql([string]$sql) { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" --batch --skip-column-names "--execute=$sql" }
function Start-Isolated {
  $script:serverProcess = Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$port","--bind-address=127.0.0.1","--skip-networking=0","--pid-file=$(Join-Path $temporaryRoot 'mariadbd.pid')","--log-error=$(Join-Path $temporaryRoot 'mariadbd.err')") -PassThru -WindowStyle Hidden
  for ($attempt=0; $attempt -lt 150; $attempt+=1) { if ($script:serverProcess.HasExited) { throw "WBS764 MariaDB exited early" }; $listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue; if ($null -ne $listener) { return }; Start-Sleep -Milliseconds 200 }
  throw "WBS764 MariaDB startup timeout"
}
function Stop-Isolated { if ($null -ne $script:serverProcess -and -not $script:serverProcess.HasExited) { Stop-Process -Id $script:serverProcess.Id; $script:serverProcess.WaitForExit(10000) | Out-Null } }
try {
  Assert-SafeRoot
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "WBS764 port already in use" }
  foreach ($binary in @($installDatabase,$serverBinary,$clientBinary)) { if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Missing MariaDB binary: $binary" } }
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent }
  Start-Isolated
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  $env:DATABASE_ENABLED="true"; $env:DATABASE_HOST="127.0.0.1"; $env:DATABASE_PORT=[string]$port; $env:DATABASE_USER="root"; $env:DATABASE_PASSWORD=$password; $env:DATABASE_NAME=$databaseName; $env:HOIBOT_ENVIRONMENT_CODE="dev"; $env:IRIS_SHARED_TOKEN="wbs764-isolated-token"; $env:USER_VERIFICATION_PEPPER="wbs764-isolated-pepper"
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & node --import tsx scripts/migrate.ts }
    Invoke-Checked { & node --import tsx scripts/seed-canonical-pet-skill-read.ts }
    Invoke-Checked { & node --import tsx scripts/probe-pet-skill-info-admin-bag-projection-synthetic.ts }
  } finally { Pop-Location }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('pet_skill_info_admin_channel_authorities','player_pet_skill_rank_marker_projections','player_pet_skill_bag_import_completeness_projections')") -ne "3") { throw "WBS764 forward tables missing" }
  Stop-Isolated; Start-Isolated
  Push-Location $runtimeRoot
  try { Invoke-Checked { & node --import tsx scripts/probe-pet-skill-info-admin-bag-projection-synthetic.ts --verify-restart } } finally { Pop-Location }
  Push-Location $runtimeRoot
  try {
    $savedErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=source migrations/rollback/485_pet_skill_info_admin_bag_projection.rollback.sql" 2>$null
    $ErrorActionPreference = $savedErrorPreference
    if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('pet_skill_info_admin_channel_authorities','player_pet_skill_rank_marker_projections','player_pet_skill_bag_import_completeness_projections')") -ne "3") { throw "WBS764 rollback preflight removed populated projections" }
    $ErrorActionPreference = "Continue"
    & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=source migrations/rollback/485_pet_skill_info_admin_bag_projection.rollback.sql" 2>$null
    $ErrorActionPreference = $savedErrorPreference
    if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('pet_skill_info_admin_channel_authorities','player_pet_skill_rank_marker_projections','player_pet_skill_bag_import_completeness_projections')") -ne "3") { throw "WBS764 rollback retry removed populated projections" }
  } finally { $ErrorActionPreference = "Stop"; Pop-Location }
  Invoke-Sql "DELETE FROM player_pet_skill_bag_import_completeness_projections; DELETE FROM player_pet_skill_rank_marker_projections; DELETE FROM pet_skill_info_admin_channel_authorities" | Out-Null
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=source migrations/rollback/485_pet_skill_info_admin_bag_projection.rollback.sql" }
    Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=source migrations/485_pet_skill_info_admin_bag_projection.sql" }
  } finally { Pop-Location }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('pet_skill_info_admin_channel_authorities','player_pet_skill_rank_marker_projections','player_pet_skill_bag_import_completeness_projections')") -ne "3") { throw "WBS764 re-forward tables missing" }
  if ([string](Invoke-Sql "SELECT COUNT(*) FROM admin_role_permissions role_permission JOIN admin_roles role ON role.id=role_permission.role_id WHERE role_permission.permission_code='pet.skill.info.admin_bag.read' AND role.code IN ('manager','super_admin')") -ne "2") { throw "WBS764 permission registry/grants were not preserved" }
  $productionAfter = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if (Compare-Object $productionBefore $productionAfter) { throw "Production 3306 listener changed" }
  Write-Output "WBS764_ISOLATED_MARIADB_PASS forward=true syntheticExact=true tamperFailClosed=true restart=true rollbackPreflightDenied=true rollbackRetryDenied=true rollback=true reforward=true permissionPreserved=true port=$port production3306Unchanged=true"
} finally {
  Stop-Isolated
  if ($null -eq (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { Assert-SafeRoot; if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force } }
  foreach ($name in $names) { if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item -LiteralPath "Env:$name" -Value $saved[$name] } }
}
