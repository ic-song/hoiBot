$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot '../..'))
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $worktreeRoot '.tmp/wbs790-consumer-gate7-lease2622'))
$evidenceRoot = Join-Path $runtimeRoot '../migration-control/evidence/wbs790-consumer-gate7-lease2622'
$mariaBin = 'C:/Program Files/MariaDB 12.2/bin'
$dataDirectory = Join-Path $temporaryRoot 'data'
$port = 3358
$server = $null
$startedPids = @()
$names = @('DATABASE_ENABLED','DATABASE_HOST','DATABASE_PORT','DATABASE_USER','DATABASE_PASSWORD','DATABASE_NAME','HOIBOT_ENVIRONMENT_CODE','IRIS_SHARED_TOKEN','USER_VERIFICATION_PEPPER')
$saved = @{}
foreach($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$protectedBefore = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3306,3347) } | Select-Object LocalPort,OwningProcess | Sort-Object LocalPort,OwningProcess | ConvertTo-Json -Compress)
# 이 실행이 만든 격리 프로세스만 시작하고 실제 listener owner를 확인한다.
function Start-OwnedServer {
  $script:server = Start-Process -FilePath (Join-Path $mariaBin 'mariadbd.exe') -ArgumentList @('--no-defaults',"--datadir=$dataDirectory","--port=$port",'--bind-address=127.0.0.1','--skip-networking=0',"--pid-file=$temporaryRoot/mariadbd.pid","--log-error=$temporaryRoot/mariadbd.err") -PassThru -WindowStyle Hidden
  $script:startedPids += $script:server.Id
  for($attempt=0;$attempt -lt 120;$attempt++) {
    if($script:server.HasExited) { throw 'Owned MariaDB exited' }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if($listener) { if($listener.OwningProcess -ne $script:server.Id) { throw 'Listener owner mismatch' }; return }
    Start-Sleep -Milliseconds 250
  }
  throw 'Owned MariaDB startup timeout'
}
# 이 실행에서 보유한 PID만 종료하고 종료 완료를 기다린다.
function Stop-OwnedServer {
  if($null -ne $script:server -and -not $script:server.HasExited) {
    Stop-Process -Id $script:server.Id
    if(-not $script:server.WaitForExit(10000)) { throw 'Owned MariaDB did not exit' }
  }
}
# 자식 명령 종료 코드를 검사하고 검증 로그를 보존한다.
function Invoke-Checked([scriptblock]$command,[string]$logName) {
  & $command 2>&1 | Tee-Object -FilePath (Join-Path $evidenceRoot $logName)
  if($LASTEXITCODE -ne 0) { throw "Child command failed ($logName): $LASTEXITCODE" }
}
try {
  if(-not $temporaryRoot.StartsWith($worktreeRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temporary root' }
  if(Test-Path -LiteralPath $temporaryRoot) { throw 'Temporary root already exists; preserve evidence' }
  if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw 'Isolated port occupied' }
  New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
  New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
  & (Join-Path $mariaBin 'mariadb-install-db.exe') "--datadir=$dataDirectory" '--password=lease2622-isolated-only' "--port=$port" --silent
  if($LASTEXITCODE -ne 0) { throw 'Install DB failed' }
  Start-OwnedServer
  & (Join-Path $mariaBin 'mariadb.exe') --protocol=TCP --host=127.0.0.1 "--port=$port" --user=root --password=lease2622-isolated-only '--execute=CREATE DATABASE hoibot_wave24_item_stack_quantity_2622 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  if($LASTEXITCODE -ne 0) { throw 'Create isolated DB failed' }
  $env:DATABASE_ENABLED='true'; $env:DATABASE_HOST='127.0.0.1'; $env:DATABASE_PORT=[string]$port
  $env:DATABASE_USER='root'; $env:DATABASE_PASSWORD='lease2622-isolated-only'; $env:DATABASE_NAME='hoibot_wave24_item_stack_quantity_2622'
  $env:HOIBOT_ENVIRONMENT_CODE='dev'; $env:IRIS_SHARED_TOKEN='lease2622-isolated-no-network'; $env:USER_VERIFICATION_PEPPER='lease2622-isolated-no-network-pepper'
  Push-Location $runtimeRoot
  try {
    Invoke-Checked { & node --import tsx scripts/migrate.ts } 'migration-first.txt'
    Invoke-Checked { & node --import tsx scripts/migrate.ts } 'migration-replay.txt'
    Invoke-Checked { & node --import tsx scripts/verify-wbs790-provider-consumer.ts before } 'mutation.txt'
    Stop-OwnedServer
    Start-OwnedServer
    Invoke-Checked { & node --import tsx scripts/verify-wbs790-provider-consumer.ts after } 'restart-shadow.txt'
  } finally { Pop-Location }
} finally {
  Stop-OwnedServer
  $remaining = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  $protectedAfter = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3306,3347) } | Select-Object LocalPort,OwningProcess | Sort-Object LocalPort,OwningProcess | ConvertTo-Json -Compress)
  if(Test-Path -LiteralPath $evidenceRoot) {
    @{port=$port;startedPids=$startedPids;listenerRemoved=($remaining.Count -eq 0);protectedListenersUnchanged=([string]$protectedBefore -eq [string]$protectedAfter);temporaryDataRetained=$temporaryRoot} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $evidenceRoot 'lifecycle.json')
  }
  foreach($name in $names) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') }
  if($remaining.Count -ne 0) { throw 'Owned listener remains' }
  if([string]$protectedBefore -ne [string]$protectedAfter) { throw 'Protected listener changed' }
}
