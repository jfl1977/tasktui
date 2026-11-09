# One-time setup on Windows, for the current user only (no admin rights needed):
#   - Start menu shortcut "tasktui" with a hotkey (default Ctrl+Alt+T)
#   - Reminder toasts on weekdays at 08:30 and 15:30 (Task Scheduler)
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Hotkey "CTRL+ALT+Y" -Times "08:00","13:00","16:30"
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Uninstall
param(
  [string]$Hotkey = 'CTRL+ALT+T',
  [string[]]$Times = @('08:30', '15:30'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Programs = [Environment]::GetFolderPath('Programs')
$Link = Join-Path $Programs 'tasktui.lnk'
$TaskName = 'tasktui reminder'

if ($Uninstall) {
  if (Test-Path $Link) { Remove-Item $Link }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  & (Join-Path $PSScriptRoot 'tasktui.ps1') -Stop
  Write-Host 'Removed the shortcut and the reminders. Your data folder was not touched.'
  exit 0
}

# Node check
$nodeVersion = (& node --version) -replace '^v', ''
if ([version]$nodeVersion -lt [version]'20.19.0') { throw "Node $nodeVersion is too old: tasktui needs 20.19 or newer." }
if (-not (Test-Path (Join-Path $Root 'dist\server.js'))) { throw "dist\server.js is missing. Run 'npm ci' then 'npm run build'." }

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Shortcut with hotkey (hotkeys only work for shortcuts in the Start menu or on the desktop).
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($Link)
$lnk.TargetPath = $ps
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\scripts\tasktui.ps1`""
$lnk.WorkingDirectory = $Root
$lnk.WindowStyle = 7 # minimized
$lnk.Hotkey = $Hotkey
$edgeIcon = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (Test-Path $edgeIcon) { $lnk.IconLocation = "$edgeIcon,0" }
$lnk.Description = 'tasktui: keyboard-first todo list'
$lnk.Save()
Write-Host "Shortcut created: $Link (hotkey $Hotkey)"

# Reminders. "conhost --headless" avoids a console window flashing on screen.
$taskArgs = "--headless `"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$Root\scripts\reminder.ps1`""
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $taskArgs -WorkingDirectory $Root
$days = 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'
$triggers = $Times | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At ([datetime]::ParseExact($_, 'HH:mm', $null)) }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
  -Description 'Shows a tasktui reminder toast' -Force | Out-Null
Write-Host "Reminders scheduled on weekdays at $($Times -join ', ')."

Write-Host ''
Write-Host 'Try it now:'
Write-Host "  - press $Hotkey (or start 'tasktui' from the Start menu)"
Write-Host "  - test the reminder: Start-ScheduledTask -TaskName '$TaskName'"
