# OpenCode Theme Manager - one-file install (no npm, no dependencies).
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -TargetDir "$env:LOCALAPPDATA\Programs\opencode-theme-manager"
# Copies the app, writes a launcher, and adds a Desktop shortcut. Touches nothing in your opencode config.

[CmdletBinding()]
param(
  [string]$TargetDir = (Join-Path $env:LOCALAPPDATA 'Programs\opencode-theme-manager'),
  [switch]$NoShortcut,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot

Write-Host "opencode theme manager installer" -ForegroundColor Cyan
Write-Host "  from: $source"
Write-Host "  to:   $TargetDir"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js 18+ not found on PATH. Install it from https://nodejs.org, then re-run." }

if ((Test-Path $TargetDir) -and -not $Force) {
  $existing = Get-ChildItem $TargetDir -ErrorAction SilentlyContinue
  if ($existing) { throw "$TargetDir already exists. Re-run with -Force to overwrite (your themes and cli.json are never touched)." }
}

$paths = @('server.mjs', 'start.cmd', 'README.md', 'LICENSE', 'package.json', 'lib', 'ui', 'presets', 'examples', 'tools')
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
foreach ($item in $paths) {
  $from = Join-Path $source $item
  if (Test-Path $from) {
    Copy-Item $from -Destination $TargetDir -Recurse -Force
    Write-Host "  copied $item"
  }
}

# A launcher that never depends on the current working directory.
$launcher = @(
  '@echo off',
  'cd /d "%~dp0"',
  'node server.mjs %*'
) -join "`r`n"
Set-Content -Path (Join-Path $TargetDir 'launch.cmd') -Value $launcher -Encoding ASCII

if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $link = Join-Path $desktop 'OpenCode Theme Manager.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = (Join-Path $TargetDir 'launch.cmd')
  $shortcut.WorkingDirectory = $TargetDir
  $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,68"
  $shortcut.Description = 'OpenCode Theme Manager'
  $shortcut.Save()
  Write-Host "  shortcut: $link"
}

Write-Host ""
Write-Host "installed. start it with:" -ForegroundColor Green
Write-Host "  `"$TargetDir\launch.cmd`"          # opens http://127.0.0.1:4289/"
Write-Host "or just double-click the Desktop shortcut."
Write-Host ""
Write-Host "uninstall with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$TargetDir\..\opencode-theme-manager\uninstall.ps1`""
Write-Host "  (or keep a copy of uninstall.ps1 next to launch.cmd)"
Copy-Item (Join-Path $source 'uninstall.ps1') -Destination $TargetDir -Force
