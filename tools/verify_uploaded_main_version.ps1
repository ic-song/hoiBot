param(
    [Parameter(Mandatory = $true)][string]$SourceFile,
    [Parameter(Mandatory = $true)][string]$RemoteVersionOutput
)

$ErrorActionPreference = 'Stop'

# Compare only the declared version; source references and comments are not transport errors.
try {
    $taskUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    $taskSourceText = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $SourceFile).Path, $taskUtf8)
    $taskRemoteText = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $RemoteVersionOutput).Path, $taskUtf8)
    $taskPattern = '(?m)^(?:\d+:)?[ \t]*const[ \t]+HoiBotVersion[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*;[^\r\n]*\r?$'
    $taskLocalDeclarations = [regex]::Matches($taskSourceText, $taskPattern)
    $taskRemoteDeclarations = [regex]::Matches($taskRemoteText, $taskPattern)
    if ($taskLocalDeclarations.Count -ne 1) { throw 'Expected exactly one local HoiBotVersion declaration.' }
    if ($taskRemoteDeclarations.Count -ne 1) { throw 'Expected exactly one uploaded HoiBotVersion declaration.' }
    $taskOtherOutput = [regex]::Replace($taskRemoteText, $taskPattern, '').Trim()
    if ($taskOtherOutput.Length -gt 0) { throw 'Unexpected output while reading the uploaded version.' }
    $taskExpectedVersion = $taskLocalDeclarations[0].Groups[1].Value
    $taskUploadedVersion = $taskRemoteDeclarations[0].Groups[1].Value
    if ($taskExpectedVersion -cne $taskUploadedVersion) {
        throw ('Version mismatch: local={0}, uploaded={1}' -f $taskExpectedVersion, $taskUploadedVersion)
    }
    Write-Output ('[OK] Uploaded version matches local source: ver_{0}' -f $taskUploadedVersion)
    exit 0
} catch {
    Write-Output ('[FAIL] Uploaded version verification: {0}' -f $_.Exception.Message)
    exit 1
}
