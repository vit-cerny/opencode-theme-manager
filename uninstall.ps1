# OpenCode Theme Manager - uninstall.
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
# Removes the app folder and the Desktop shortcut. It NEVER deletes your themes,
# your cli.json, or your Windows Terminal settings - it prints how to undo those instead.

[CmdletBinding()]
param(
  [string]$TargetDir = (Join-Path $env:LOCALAPPDATA 'Programs\opencode-theme-manager'),
  [switch]$KeepShortcut,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Write-Host "opencode theme manager uninstall" -ForegroundColor Cyan

if (-not $Yes) {
  $answer = Read-Host "Remove $TargetDir ? (y/N)"
  if ($answer -notmatch '^[Yy]') { Write-Host "cancelled."; return }
}

if (Test-Path $TargetDir) {
  Remove-Item -Recurse -Force $TargetDir
  Write-Host "  removed $TargetDir"
} else {
  Write-Host "  $TargetDir not found (nothing to remove)"
}

if (-not $KeepShortcut) {
  $links = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenCode Theme Manager.lnk'),
    (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\OpenCode Theme Manager.lnk')
  )
  foreach ($link in $links) {
    if (Test-Path $link) {
      Remove-Item -Force $link
      Write-Host "  removed $link"
    }
  }
}

$config = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.config\opencode' }
Write-Host ""
Write-Host "left untouched (remove these yourself if you want the stock look):" -ForegroundColor Yellow
Write-Host "  themes:        $config\themes\*.json"
Write-Host "  theme choice:  $config\cli.json  ->  theme.name"
Write-Host ""
Write-Host "revert an applied theme by restoring a backup, e.g.:"
Write-Host "  Get-ChildItem `"$config\cli.json.bak.*`" | Sort-Object LastWriteTime | Select-Object -Last 1"
Write-Host "  Copy-Item <that file> `"$config\cli.json`" -Force"
Write-Host ""
Write-Host "or point opencode back at a stock theme: set theme.name to `"opencode`" or `"system`"."
