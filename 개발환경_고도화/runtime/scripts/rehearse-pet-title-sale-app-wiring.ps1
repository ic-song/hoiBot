$ErrorActionPreference = "Stop"

$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$worktreeRoot = [System.IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs743-pet-title-sale-mariadb"))
$expectedTemporaryRoot = [System.IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs743-pet-title-sale-mariadb"))
$dataDirectory = Join-Path $temporaryRoot "data"
$pidFile = Join-Path $temporaryRoot "mariadbd.pid"
$errorLog = Join-Path $temporaryRoot "mariadbd.err"
$mariaBin = "C:\Program Files\MariaDB 12.2\bin"
$installDatabase = Join-Path $mariaBin "mariadb-install-db.exe"
$serverBinary = Join-Path $mariaBin "mariadbd.exe"
$clientBinary = Join-Path $mariaBin "mariadb.exe"
$rehearsalPort = 3324
$rehearsalDatabase = "hoibot_rehearsal_wbs743_pet_title_sale"
$rehearsalPassword = "wbs743-pet-title-sale-only"
$serverProcess = $null
$initialPid = $null
$restartPid = $null
$successMessage = $null
$productionListenerBefore = @(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$savedEnvironment = @{ DATABASE_HOST=$env:DATABASE_HOST; DATABASE_PORT=$env:DATABASE_PORT; DATABASE_USER=$env:DATABASE_USER; DATABASE_PASSWORD=$env:DATABASE_PASSWORD; DATABASE_NAME=$env:DATABASE_NAME; PET_TITLE_SALE_MARIADB_PHASE=$env:PET_TITLE_SALE_MARIADB_PHASE }

function Assert-ExactTemporaryPath { if ($temporaryRoot -ne $expectedTemporaryRoot -or -not $temporaryRoot.StartsWith($worktreeRoot + [System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe PET-TITLE rehearsal path: $temporaryRoot" } }
function Invoke-Checked([scriptblock]$command) { & $command; if ($LASTEXITCODE -ne 0) { throw "PET-TITLE rehearsal child command failed with exit code $LASTEXITCODE" } }
function Start-IsolatedMariaDb {
  $script:serverProcess=Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$rehearsalPort","--bind-address=127.0.0.1","--skip-networking=0","--pid-file=$pidFile","--log-error=$errorLog") -PassThru -WindowStyle Hidden
  for($attempt=0;$attempt -lt 150;$attempt+=1){if($script:serverProcess.HasExited){throw "Isolated MariaDB exited early. See $errorLog"};$listener=Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue|Where-Object{$_.LocalAddress -eq "127.0.0.1"};if($null-ne $listener){$owners=@($listener|Select-Object -ExpandProperty OwningProcess -Unique);if($owners.Count-ne 1-or $owners[0]-ne $script:serverProcess.Id){throw "PET-TITLE listener ownership mismatch."};return $script:serverProcess};Start-Sleep -Milliseconds 200};throw "Timed out waiting for isolated MariaDB."
}
function Stop-OwnedMariaDb([System.Diagnostics.Process]$process){if($null-eq $process){return};if(-not $process.HasExited){$owners=@(Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique);if($owners.Count-gt 0-and($owners.Count-ne 1-or $owners[0]-ne $process.Id)){throw "PET-TITLE listener ownership changed."};Stop-Process -Id $process.Id;$process.WaitForExit(10000)|Out-Null};for($attempt=0;$attempt-lt 50;$attempt+=1){if($null-eq(Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue)){return};Start-Sleep -Milliseconds 200};throw "PET-TITLE listener did not clear."}

try {
  Assert-ExactTemporaryPath
  if(Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue){throw "PET-TITLE port $rehearsalPort is already in use."}
  foreach($binary in @($installDatabase,$serverBinary,$clientBinary)){if(-not(Test-Path -LiteralPath $binary -PathType Leaf)){throw "Required MariaDB binary missing: $binary"}}
  if(Test-Path -LiteralPath $temporaryRoot){throw "PET-TITLE temporary directory already exists: $temporaryRoot"}
  New-Item -ItemType Directory -Path $temporaryRoot|Out-Null
  Invoke-Checked { & $installDatabase "--datadir=$dataDirectory" "--password=$rehearsalPassword" "--port=$rehearsalPort" --allow-remote-root-access --silent }
  $serverProcess=Start-IsolatedMariaDb;$initialPid=$serverProcess.Id
  Invoke-Checked { & $clientBinary --protocol=TCP --host=127.0.0.1 "--port=$rehearsalPort" --user=root "--password=$rehearsalPassword" "--execute=CREATE DATABASE $rehearsalDatabase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" }
  $env:DATABASE_HOST="127.0.0.1";$env:DATABASE_PORT=[string]$rehearsalPort;$env:DATABASE_USER="root";$env:DATABASE_PASSWORD=$rehearsalPassword;$env:DATABASE_NAME=$rehearsalDatabase
  Push-Location $runtimeRoot
  try{$env:PET_TITLE_SALE_MARIADB_PHASE="prepare";Invoke-Checked { & node --import tsx --test test/pet-title-sale-app-wiring-mariadb.integration.test.ts };Stop-OwnedMariaDb $serverProcess;$serverProcess=Start-IsolatedMariaDb;$restartPid=$serverProcess.Id;if($restartPid-eq $initialPid){throw "MariaDB restart did not produce a new PID."};$env:PET_TITLE_SALE_MARIADB_PHASE="restart-rollback";Invoke-Checked { & node --import tsx --test test/pet-title-sale-app-wiring-mariadb.integration.test.ts }}finally{Pop-Location}
  $productionListenerAfter=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique);if(Compare-Object $productionListenerBefore $productionListenerAfter){throw "Production 3306 listener ownership changed."}
  $successMessage="PET_TITLE_SALE_MARIADB_PASS port=$rehearsalPort database=$rehearsalDatabase initialPid=$initialPid restartPid=$restartPid migration471Forward=true reentry=true shadowDomainDmlZero=true readySaleAtomic=true pendingStartSale=true activeOpeningNoReply=true outboxZero=true replayNoDoubleCredit=true restartReplayDmlZero=true outboxFaultRollback=true liveReceiptRollbackPreflight=true rollback=true reforward=true production3306Unchanged=true"
} finally {
  $cleanupErrors=[System.Collections.Generic.List[string]]::new();try{if($null-ne $serverProcess){Stop-OwnedMariaDb $serverProcess}}catch{$cleanupErrors.Add($_.Exception.Message)}
  $remaining=Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue;if($null-ne $remaining){$cleanupErrors.Add("PET-TITLE listener remained after cleanup.")}
  if($null-eq $remaining){try{Assert-ExactTemporaryPath;if(Test-Path -LiteralPath $temporaryRoot){Remove-Item -LiteralPath $temporaryRoot -Recurse -Force}}catch{$cleanupErrors.Add($_.Exception.Message)}}
  foreach($name in $savedEnvironment.Keys){$value=$savedEnvironment[$name];try{if($null-eq $value){Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue}else{Set-Item -LiteralPath "Env:$name" -Value $value}}catch{$cleanupErrors.Add("Failed to restore $name")}}
  if($cleanupErrors.Count-gt 0){throw "PET-TITLE cleanup failed: $($cleanupErrors -join ' | ')"}
}

Write-Output $successMessage
