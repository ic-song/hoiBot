param(
    [ValidateSet("Install", "Uninstall", "Start", "Stop", "Status")]
    [string]$Action = "Status"
)

$ErrorActionPreference = "Stop"

$taskName = "hoiBot Modernization Server"
$runtimeDirectory = Split-Path -Parent $PSScriptRoot
$serverEntryPoint = Join-Path $runtimeDirectory "dist\src\server.js"
$environmentFile = Join-Path $runtimeDirectory ".env"

function Get-HoiBotTask {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Format-ScheduledDate {
    param([object]$Value)

    if ($null -eq $Value) {
        return "none"
    }

    $dateValue = [datetime]$Value
    if ($dateValue.Year -le 2000) {
        return "never"
    }

    return $dateValue.ToString("o")
}

function Write-HoiBotTaskStatus {
    $task = Get-HoiBotTask
    if ($null -eq $task) {
        Write-Output "task=not_installed"
        return
    }

    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Output "task=installed"
    Write-Output "state=$($task.State)"
    Write-Output "last_result=$($taskInfo.LastTaskResult)"
    Write-Output "last_run=$(Format-ScheduledDate $taskInfo.LastRunTime)"
    Write-Output "next_run=$(Format-ScheduledDate $taskInfo.NextRunTime)"
}

switch ($Action) {
    "Install" {
        if (-not (Test-Path -LiteralPath $serverEntryPoint)) {
            throw "Build output not found. Run 'npm.cmd run build' first."
        }
        if (-not (Test-Path -LiteralPath $environmentFile)) {
            throw ".env not found. Configure the local environment before installing autostart."
        }

        $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
        $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $taskAction = New-ScheduledTaskAction `
            -Execute $nodeExecutable `
            -Argument "--env-file-if-exists=.env dist/src/server.js" `
            -WorkingDirectory $runtimeDirectory
        $taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
        $taskPrincipal = New-ScheduledTaskPrincipal `
            -UserId $currentUser `
            -LogonType Interactive `
            -RunLevel Limited
        $taskSettings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit ([TimeSpan]::Zero) `
            -MultipleInstances IgnoreNew `
            -RestartCount 999 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -StartWhenAvailable

        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $taskAction `
            -Trigger $taskTrigger `
            -Principal $taskPrincipal `
            -Settings $taskSettings `
            -Description "Runs the hoiBot modernization Node.js server after Windows logon and restarts it after failure." `
            -Force | Out-Null
        Write-HoiBotTaskStatus
    }
    "Uninstall" {
        $task = Get-HoiBotTask
        if ($null -ne $task) {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        }
        Write-HoiBotTaskStatus
    }
    "Start" {
        if ($null -eq (Get-HoiBotTask)) {
            throw "Autostart task is not installed."
        }
        Start-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 2
        Write-HoiBotTaskStatus
    }
    "Stop" {
        if ($null -eq (Get-HoiBotTask)) {
            throw "Autostart task is not installed."
        }
        Stop-ScheduledTask -TaskName $taskName
        Write-HoiBotTaskStatus
    }
    "Status" {
        Write-HoiBotTaskStatus
    }
}
