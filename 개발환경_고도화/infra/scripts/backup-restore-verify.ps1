param(
    [string]$ComposeFile = (Join-Path $PSScriptRoot "..\compose.yaml"),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\backups")
)

$ErrorActionPreference = "Stop"
$resolvedCompose = (Resolve-Path -LiteralPath $ComposeFile).Path
$resolvedInfra = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $outputPath.StartsWith($resolvedInfra + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup output must stay inside the modernization infra directory."
}
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$backupFile = Join-Path $outputPath "hoibot-$stamp.sql"

function ConvertTo-ShellWrapper([string]$Command) {
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Command))
    return 'echo${IFS}' + $encoded + '|base64${IFS}-d|sh'
}

$dumpArgs = @(
    "compose", "-f", $resolvedCompose, "exec", "-T", "mariadb", "sh", "-lc",
    (ConvertTo-ShellWrapper 'exec mariadb-dump --single-transaction --routines --triggers --hex-blob -u root -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"')
)
$dumpOutput = & docker @dumpArgs
if ($LASTEXITCODE -ne 0 -or $dumpOutput.Count -eq 0) {
    throw "MariaDB backup failed."
}
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllLines($backupFile, [string[]]$dumpOutput, $utf8WithoutBom)

$verifyDatabase = "hoibot_restore_verify_" + [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")
$restoreContainerFile = "/tmp/hoibot-restore-$stamp.sql"
$createArgs = @("compose", "-f", $resolvedCompose, "exec", "-T", "-e", "VERIFY_DATABASE=$verifyDatabase", "mariadb", "sh", "-lc", (ConvertTo-ShellWrapper 'exec mariadb -u root -p"$MARIADB_ROOT_PASSWORD" -e "CREATE DATABASE $VERIFY_DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"'))
$env:VERIFY_DATABASE = $verifyDatabase
try {
    & docker @createArgs
    if ($LASTEXITCODE -ne 0) { throw "Disposable restore database creation failed." }

    & docker compose -f $resolvedCompose cp $backupFile "mariadb:$restoreContainerFile"
    if ($LASTEXITCODE -ne 0) { throw "Backup copy into the disposable restore environment failed." }
    $restoreCommand = 'exec mariadb -u root -p"$MARIADB_ROOT_PASSWORD" "$VERIFY_DATABASE" < ' + $restoreContainerFile
    $restoreArgs = @("compose", "-f", $resolvedCompose, "exec", "-T", "-e", "VERIFY_DATABASE=$verifyDatabase", "mariadb", "sh", "-lc", (ConvertTo-ShellWrapper $restoreCommand))
    & docker @restoreArgs
    if ($LASTEXITCODE -ne 0) { throw "Disposable restore failed." }

    $verifyArgs = @("compose", "-f", $resolvedCompose, "exec", "-T", "-e", "VERIFY_DATABASE=$verifyDatabase", "mariadb", "sh", "-lc", (ConvertTo-ShellWrapper 'exec mariadb -N -u root -p"$MARIADB_ROOT_PASSWORD" "$VERIFY_DATABASE" -e "SELECT COUNT(*) FROM schema_migrations"'))
    $migrationCount = (& docker @verifyArgs).Trim()
    if ($LASTEXITCODE -ne 0 -or [int]$migrationCount -lt 12) { throw "Restored migration version verification failed." }
    Write-Output "backup=$backupFile"
    Write-Output "restoreVerified=true migrationCount=$migrationCount"
} finally {
    $dropArgs = @("compose", "-f", $resolvedCompose, "exec", "-T", "-e", "VERIFY_DATABASE=$verifyDatabase", "mariadb", "sh", "-lc", (ConvertTo-ShellWrapper 'exec mariadb -u root -p"$MARIADB_ROOT_PASSWORD" -e "DROP DATABASE IF EXISTS $VERIFY_DATABASE"'))
    & docker @dropArgs | Out-Null
    & docker compose -f $resolvedCompose exec -T mariadb rm -f $restoreContainerFile | Out-Null
    Remove-Item Env:VERIFY_DATABASE -ErrorAction SilentlyContinue
}
