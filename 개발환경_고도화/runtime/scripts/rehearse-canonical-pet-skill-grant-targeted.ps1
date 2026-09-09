$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs789-pet-skill-grant-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$port = 3348
$databaseName = "hoibot_wbs789_pet_skill_grant_2617"
$password = "wbs789-isolated-root-only"
$serverProcess = $null
$productionBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$names = @("DATABASE_ENABLED","DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","HOIBOT_ENVIRONMENT_CODE","IRIS_SHARED_TOKEN","USER_VERIFICATION_PEPPER")
$saved = @{}; foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,"Process") }
function Assert-SafeRoot { if (-not $temporaryRoot.StartsWith($worktreeRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe WBS789 temporary path" } }
function Invoke-Checked([scriptblock]$command) { & $command; if ($LASTEXITCODE -ne 0) { throw "WBS789 child command failed: $LASTEXITCODE" } }
try {
  Assert-SafeRoot
  if ($port -eq 3306 -or (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { throw "WBS789 isolated port rejected" }
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  Invoke-Checked { & (Join-Path $mariaBin "mariadb-install-db.exe") "--datadir=$dataDirectory" "--password=$password" "--port=$port" --allow-remote-root-access --silent }
  $serverProcess = Start-Process -FilePath (Join-Path $mariaBin "mariadbd.exe") -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$port","--bind-address=127.0.0.1","--skip-networking=0","--pid-file=$(Join-Path $temporaryRoot 'mariadbd.pid')","--log-error=$(Join-Path $temporaryRoot 'mariadbd.err')") -PassThru -WindowStyle Hidden
  for($attempt=0;$attempt -lt 150;$attempt+=1){if($serverProcess.HasExited){throw "WBS789 MariaDB exited early"};if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){break};Start-Sleep -Milliseconds 200}
  if(-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)){throw "WBS789 MariaDB startup timeout"}
  $client=Join-Path $mariaBin "mariadb.exe"
  Invoke-Checked { & $client --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  foreach($migration in @("443_object_identity_audit_provider.sql","444_canonical_item_inventory.sql","446_canonical_pet_equipment.sql","449_canonical_pet_skill.sql")){ $path=(Join-Path $runtimeRoot "migrations\$migration").Replace("\","/"); Invoke-Checked { & $client --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--database=$databaseName" "--execute=SOURCE $path" } }
  $env:DATABASE_ENABLED="true";$env:DATABASE_HOST="127.0.0.1";$env:DATABASE_PORT=[string]$port;$env:DATABASE_USER="root";$env:DATABASE_PASSWORD=$password;$env:DATABASE_NAME=$databaseName;$env:HOIBOT_ENVIRONMENT_CODE="dev";$env:IRIS_SHARED_TOKEN="wbs789-isolated";$env:USER_VERIFICATION_PEPPER="wbs789-isolated"
  Push-Location $runtimeRoot; try { Invoke-Checked { & node --import tsx scripts/verify-canonical-pet-skill-grant-targeted.ts } } finally { Pop-Location }
  $productionAfter=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if(Compare-Object $productionBefore $productionAfter){throw "Production 3306 listener changed"}
  Write-Output "WBS789_TARGETED_MARIADB_PASS consumer=sql-repository-31c4099080d9c9c1 migrations=443+444+446+449 scenarios=7 successDml=2 rollbackCommitted=0 replayDml=0 driftDml=0 restartDml=0 sameKeySingleWriter=true differentKeySum=8 production3306Unchanged=true"
} finally {
  if($null -ne $serverProcess -and -not $serverProcess.HasExited){Stop-Process -Id $serverProcess.Id;$serverProcess.WaitForExit(10000)|Out-Null}
  $remaining=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if($null -eq $remaining -and (Test-Path -LiteralPath $temporaryRoot)){Assert-SafeRoot;Remove-Item -LiteralPath $temporaryRoot -Recurse -Force}
  foreach($name in $names){if($null -eq $saved[$name]){Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue}else{Set-Item -LiteralPath "Env:$name" -Value $saved[$name]}}
  if($null -ne $remaining){throw "WBS789 listener remained"}
}
