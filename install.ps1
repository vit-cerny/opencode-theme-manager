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

$paths = @('server.mjs', 'start.cmd', 'README.md', 'LICENSE', 'package.json', 'lib', 'ui', 'presets', 'examples', 'tools', 'docs')
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
  $shell = New-Object -ComObject WScript.Shell
  $targets = @(
    @{ Path = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenCode Theme Manager.lnk'); Label = 'Desktop' },
    @{ Path = (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\OpenCode Theme Manager.lnk'); Label = 'Start menu' }
  )
  foreach ($item in $targets) {
    $shortcut = $shell.CreateShortcut($item.Path)
    $shortcut.TargetPath = (Join-Path $TargetDir 'launch.cmd')
    $shortcut.WorkingDirectory = $TargetDir
    $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,68"
    $shortcut.Description = 'OpenCode Theme Manager'
    $shortcut.Save()
    Write-Host "  shortcut ($($item.Label)): $($item.Path)"
  }
}

Copy-Item (Join-Path $source 'uninstall.ps1') -Destination $TargetDir -Force

Write-Host ""
Write-Host "How to use it:" -ForegroundColor Green
Write-Host "  1. start it:  `"$TargetDir\launch.cmd`"        (or the Desktop shortcut)"
Write-Host "  2. in the browser:  type a look, press 'Make it look like this', then 'Apply to opencode'"
Write-Host "  3. once, for the desktop GUI:  '7 - Desktop app' -> 'Restart app with theming', then 'Apply glass CSS'"
Write-Host ""
Write-Host "One command instead of the UI (also useful in scripts):"
Write-Host "  node `"$TargetDir\tools\apply.mjs`" --everywhere --prompt `"nord blue frosted glass`""
Write-Host ""
Write-Host "Uninstall (keeps your themes and cli.json):"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$TargetDir\uninstall.ps1`""
