param(
    [string]$ComposeFile = (Join-Path $PSScriptRoot "..\compose.yaml"),
    [string]$RuntimeDirectory = (Join-Path $PSScriptRoot "..\..\runtime")
)

$ErrorActionPreference = "Stop"
$resolvedCompose = (Resolve-Path -LiteralPath $ComposeFile).Path
$resolvedRuntime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$databaseName = "hoibot_import_verify_" + [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")

function ConvertTo-ShellWrapper([string]$Command) {
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Command))
    return 'echo${IFS}' + $encoded + '|base64${IFS}-d|sh'
}

$createArgs = @("compose", "-f", $resolvedCompose, "exec", "-T", "-e", "VERIFY_DATABASE=$databaseName", "mariadb", "sh", "-lc", (ConvertTo-ShellWrapper 'exec mariadb -u root -p"$MARIADB_ROOT_PASSWORD" -e "CREATE DATABASE $VERIFY_DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON $VERIFY_DATABASE.* TO ''$MARIADB_USER''@''%''"'))
try {
    & docker @createArgs
    if ($LASTEXITCODE -ne 0) { throw "Disposable import database creation failed." }
    $env:DATABASE_NAME = $databaseName
    Push-Location $resolvedRuntime
    try {
        & npm.cmd run db:migrate
        if ($LASTEXITCODE -ne 0) { throw "Disposable migrations failed." }
        & npm.cmd run db:import:dry-run -- --source ..\..\data --apply
        if ($LASTEXITCODE -ne 0) { throw "Disposable legacy import failed." }
        $repeat = & npm.cmd run db:import:dry-run -- --source ..\..\data --apply
        if ($LASTEXITCODE -ne 0 -or ($repeat -join "`n") -notmatch '"alreadyApplied":true') { throw "Legacy import idempotency verification failed." }
        & node --env-file-if-exists=.env --import tsx scripts/verify-legacy-import.ts
        if ($LASTEXITCODE -ne 0) { throw "Legacy import reconciliation failed." }
        & npm.cmd run db:probe:domains
        if ($LASTEXITCODE -ne 0) { throw "Domain service integration probe failed." }
    } finally {
        Pop-Location
    }
} finally {
    $dropArgs = @("compose", "-f", $resolvedCompose, "exec", "-T", "-e", "VERIFY_DATABASE=$databaseName", "mariadb", "sh", "-lc", (ConvertTo-ShellWrapper 'exec mariadb -u root -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS $VERIFY_DATABASE"'))
    & docker @dropArgs | Out-Null
    Remove-Item Env:DATABASE_NAME -ErrorAction SilentlyContinue
}
