param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$Image = "mariadb:11.4"
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$containerName = "hoibot-wbs778-$PID"
$databaseName = "hoibot_wbs778"
$databaseUser = "wbs778"
$databasePassword = "wbs778-isolated-only"
$rootPassword = "wbs778-root-isolated-only"
$dependencyFixturePath = Join-Path (Split-Path -Parent $runtimeRoot) "migration-control/evidence/legacy-rank-label-side-effect-certificate-lease2606/fixtures/488_item_bag_import_completeness.harness-only.sql"
$dependencySourceCommit = "505fac1657c35bdc322b5cb0c742cf0b877efc64"
$dependencySourceSha256 = "932e7634543a18b6aeeed5ac1881aa94bb765721fa90a598efe5cd8c60290734"
$transcriptPath = Join-Path $OutputDirectory "isolated-mariadb-transcript.log"
$receiptPath = Join-Path $OutputDirectory "isolated-mariadb-receipt.json"
$transcriptTempPath = "$transcriptPath.tmp-$PID"
$receiptTempPath = "$receiptPath.tmp-$PID"
if (Test-Path -LiteralPath $transcriptPath) { throw "WBS778_TRANSCRIPT_ALREADY_EXISTS" }
if (Test-Path -LiteralPath $receiptPath) { throw "WBS778_RECEIPT_ALREADY_EXISTS" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$lines = [System.Collections.Generic.List[string]]::new()
function Add-Evidence([string]$value) { $lines.Add($value) }
function Sha256([string]$value) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
  return [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}
function Query([string]$sql) {
  $result = & docker exec $containerName mariadb "-u$databaseUser" "--password=$databasePassword" -N -B $databaseName -e $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "WBS778_QUERY_FAILED: $result" }
  return ($result -join "`n").Trim()
}
function Run-Migrations {
  Push-Location $runtimeRoot
  try {
    $env:NODE_ENV = "development"
    $env:IRIS_SHARED_TOKEN = "wbs778-isolated-token"
    $env:DATABASE_ENABLED = "true"
    $env:HOIBOT_ENVIRONMENT_CODE = "dev"
    $env:DATABASE_HOST = "127.0.0.1"
    $env:DATABASE_PORT = "$hostPort"
    $env:DATABASE_USER = $databaseUser
    $env:DATABASE_PASSWORD = $databasePassword
    $env:DATABASE_NAME = $databaseName
    $output = & npm.cmd run db:migrate 2>&1
    if ($LASTEXITCODE -ne 0) { throw "WBS778_MIGRATION_FAILED: $output" }
    Add-Evidence "migration.runner=PASS"
  } finally { Pop-Location }
}

try {
  $repoDigest = (& docker image inspect $Image --format "{{index .RepoDigests 0}}" 2>&1).Trim()
  if ($LASTEXITCODE -ne 0 -or $repoDigest -notmatch "@sha256:[0-9a-f]{64}$") { throw "WBS778_IMAGE_DIGEST_UNAVAILABLE" }
  $runImage = $repoDigest
  $containerId = (& docker run --detach --rm --name $containerName --label "hoibot.scope=wbs778-isolated" -e "MARIADB_ROOT_PASSWORD=$rootPassword" -e "MARIADB_DATABASE=$databaseName" -e "MARIADB_USER=$databaseUser" -e "MARIADB_PASSWORD=$databasePassword" -p "127.0.0.1::3306" $runImage).Trim()
  if ($LASTEXITCODE -ne 0 -or $containerId -notmatch "^[0-9a-f]{64}$") { throw "WBS778_CONTAINER_START_FAILED" }
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    & docker exec $containerName mariadb "-u$databaseUser" "--password=$databasePassword" -N -B $databaseName -e "SELECT 1" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "WBS778_MARIADB_NOT_READY" }
  $hostPort = (& docker port $containerName 3306/tcp).Trim().Split(":")[-1]
  if ($hostPort -notmatch "^[0-9]+$") { throw "WBS778_DYNAMIC_PORT_INVALID" }
  $serverVersion = Query "SELECT VERSION()"
  Add-Evidence "scope=isolated-container"
  Add-Evidence "container.name=$containerName"
  Add-Evidence "container.id=$containerId"
  Add-Evidence "image.ref=$Image"
  Add-Evidence "image.digest=$repoDigest"
  Add-Evidence "image.run_reference=$runImage"
  Add-Evidence "mariadb.version=$serverVersion"
  Add-Evidence "database.name=$databaseName"
  Add-Evidence "database.user=$databaseUser"
  Add-Evidence "database.host=127.0.0.1"
  Add-Evidence "database.dynamic_port=$hostPort"
  Add-Evidence "operational.database.used=false"
  Add-Evidence "operational.port.3306.bound_by_harness=false"

  Run-Migrations
  $migrationNames = @((Query "SELECT version FROM schema_migrations ORDER BY version") -split "`n")
  if ($migrationNames.Count -ne 476 -or $migrationNames[-1] -ne "489_legacy_rank_label_side_effect_certificate.sql") { throw "WBS778_MIGRATION_SET_MISMATCH" }
  Add-Evidence "migration.count=$($migrationNames.Count)"
  Add-Evidence "migration.last=$($migrationNames[-1])"
  $dependencyFixtureSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $dependencyFixturePath).Hash.ToLowerInvariant()
  if ($dependencyFixtureSha256 -ne $dependencySourceSha256) { throw "WBS778_WBS777_DEPENDENCY_HASH_MISMATCH" }
  $dependencySql = Get-Content -Raw -LiteralPath $dependencyFixturePath
  $dependencyApply = $dependencySql | & docker exec -i $containerName mariadb "-u$databaseUser" "--password=$databasePassword" $databaseName 2>&1
  if ($LASTEXITCODE -ne 0) { throw "WBS778_WBS777_DEPENDENCY_APPLY_FAILED: $dependencyApply" }
  $requiredDependencyColumns = @((Query "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='player_item_bag_import_completeness_projections' AND column_name IN ('player_id','object_domain_import_run_id','projection_version','completeness_fingerprint','revision','active_flag') ORDER BY column_name") -split "`n")
  $expectedDependencyColumns = @("active_flag","completeness_fingerprint","object_domain_import_run_id","player_id","projection_version","revision")
  if (($requiredDependencyColumns -join "|") -ne ($expectedDependencyColumns -join "|")) { throw "WBS778_WBS777_DEPENDENCY_COLUMNS_MISMATCH" }
  Add-Evidence "dependency.wbs=WBS777"
  Add-Evidence "dependency.source_commit=$dependencySourceCommit"
  Add-Evidence "dependency.source_sha256=$dependencySourceSha256"
  Add-Evidence "dependency.fixture_sha256=$dependencyFixtureSha256"
  Add-Evidence "dependency.table=player_item_bag_import_completeness_projections"
  Add-Evidence "dependency.required_columns=$($requiredDependencyColumns -join ',')"
  $foreignKeys = @((Query "SELECT CONCAT(constraint_name,'|',table_name,'.',column_name,'->',referenced_table_name,'.',referenced_column_name) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND constraint_name LIKE 'fk_legacy_rank_label_%' ORDER BY constraint_name") -split "`n")
  if ($foreignKeys.Count -ne 5) { throw "WBS778_FOREIGN_KEY_COUNT_MISMATCH" }
  foreach ($foreignKey in $foreignKeys) { Add-Evidence "foreign_key=$foreignKey" }

  Push-Location $runtimeRoot
  try { $readinessOutput = & node --import tsx scripts/probe-legacy-rank-label-readiness-isolated.ts 2>&1 }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "WBS778_READINESS_SQL_FAILED: $readinessOutput" }
  $readiness = ($readinessOutput -join "`n").Trim()
  $readinessProbe = $readiness | ConvertFrom-Json
  if (-not $readinessProbe.query.invoked -or -not $readinessProbe.query.completed -or $null -ne $readinessProbe.query.error) { throw "WBS778_READINESS_SQL_NOT_COMPLETED: $readiness" }
  if ($readinessProbe.result.ready -or $readinessProbe.result.reasonCode -ne "LEGACY_SIDE_EFFECT_PARITY_UNPROVEN") { throw "WBS778_READINESS_NOT_EMPTY_FAIL_CLOSED" }
  Add-Evidence "readiness.query.invoked=true"
  Add-Evidence "readiness.query.completed=true"
  Add-Evidence "readiness.query.error=null"
  Add-Evidence "readiness.result.ready=false"
  Add-Evidence "readiness.result.reason=LEGACY_SIDE_EFFECT_PARITY_UNPROVEN"

  $stateBefore = Query "SELECT CONCAT((SELECT COUNT(*) FROM schema_migrations),'|',(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()),'|',(SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND constraint_name LIKE 'fk_legacy_rank_label_%'))"
  Add-Evidence "restart.pre_state=$stateBefore"
  & docker restart $containerName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WBS778_RESTART_FAILED" }
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
    & docker exec $containerName mariadb "-u$databaseUser" "--password=$databasePassword" -N -B $databaseName -e "SELECT 1" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "WBS778_MARIADB_NOT_READY_AFTER_RESTART" }
  $containerIdAfter = (& docker inspect $containerName --format "{{.Id}}").Trim()
  $hostPortAfter = (& docker port $containerName 3306/tcp).Trim().Split(":")[-1]
  if ($hostPortAfter -notmatch "^[0-9]+$") { throw "WBS778_RESTART_DYNAMIC_PORT_INVALID" }
  $hostPort = $hostPortAfter
  Start-Sleep -Seconds 3
  $stateAfter = Query "SELECT CONCAT((SELECT COUNT(*) FROM schema_migrations),'|',(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()),'|',(SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND constraint_name LIKE 'fk_legacy_rank_label_%'))"
  if ($containerIdAfter -ne $containerId -or $stateAfter -ne $stateBefore) { throw "WBS778_RESTART_IDENTITY_OR_STATE_DRIFT" }
  Add-Evidence "restart.container_identity=STABLE"
  Add-Evidence "restart.dynamic_port=$hostPortAfter"
  Add-Evidence "restart.post_state=$stateAfter"

  $h = "a" * 64
  Query "SET FOREIGN_KEY_CHECKS=0; INSERT INTO legacy_rank_label_validation_runs(legacy_rank_label_validation_run_id,raw_landing_run_id,common_staging_run_id,object_domain_import_run_id,projection_version,member_source_path_sha256,member_source_content_sha256,guild_source_path_sha256,guild_source_content_sha256,rank_marker_source_fingerprint,legacy_runtime_source_sha256,membership_semantic_sha256,certificate_set_sha256,validation_fingerprint,expected_subject_count,no_write_count,would_delete_count,unmapped_count,run_status,active_flag,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('vtest001','rtest001','stest001','itest001','LEGACY_RANK_LABEL_SIDE_EFFECT_V1','$h','$h','$h','$h','$h','$h','$h','$h','$h',1,1,0,0,'COMPLETE',FALSE,'lease2606','2026-09-08 12:00:00','lease2606','2026-09-08 12:00:00'); INSERT INTO legacy_rank_label_side_effect_certificates(legacy_rank_label_side_effect_certificate_id,legacy_rank_label_validation_run_id,player_id,source_player_key_sha256,member_presence_state,guild_pointer_state,side_effect_decision,guild_pointer_fingerprint,membership_evidence_fingerprint,certificate_fingerprint,INSERT_USER,INSERT_TIME,UPDATE_USER,UPDATE_TIME) VALUES('ctest001','vtest001',NULL,'$h','PRESENT','NONE','NO_WRITE','$h','$h','$h','lease2606','2026-09-08 12:00:00','lease2606','2026-09-08 12:00:00'); SET FOREIGN_KEY_CHECKS=1;" | Out-Null
  $rollbackSql = Get-Content -Raw (Join-Path $runtimeRoot "migrations/rollback/489_legacy_rank_label_side_effect_certificate.rollback.sql")
  $rollbackFailure = $rollbackSql | & docker exec -i $containerName mariadb "-u$databaseUser" "--password=$databasePassword" $databaseName 2>&1
  if ($LASTEXITCODE -eq 0 -or ($rollbackFailure -join "`n") -notmatch "ROLLBACK_489_DATA_PRESENT") { throw "WBS778_POPULATED_ROLLBACK_DID_NOT_REFUSE" }
  $preserved = Query "SELECT CONCAT((SELECT COUNT(*) FROM legacy_rank_label_validation_runs),'|',(SELECT COUNT(*) FROM legacy_rank_label_side_effect_certificates))"
  if ($preserved -ne "1|1") { throw "WBS778_POPULATED_ROLLBACK_LOST_ROWS" }
  Add-Evidence "rollback.populated=REFUSED:ROLLBACK_489_DATA_PRESENT"
  Add-Evidence "rollback.populated.rows_preserved=$preserved"
  Query "DROP PROCEDURE IF EXISTS rollback_489_legacy_rank_label_side_effect_certificate" | Out-Null
  Query "DELETE FROM legacy_rank_label_validation_runs WHERE legacy_rank_label_validation_run_id='vtest001'" | Out-Null
  $emptyRollback = $rollbackSql | & docker exec -i $containerName mariadb "-u$databaseUser" "--password=$databasePassword" $databaseName 2>&1
  if ($LASTEXITCODE -ne 0) { throw "WBS778_EMPTY_ROLLBACK_FAILED: $emptyRollback" }
  Add-Evidence "rollback.empty=PASS"
  Query "DELETE FROM schema_migrations WHERE version='489_legacy_rank_label_side_effect_certificate.sql'" | Out-Null
  Run-Migrations
  $reapplied = Query "SELECT CONCAT((SELECT COUNT(*) FROM schema_migrations WHERE version='489_legacy_rank_label_side_effect_certificate.sql'),'|',(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('legacy_rank_label_validation_runs','legacy_rank_label_side_effect_certificates')))"
  if ($reapplied -ne "1|2") { throw "WBS778_REAPPLY_FAILED" }
  Add-Evidence "migration.reapply=PASS:$reapplied"

  $transcript = ($lines -join "`n") + "`n"
  [System.IO.File]::WriteAllText($transcriptTempPath, $transcript, [System.Text.UTF8Encoding]::new($false))
  $payload = [ordered]@{
    contract = "WBS778_ISOLATED_MARIADB_RECEIPT_V1"
    image = [ordered]@{ reference=$Image; repositoryDigest=$repoDigest; runReference=$runImage; serverVersion=$serverVersion }
    isolation = [ordered]@{ containerName=$containerName; containerId=$containerId; host="127.0.0.1"; dynamicPort=[int]$hostPort; database=$databaseName; user=$databaseUser; operationalDatabaseUsed=$false; operationalPort3306BoundByHarness=$false }
    migrations = [ordered]@{ count=$migrationNames.Count; names=$migrationNames; reapply="PASS" }
    dependency = [ordered]@{ wbs="WBS777"; sourceCommit=$dependencySourceCommit; sourceSha256=$dependencySourceSha256; fixtureSha256=$dependencyFixtureSha256; table="player_item_bag_import_completeness_projections"; requiredColumns=$requiredDependencyColumns }
    foreignKeys = $foreignKeys
    readiness = $readinessProbe
    restart = [ordered]@{ containerIdentityStable=$true; preState=$stateBefore; postState=$stateAfter }
    rollback = [ordered]@{ populatedRefusal="ROLLBACK_489_DATA_PRESENT"; populatedRowsPreserved=$preserved; emptyRollback="PASS" }
    transcriptSha256 = Sha256 $transcript
  }
  $payloadJson = $payload | ConvertTo-Json -Depth 8 -Compress
  $receipt = [ordered]@{ payload=$payload; payloadSha256=(Sha256 $payloadJson) }
  [System.IO.File]::WriteAllText($receiptTempPath, ($receipt | ConvertTo-Json -Depth 8) + "`n", [System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $transcriptTempPath -Destination $transcriptPath
  Move-Item -LiteralPath $receiptTempPath -Destination $receiptPath
  Write-Output "WBS778 isolated MariaDB rehearsal PASS"
  Write-Output $receiptPath
} finally {
  & docker rm -f $containerName 2>$null | Out-Null
  if (Test-Path -LiteralPath $transcriptTempPath) { Remove-Item -LiteralPath $transcriptTempPath -Force }
  if (Test-Path -LiteralPath $receiptTempPath) { Remove-Item -LiteralPath $receiptTempPath -Force }
}
