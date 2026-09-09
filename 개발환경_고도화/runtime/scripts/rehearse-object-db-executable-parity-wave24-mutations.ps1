$ErrorActionPreference='Stop'
$runtimeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$worktreeRoot=[IO.Path]::GetFullPath((Join-Path $runtimeRoot '../..'))
$temporaryRoot=[IO.Path]::GetFullPath((Join-Path $worktreeRoot '.tmp/wave24-mutations-mariadb-run9'))
$evidenceRoot=[IO.Path]::GetFullPath((Join-Path $runtimeRoot '../migration-control/evidence/object-db-executable-parity-ledger-wave24-wbs791-lease2623'))
$dataDirectory=Join-Path $temporaryRoot 'data'
$mariaBin='C:/Program Files/MariaDB 12.2/bin'
$port=3359
$password='wave24-isolated-root-only'
$databaseName='hoibot_wave24_item_stack_quantity_2623'
$server=$null
$startedPids=@()
$names=@('DATABASE_ENABLED','DATABASE_HOST','DATABASE_PORT','DATABASE_USER','DATABASE_PASSWORD','DATABASE_NAME','HOIBOT_ENVIRONMENT_CODE','IRIS_SHARED_TOKEN','USER_VERIFICATION_PEPPER')
$saved=@{};foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
$protectedBefore=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)
function Assert-SafeRoot{if(-not$temporaryRoot.StartsWith($worktreeRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe Wave24 temporary path'}}
function Invoke-Checked([scriptblock]$command,[string]$logName){$priorPreference=$ErrorActionPreference;$ErrorActionPreference='Continue';&$command 2>&1|Tee-Object -FilePath (Join-Path $evidenceRoot $logName);$exitCode=$LASTEXITCODE;$ErrorActionPreference=$priorPreference;if($exitCode-ne 0){throw "Wave24 child command failed ($logName): $exitCode"}}
function Start-OwnedServer{
  $script:server=Start-Process -FilePath (Join-Path $mariaBin 'mariadbd.exe') -ArgumentList @('--no-defaults',"--datadir=$dataDirectory","--port=$port",'--bind-address=127.0.0.1','--skip-networking=0',"--pid-file=$temporaryRoot/mariadbd.pid","--log-error=$temporaryRoot/mariadbd.err") -PassThru -WindowStyle Hidden
  $script:startedPids+=$script:server.Id
  for($attempt=0;$attempt-lt 120;$attempt++){if($script:server.HasExited){throw 'Wave24 MariaDB exited'};$listener=Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue;if($listener){if($listener.OwningProcess-ne$script:server.Id){throw 'Wave24 listener owner mismatch'};return};Start-Sleep -Milliseconds 250};throw 'Wave24 MariaDB startup timeout'
}
function Stop-OwnedServer{if($null-ne$script:server-and-not$script:server.HasExited){Stop-Process -Id $script:server.Id;if(-not$script:server.WaitForExit(10000)){throw 'Wave24 MariaDB did not exit'}}}
try{
  Assert-SafeRoot;if(Test-Path -LiteralPath $temporaryRoot){throw 'Wave24 temporary root exists'};if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw 'Wave24 port occupied'}
  New-Item -ItemType Directory -Path $temporaryRoot|Out-Null;New-Item -ItemType Directory -Path $evidenceRoot -Force|Out-Null
  &(Join-Path $mariaBin 'mariadb-install-db.exe') "--datadir=$dataDirectory" "--password=$password" "--port=$port" --silent;if($LASTEXITCODE-ne 0){throw 'Wave24 install DB failed'}
  Start-OwnedServer
  &(Join-Path $mariaBin 'mariadb.exe') --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root "--password=$password" "--execute=CREATE DATABASE $databaseName CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci";if($LASTEXITCODE-ne 0){throw 'Wave24 create DB failed'}
  $env:DATABASE_ENABLED='true';$env:DATABASE_HOST='127.0.0.1';$env:DATABASE_PORT=[string]$port;$env:DATABASE_USER='root';$env:DATABASE_PASSWORD=$password;$env:DATABASE_NAME=$databaseName;$env:HOIBOT_ENVIRONMENT_CODE='dev';$env:IRIS_SHARED_TOKEN='wave24-isolated-no-network';$env:USER_VERIFICATION_PEPPER='wave24-isolated-no-network-pepper'
  Push-Location $runtimeRoot
  try{
    Invoke-Checked {&node --import tsx scripts/migrate.ts} 'migration-first.txt'
    Invoke-Checked {&node --import tsx scripts/migrate.ts} 'migration-replay.txt'
    Invoke-Checked {&node --import tsx scripts/build-object-db-consumer-executable-parity-wave24-fixture.ts} 'fixture-build.txt'
    Invoke-Checked {&node --import tsx scripts/seal-object-db-consumer-executable-parity-wave24-mutations.ts} 'fixture-seal.txt'
  }finally{Pop-Location}
}finally{
  Stop-OwnedServer
  $remaining=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  $protectedAfter=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)
  if(Test-Path -LiteralPath $evidenceRoot){@{port=$port;startedPids=$startedPids;listenerRemoved=($remaining.Count-eq 0);production3306Unchanged=([string]$protectedBefore-eq[string]$protectedAfter);temporaryDataRetained=$temporaryRoot}|ConvertTo-Json|Set-Content -Encoding utf8 (Join-Path $evidenceRoot 'lifecycle.json')}
  foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
  if($remaining.Count-ne 0){throw 'Wave24 listener remained'};if([string]$protectedBefore-ne[string]$protectedAfter){throw 'Production 3306 listener changed'}
}
