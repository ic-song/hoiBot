param(
    [string]$EnvFile = (Join-Path $PSScriptRoot ".env.package-db"),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot ".package-db-backups"),
    [string]$AdminUser = "",
    [string]$AdminPassword = "",
    [switch]$RestoreDrill,
    [switch]$AllowDefaultPort
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-EnvFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Environment file not found: $Path"
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
            continue
        }

        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) {
            continue
        }

        $key = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }

    return $values
}

function Require-Value {
    param(
        [hashtable]$Values,
        [string]$Name
    )

    if (-not $Values.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace($Values[$Name])) {
        throw "Required environment value is missing: $Name"
    }
    return [string]$Values[$Name]
}

function Resolve-MariaBinary {
    param([string]$Name)

    $bundled = Join-Path ${env:ProgramFiles} "MariaDB 12.2\bin\$Name.exe"
    if (Test-Path -LiteralPath $bundled) {
        return $bundled
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "MariaDB binary not found: $Name"
    }
    return $command.Source
}

function Invoke-MariaScalar {
    param(
        [string]$Client,
        [string[]]$ConnectionArguments,
        [string]$Database,
        [string]$Sql
    )

    $result = & $Client @ConnectionArguments "--database=$Database" --batch --skip-column-names "--execute=$Sql"
    if ($LASTEXITCODE -ne 0) {
        throw "MariaDB query failed for database: $Database"
    }
    return (($result | ForEach-Object { [string]$_ }) -join "`n").Trim()
}

$settings = Read-EnvFile -Path $EnvFile
$hostName = Require-Value -Values $settings -Name "DATABASE_HOST"
$port = Require-Value -Values $settings -Name "DATABASE_PORT"
$database = Require-Value -Values $settings -Name "DATABASE_NAME"
$user = Require-Value -Values $settings -Name "DATABASE_USER"
$password = Require-Value -Values $settings -Name "DATABASE_PASSWORD"
if ([string]::IsNullOrWhiteSpace($AdminUser) -and $settings.ContainsKey("DATABASE_ADMIN_USER")) {
    $AdminUser = [string]$settings["DATABASE_ADMIN_USER"]
}
if ([string]::IsNullOrEmpty($AdminPassword) -and $settings.ContainsKey("DATABASE_ADMIN_PASSWORD")) {
    $AdminPassword = [string]$settings["DATABASE_ADMIN_PASSWORD"]
}

if ($port -eq "3306" -and -not $AllowDefaultPort) {
    throw "Port 3306 is blocked. Use an isolated database or explicitly pass -AllowDefaultPort after approval."
}
if ($database -notmatch '^[A-Za-z0-9_]+$') {
    throw "Unsafe database name: $database"
}

$dump = Resolve-MariaBinary -Name "mariadb-dump"
$client = Resolve-MariaBinary -Name "mariadb"
$connectionArguments = @("--host=$hostName", "--port=$port", "--user=$user")
$adminConnectionArguments = if ([string]::IsNullOrWhiteSpace($AdminUser)) { @() } else { @("--host=$hostName", "--port=$port", "--user=$AdminUser") }
$oldPassword = $env:MYSQL_PWD
$restoreDatabase = $null
$restoreCreated = $false

try {
    $env:MYSQL_PWD = $password
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = Join-Path $OutputDirectory ("package-hub-{0}.sql" -f $stamp)
    & $dump @connectionArguments --single-transaction --routines --triggers --hex-blob --skip-comments "--result-file=$backupPath" $database
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath)) {
        throw "MariaDB snapshot failed."
    }

    $tableCountSql = "SELECT CONCAT((SELECT COUNT(*) FROM package_catalog),'|',(SELECT COUNT(*) FROM package_command_aliases),'|',(SELECT COUNT(*) FROM package_reward_rules),'|',(SELECT COUNT(*) FROM item_definitions));"
    $sourceCounts = Invoke-MariaScalar -Client $client -ConnectionArguments $connectionArguments -Database $database -Sql $tableCountSql

    $result = [ordered]@{
        host = $hostName
        port = [int]$port
        sourceDatabase = $database
        backupPath = $backupPath
        sourceCounts = $sourceCounts
        restoreDrill = [bool]$RestoreDrill
        restoreParity = $null
    }

    if ($RestoreDrill) {
        if ([string]::IsNullOrWhiteSpace($AdminUser)) {
            throw "Restore drill requires DATABASE_ADMIN_USER or -AdminUser with CREATE/DROP DATABASE permission."
        }
        $restoreDatabase = "{0}_restore_drill_{1}" -f $database, $stamp
        if ($restoreDatabase -notmatch ('^' + [regex]::Escape($database) + '_restore_drill_[0-9]{8}-[0-9]{6}$')) {
            throw "Unsafe restore database name: $restoreDatabase"
        }

        $env:MYSQL_PWD = $AdminPassword
        & $client @adminConnectionArguments "--execute=CREATE DATABASE ``$restoreDatabase`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        if ($LASTEXITCODE -ne 0) {
            throw "Restore drill database creation failed."
        }
        $restoreCreated = $true

        $sourcePath = $backupPath.Replace("\", "/")
        & $client @adminConnectionArguments "--database=$restoreDatabase" "--execute=source $sourcePath"
        if ($LASTEXITCODE -ne 0) {
            throw "Restore drill import failed."
        }

        $restoreCounts = Invoke-MariaScalar -Client $client -ConnectionArguments $adminConnectionArguments -Database $restoreDatabase -Sql $tableCountSql
        $result.restoreDatabase = $restoreDatabase
        $result.restoreCounts = $restoreCounts
        $result.restoreParity = ($sourceCounts -eq $restoreCounts)
        if (-not $result.restoreParity) {
            throw "Restore drill count parity failed: source=$sourceCounts restore=$restoreCounts"
        }
    }

    $result | ConvertTo-Json -Depth 3
}
finally {
    if ($restoreCreated -and $null -ne $restoreDatabase -and
        $restoreDatabase -match ('^' + [regex]::Escape($database) + '_restore_drill_[0-9]{8}-[0-9]{6}$')) {
        $env:MYSQL_PWD = $AdminPassword
        & $client @adminConnectionArguments "--execute=DROP DATABASE ``$restoreDatabase``" | Out-Null
    }
    $env:MYSQL_PWD = $oldPassword
}
