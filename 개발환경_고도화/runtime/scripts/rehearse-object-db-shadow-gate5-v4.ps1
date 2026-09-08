$ErrorActionPreference = "Stop"
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$container = "hoibot-wbs782-shadow-v4-$PID"
$databaseName = "hoibot_wbs782_shadow_v4_$PID"
$adminUser = "wbs782_admin"
$adminPassword = "wbs782-admin-only"
$shadowUser = "wbs782_shadow"
$shadowPassword = "wbs782-select-only"
$rootPassword = "wbs782-root-only"
$image = "mariadb@sha256:67873d30a17f6a9c331f06363b2fa15f38abca415529966d67c84f87f82439fe"
$port = $null
$success = $null
$environmentNames = @("DATABASE_ENABLED","DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","HOIBOT_ENVIRONMENT_CODE","IRIS_SHARED_TOKEN","USER_VERIFICATION_PEPPER","WBS782_SHADOW_V4_MARIADB_TEST","WBS782_SHADOW_V4_MARIADB_PHASE","WBS782_ADMIN_DATABASE_USER","WBS782_ADMIN_DATABASE_PASSWORD","WBS782_SHADOW_DATABASE_USER","WBS782_SHADOW_DATABASE_PASSWORD")
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,"Process") }
$host3306Before = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
function Invoke-Checked([scriptblock]$command) { & $command; if ($LASTEXITCODE -ne 0) { throw "WBS782 child command failed: $LASTEXITCODE" } }
function Invoke-Maria([string]$sql) { Invoke-Checked { docker exec $container mariadb --protocol=socket --user=root "--password=$rootPassword" "--execute=$sql" } }
function Wait-Maria { for ($attempt=0; $attempt -lt 180; $attempt+=1) { docker exec $container mariadb --protocol=socket --user=root "--password=$rootPassword" --execute="SELECT 1" 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { return }; Start-Sleep -Milliseconds 500 }; throw "WBS782 MariaDB startup timeout" }
function Run-Test([string]$testPhase) { $env:WBS782_SHADOW_V4_MARIADB_PHASE=$testPhase; Push-Location $runtimeRoot; try { $output = & node --import tsx --test test/object-db-shadow-gate5-v4-mariadb.integration.test.ts 2>&1; $exit=$LASTEXITCODE; if($exit-ne 0){throw "WBS782 integration failed: $exit`n$($output -join "`n")"}; $line=@($output | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^WBS782_GATE5_V4_RECEIPT ' }); if($line.Count-ne 1){throw "WBS782 receipt line missing`n$($output -join "`n")"}; return ($line[0].Substring("WBS782_GATE5_V4_RECEIPT ".Length) | ConvertFrom-Json) } finally { Pop-Location } }
try {
  $localImage = docker image inspect $image --format '{{.Id}}' 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($localImage)) { throw "WBS782 pinned local MariaDB 11.4 image unavailable; network pull is forbidden" }
  if (docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $container }) { throw "WBS782 container name collision" }
  Invoke-Checked { docker run --detach --name $container --env "MARIADB_ROOT_PASSWORD=$rootPassword" --publish "127.0.0.1::3306" $image | Out-Null }
  Wait-Maria
  $mapping = docker port $container 3306/tcp
  if ($LASTEXITCODE -ne 0 -or $mapping -notmatch '127\.0\.0\.1:(\d+)$') { throw "WBS782 dynamic port unavailable" }
  $port = [int]$Matches[1]
  if ($port -eq 3306) { throw "WBS782 isolated port must not be 3306" }
  Invoke-Maria "CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER '$adminUser'@'%' IDENTIFIED BY '$adminPassword'; GRANT ALL PRIVILEGES ON $databaseName.* TO '$adminUser'@'%'; CREATE USER '$shadowUser'@'%' IDENTIFIED BY '$shadowPassword'; GRANT SELECT ON $databaseName.* TO '$shadowUser'@'%'; FLUSH PRIVILEGES;"
  $env:DATABASE_ENABLED="true";$env:DATABASE_HOST="127.0.0.1";$env:DATABASE_PORT=[string]$port;$env:DATABASE_USER=$adminUser;$env:DATABASE_PASSWORD=$adminPassword;$env:DATABASE_NAME=$databaseName;$env:HOIBOT_ENVIRONMENT_CODE="dev";$env:IRIS_SHARED_TOKEN="wbs782-isolated-token";$env:USER_VERIFICATION_PEPPER="wbs782-isolated-pepper";$env:WBS782_SHADOW_V4_MARIADB_TEST="true";$env:WBS782_ADMIN_DATABASE_USER=$adminUser;$env:WBS782_ADMIN_DATABASE_PASSWORD=$adminPassword;$env:WBS782_SHADOW_DATABASE_USER=$shadowUser;$env:WBS782_SHADOW_DATABASE_PASSWORD=$shadowPassword
  Push-Location $runtimeRoot; try {
    $migrationOutput=& node --import tsx scripts/migrate.ts 2>&1
    $migrationExit=$LASTEXITCODE
    $appliedBefore490=& docker exec $container mariadb "-u$adminUser" "--password=$adminPassword" -N -B $databaseName -e "SELECT COUNT(*) FROM schema_migrations"
    if($migrationExit-ne 0){
      $failureText=($migrationOutput -join "`n")
      if($appliedBefore490 -ne '477' -or $failureText -notmatch '490_item_bag_import_baseline_ordering' -or $failureText -notmatch 'DELIMITER'){ $migrationOutput|ForEach-Object{Write-Output $_};throw "WBS782 migration failed before the known CLI-delimiter boundary" }
      $migration490=Join-Path $runtimeRoot 'migrations\490_item_bag_import_baseline_ordering.sql'
      Get-Content -Raw -LiteralPath $migration490 | docker exec -i $container mariadb "-u$adminUser" "--password=$adminPassword" $databaseName
      if($LASTEXITCODE-ne 0){throw "WBS782 migration490 CLI apply failed"}
      $checksum490=(Get-FileHash -Algorithm SHA256 -LiteralPath $migration490).Hash.ToLowerInvariant()
      Invoke-Maria "INSERT INTO $databaseName.schema_migrations(version,checksum,applied_at) VALUES ('490_item_bag_import_baseline_ordering.sql','$checksum490',UTC_TIMESTAMP(3))"
    }
    $migrationCount=& docker exec $container mariadb "-u$adminUser" "--password=$adminPassword" -N -B $databaseName -e "SELECT COUNT(*) FROM schema_migrations"
    if($migrationCount -ne '478'){throw "WBS782 migration count mismatch: $migrationCount"}
    $replayOutput=& node --import tsx scripts/migrate.ts 2>&1
    if($LASTEXITCODE-ne 0){$replayOutput|ForEach-Object{Write-Output $_};throw "WBS782 migration replay failed"}
    if(@($replayOutput|Where-Object{[string]$_ -match '^applied '}).Count-ne 0 -or -not($replayOutput -contains 'migration-count 478')){throw "WBS782 migration replay was not zero-apply"}
  } finally { Pop-Location }
  $first=Run-Test "prepare"
  Invoke-Checked { docker restart $container | Out-Null }
  Wait-Maria
  $restartMapping=[string](docker port $container 3306/tcp | Select-Object -First 1)
  $restartPortMatch=[regex]::Match($restartMapping.Trim(),'127\.0\.0\.1:(\d+)$')
  if(-not $restartPortMatch.Success -or [int]$restartPortMatch.Groups[1].Value -eq 3306){throw "WBS782 restart dynamic port invalid: $restartMapping"}
  $port=[int]$restartPortMatch.Groups[1].Value
  $env:DATABASE_PORT=[string]$port
  $second=Run-Test "restart"
  if($first.payloadSha256 -ne $second.payloadSha256 -or ($first.payload | ConvertTo-Json -Compress -Depth 10) -ne ($second.payload | ConvertTo-Json -Compress -Depth 10)){throw "WBS782 restart receipt drift"}
  $host3306After = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
  if (Compare-Object $host3306Before $host3306After) { throw "WBS782 host 3306 listener changed" }
  $success="WBS782_GATE5_V4_MARIADB_PASS image=$image port=$port migrations=478 replayApplied=0 registeredMigrations=39 registeredTables=119 effectiveColumns=263 directTargets=47 shadowTargets=45 selectOnly=true restartExact=true schemaFingerprint=$($first.payload.schemaFingerprint) rowFingerprint=$($first.payload.rowFingerprint) projectionFingerprint=$($first.payload.projectionFingerprint) sideEffectFingerprint=$($first.payload.sideEffectFingerprint) receiptSha256=$($first.payloadSha256) host3306Unchanged=true cleanupNoResidue=true"
} finally {
  $errors=[Collections.Generic.List[string]]::new()
  docker rm --force $container 2>$null | Out-Null
  if(docker ps -a --format '{{.Names}}' | Where-Object {$_ -eq $container}){$errors.Add("WBS782 container remained")}
  if($null-ne $port -and $null-ne (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)){$errors.Add("WBS782 listener remained")}
  foreach($name in $environmentNames){if($null-eq $savedEnvironment[$name]){Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue}else{Set-Item -LiteralPath "Env:$name" -Value $savedEnvironment[$name]}}
  if($errors.Count-gt 0){throw "WBS782 cleanup failed: $($errors -join ' | ')"}
}
Write-Output $success
