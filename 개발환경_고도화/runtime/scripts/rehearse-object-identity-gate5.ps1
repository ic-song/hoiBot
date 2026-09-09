$ErrorActionPreference="Stop"
$runtimeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."));$worktreeRoot=[IO.Path]::GetFullPath((Join-Path $runtimeRoot "..\.."))
$temporaryRoot=[IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs731-identity-gate5"));$expectedRoot=[IO.Path]::GetFullPath((Join-Path $worktreeRoot ".tmp\wbs731-identity-gate5"))
$dataDirectory=Join-Path $temporaryRoot "data";$pidFile=Join-Path $temporaryRoot "mariadbd.pid";$errorLog=Join-Path $temporaryRoot "mariadbd.err"
$mariaBin="C:\Program Files\MariaDB 12.2\bin";$installDatabase=Join-Path $mariaBin "mariadb-install-db.exe";$serverBinary=Join-Path $mariaBin "mariadbd.exe";$clientBinary=Join-Path $mariaBin "mariadb.exe"
$rehearsalPort=3324;$rehearsalDatabase="hoibot_rehearsal_wbs731_identity";$rehearsalPassword="wbs731-identity-only";$serverProcess=$null;$initialPid=$null;$restartPid=$null;$success=$null
$productionBefore=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique)
$names=@("DATABASE_HOST","DATABASE_PORT","DATABASE_USER","DATABASE_PASSWORD","DATABASE_NAME","WBS731_IDENTITY_MARIADB_TEST","WBS731_IDENTITY_MARIADB_PHASE");$saved=@{};foreach($name in $names){$saved[$name]=[Environment]::GetEnvironmentVariable($name,"Process")}
function Assert-SafeRoot { if($temporaryRoot -ne $expectedRoot -or -not $temporaryRoot.StartsWith($worktreeRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe WBS731 temporary path: $temporaryRoot"} }
function Start-Isolated {
  $script:serverProcess=Start-Process -FilePath $serverBinary -ArgumentList @("--no-defaults","--datadir=$dataDirectory","--port=$rehearsalPort","--bind-address=127.0.0.1","--skip-networking=0","--pid-file=$pidFile","--log-error=$errorLog") -PassThru -WindowStyle Hidden
  for($attempt=0;$attempt -lt 150;$attempt+=1){if($script:serverProcess.HasExited){throw "WBS731 MariaDB exited early: $errorLog"};$listener=Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue;if($null-ne $listener){$owners=@($listener|Select-Object -ExpandProperty OwningProcess -Unique);if($owners.Count-ne 1-or $owners[0]-ne $script:serverProcess.Id){throw "WBS731 listener ownership mismatch"};return};Start-Sleep -Milliseconds 200};throw "WBS731 MariaDB startup timeout"
}
function Stop-Isolated { if($null-eq $script:serverProcess){return};if(-not $script:serverProcess.HasExited){Stop-Process -Id $script:serverProcess.Id;$script:serverProcess.WaitForExit(10000)|Out-Null};for($attempt=0;$attempt-lt 50;$attempt+=1){if($null-eq(Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue)){return};Start-Sleep -Milliseconds 200};throw "WBS731 listener did not clear" }
function Invoke-Checked([scriptblock]$command){&$command;if($LASTEXITCODE-ne 0){throw "WBS731 child command failed: $LASTEXITCODE"}}
try{
  Assert-SafeRoot;if(Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue){throw "WBS731 port $rehearsalPort already in use"};foreach($binary in @($installDatabase,$serverBinary,$clientBinary)){if(-not(Test-Path -LiteralPath $binary -PathType Leaf)){throw "Missing MariaDB binary: $binary"}}
  if(Test-Path -LiteralPath $temporaryRoot){throw "WBS731 temporary directory already exists: $temporaryRoot"};New-Item -ItemType Directory -Path $temporaryRoot|Out-Null
  Invoke-Checked {&$installDatabase "--datadir=$dataDirectory" "--password=$rehearsalPassword" "--port=$rehearsalPort" --allow-remote-root-access --silent};Start-Isolated;$initialPid=$serverProcess.Id
  Invoke-Checked {&$clientBinary --protocol=TCP --host=127.0.0.1 "--port=$rehearsalPort" --user=root "--password=$rehearsalPassword" "--execute=CREATE DATABASE $rehearsalDatabase CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"}
  $migrationPath=(Join-Path $runtimeRoot "migrations\443_object_identity_audit_provider.sql").Replace("\","/")
  Invoke-Checked {&$clientBinary --protocol=TCP --host=127.0.0.1 "--port=$rehearsalPort" --user=root "--password=$rehearsalPassword" "--database=$rehearsalDatabase" "--execute=SOURCE $migrationPath"}
  $env:DATABASE_HOST="127.0.0.1";$env:DATABASE_PORT=[string]$rehearsalPort;$env:DATABASE_USER="root";$env:DATABASE_PASSWORD=$rehearsalPassword;$env:DATABASE_NAME=$rehearsalDatabase;$env:WBS731_IDENTITY_MARIADB_TEST="true"
  Push-Location $runtimeRoot;try{$env:WBS731_IDENTITY_MARIADB_PHASE="prepare";Invoke-Checked {&node --import tsx --test test/object-identity-audit-provider-mariadb.integration.test.ts};Stop-Isolated;Start-Isolated;$restartPid=$serverProcess.Id;if($restartPid-eq $initialPid){throw "WBS731 restart PID unchanged"};$env:WBS731_IDENTITY_MARIADB_PHASE="restart";Invoke-Checked {&node --import tsx --test test/object-identity-audit-provider-mariadb.integration.test.ts}}finally{Pop-Location}
  $productionAfter=@(Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue|Select-Object -ExpandProperty OwningProcess -Unique);if(Compare-Object $productionBefore $productionAfter){throw "Production 3306 listener changed"}
  $success="WBS731_GATE5_MARIADB_PASS port=3324 collision=true concurrentReplay=true kst=true unicode=true restart=true production3306Unchanged=true"
}finally{
  $errors=[Collections.Generic.List[string]]::new();try{Stop-Isolated}catch{$errors.Add($_.Exception.Message)};$remaining=Get-NetTCPConnection -State Listen -LocalPort $rehearsalPort -ErrorAction SilentlyContinue
  if($null-ne $remaining){$errors.Add("WBS731 listener remained")};if($null-eq $remaining){try{Assert-SafeRoot;if(Test-Path -LiteralPath $temporaryRoot){Remove-Item -LiteralPath $temporaryRoot -Recurse -Force}}catch{$errors.Add($_.Exception.Message)}}
  foreach($name in $names){if($null-eq $saved[$name]){Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue}else{Set-Item -LiteralPath "Env:$name" -Value $saved[$name]}}
  if($errors.Count-gt 0){throw "WBS731 cleanup failed: $($errors -join ' | ')"}
}
Write-Output $success
