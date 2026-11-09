# Starts the tasktui server in the background if needed, then opens the app window.
#   powershell -ExecutionPolicy Bypass -File scripts\tasktui.ps1          start + open
#   powershell -ExecutionPolicy Bypass -File scripts\tasktui.ps1 -NoOpen  start only
#   powershell -ExecutionPolicy Bypass -File scripts\tasktui.ps1 -Stop    stop the server
param([switch]$NoOpen, [switch]$Stop)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:TASKTUI_PORT) { $env:TASKTUI_PORT } else { 8765 }
$Url = "http://localhost:$Port"

function Test-Server {
  try { return (Invoke-RestMethod "$Url/api/ping" -TimeoutSec 1).app -eq 'tasktui' } catch { return $false }
}

if ($Stop) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Write-Host "tasktui stopped." } else { Write-Host "tasktui is not running." }
  exit 0
}

if (-not (Test-Server)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { throw "Node.js was not found in PATH." }
  $server = Join-Path $Root 'dist\server.js'
  if (-not (Test-Path $server)) { throw "$server not found. Run 'npm ci' and 'npm run build' in $Root." }
  $log = Join-Path $env:TEMP 'tasktui.log'
  Start-Process -FilePath $node -ArgumentList "`"$server`"" -WorkingDirectory $Root -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  for ($i = 0; $i -lt 40 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Server)) { throw "tasktui did not start. See $log.err" }
}

if (-not $NoOpen) {
  # Edge "app mode": its own window and taskbar icon, no tabs or address bar.
  $edge = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge "--app=$Url" } else { Start-Process $Url }
}
