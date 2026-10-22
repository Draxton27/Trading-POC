param([Parameter(Mandatory=$true)][ValidateSet('install','uninstall','status')][string]$Action)
$ErrorActionPreference = 'Stop'
$taskName = 'Trading-POC Daily Research'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($Action -eq 'status') { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Select-Object TaskName, State; exit 0 }
if ($Action -eq 'uninstall') { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue; exit 0 }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$script = Join-Path $repo 'scripts\daily-orchestrator.ts'
$scheduledAction = New-ScheduledTaskAction -Execute $node -Argument ('--experimental-strip-types "{0}" --once' -f $script) -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At '06:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 18) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $scheduledAction -Trigger $trigger -Settings $settings -Description 'Trading-POC: investigación diaria local de solo lectura' -Force | Out-Null
Write-Output 'Tarea instalada. Consulte su estado con .\scripts\windows\daily-task.ps1 status.'
