# Shows a Windows toast with today's counts, e.g.
#   "3 for today - 1 overdue - 2 waiting - 2h30 of time corrections not submitted"
# Run by Task Scheduler (see install-windows.ps1). Needs Windows PowerShell 5.1 (powershell.exe).
$ErrorActionPreference = 'Stop'

$Port = if ($env:TASKTUI_PORT) { $env:TASKTUI_PORT } else { 8765 }
$Url = "http://localhost:$Port"

& (Join-Path $PSScriptRoot 'tasktui.ps1') -NoOpen
$s = Invoke-RestMethod "$Url/api/summary"

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

$text = [System.Security.SecurityElement]::Escape($s.text)
$xml = @"
<toast activationType="protocol" launch="$Url" duration="long">
  <visual>
    <binding template="ToastGeneric">
      <text>Time to check your tasks</text>
      <text>$text</text>
    </binding>
  </visual>
  <actions>
    <action content="Open tasktui" activationType="protocol" arguments="$Url" />
  </actions>
</toast>
"@

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
# Show the toast as Windows PowerShell (an app ID that is always registered).
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
