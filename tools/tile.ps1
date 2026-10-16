# OpenCode Theme Manager - window tiler (Windows only).
#
# opencode's desktop GUI has no split panes (its bundle only exposes New Window / New Session),
# so "see several agents at once" means: open one window per session, then snap them into a grid.
#
#   powershell -ExecutionPolicy Bypass -File .\tile.ps1 -List
#   powershell -ExecutionPolicy Bypass -File .\tile.ps1 -Layout 2x2
#   powershell -ExecutionPolicy Bypass -File .\tile.ps1 -Layout 1x2 -Padding 10 -Json
#   powershell -ExecutionPolicy Bypass -File .\tile.ps1 -Restore
#
# Every layout run saves the previous positions first, so -Restore undoes exactly one tiling.
# Nothing else on the desktop is touched: only visible top-level windows of -ProcessName.

[CmdletBinding()]
param(
  [string]$Layout = '2x2',
  [string]$ProcessName = 'OpenCode',
  [int]$Padding = 8,
  [switch]$List,
  [switch]$Restore,
  [switch]$Json,
  [string]$StateFile
)

$ErrorActionPreference = 'Stop'
if (-not $StateFile) { $StateFile = Join-Path $env:LOCALAPPDATA 'opencode-theme-manager\last-layout.json' }

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Tile {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

function Get-TargetWindow {
  param([string]$Name)
  $pids = @{}
  foreach ($p in Get-Process -Name $Name -ErrorAction SilentlyContinue) { $pids[[uint32]$p.Id] = $true }
  $found = New-Object System.Collections.ArrayList
  if ($pids.Count -eq 0) { return ,$found }
  $callback = [Win32Tile+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$param)
    if (-not [Win32Tile]::IsWindowVisible($handle)) { return $true }
    if ([Win32Tile]::GetWindowTextLength($handle) -eq 0) { return $true }
    [uint32]$owner = 0
    [void][Win32Tile]::GetWindowThreadProcessId($handle, [ref]$owner)
    if (-not $pids.ContainsKey($owner)) { return $true }
    $title = New-Object System.Text.StringBuilder 512
    [void][Win32Tile]::GetWindowText($handle, $title, 512)
    $rect = New-Object Win32Tile+RECT
    [void][Win32Tile]::GetWindowRect($handle, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    # Skip helper/hidden windows (a minimized Electron window reports -25600,-25600 at 159x23).
    if ($width -lt 200 -or $height -lt 150) { return $true }
    [void]$found.Add([pscustomobject]@{
      handle    = $handle.ToInt64()
      pid       = [int]$owner
      title     = $title.ToString()
      minimized = [Win32Tile]::IsIconic($handle)
      x         = $rect.Left
      y         = $rect.Top
      width     = $width
      height    = $height
    })
    return $true
  }
  [void][Win32Tile]::EnumWindows($callback, [IntPtr]::Zero)
  return ,$found
}

function Write-Result {
  param($Payload)
  if ($Json) { $Payload | ConvertTo-Json -Depth 6 } else {
    foreach ($w in $Payload.windows) {
      '{0,-40} pid {1,-7} x {2,-6} y {3,-6} {4}x{5}' -f $w.title, $w.pid, $w.x, $w.y, $w.width, $w.height
    }
  }
}

$windows = Get-TargetWindow -Name $ProcessName

if ($Restore) {
  if (-not (Test-Path $StateFile)) {
    if ($Json) { @{ ok = $false; error = "no saved layout at $StateFile" } | ConvertTo-Json -Depth 6 } else { Write-Host "nothing to restore ($StateFile is missing)" }
    exit 0
  }
  $saved = Get-Content $StateFile -Raw | ConvertFrom-Json
  $restored = New-Object System.Collections.ArrayList
  foreach ($entry in $saved.windows) {
    $match = $windows | Where-Object { $_.handle -eq $entry.handle } | Select-Object -First 1
    if (-not $match) { $match = $windows | Where-Object { $_.pid -eq $entry.pid -and $_.title -eq $entry.title } | Select-Object -First 1 }
    if (-not $match) { continue }
    [void][Win32Tile]::ShowWindow([IntPtr]$match.handle, 9)
    [void][Win32Tile]::SetWindowPos([IntPtr]$match.handle, [IntPtr]::Zero, [int]$entry.x, [int]$entry.y, [int]$entry.width, [int]$entry.height, 0x0004 -bor 0x0040)
    [void]$restored.Add([pscustomobject]@{ handle = $match.handle; pid = $match.pid; title = $match.title; x = [int]$entry.x; y = [int]$entry.y; width = [int]$entry.width; height = [int]$entry.height })
  }
  Remove-Item -Force $StateFile
  Write-Result @{ ok = $true; restored = $restored.Count; windows = $restored }
  exit 0
}

if ($List -or $windows.Count -eq 0) {
  if (-not $Json) { Write-Host ("{0} window(s) for process '{1}' in {2}" -f $windows.Count, $ProcessName, $StateFile) }
  Write-Result @{ ok = $true; process = $ProcessName; layout = $null; workArea = $null; windows = @($windows) }
  exit 0
}

if ($Layout -match '^\s*(side-by-side|sidebyside|row)\s*$') { $columns = 2; $rows = 1 }
elseif ($Layout -match '^\s*(stacked|stack|column)\s*$') { $columns = 1; $rows = 2 }
elseif ($Layout -match '^\s*(grid|quad)\s*$') { $columns = 2; $rows = 2 }
elseif ($Layout -match '^\s*(\d+)\s*[xX]\s*(\d+)\s*$') { $columns = [int]$Matches[1]; $rows = [int]$Matches[2] }
else { throw "Layout must look like 2x2 (columns x rows), side-by-side or stacked; got '$Layout'" }
if ($columns -lt 1 -or $rows -lt 1 -or ($columns * $rows) -gt 16) { throw "Layout out of range: $Layout" }
$label = "$columns column(s) x $rows row(s)"

$work = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$cellWidth = [math]::Floor(($work.Width - ($columns + 1) * $Padding) / $columns)
$cellHeight = [math]::Floor(($work.Height - ($rows + 1) * $Padding) / $rows)

# Stable order so repeated runs do not shuffle windows: left-to-right, top-to-bottom, then handle.
$ordered = @($windows | Sort-Object @{ Expression = { $_.x } }, @{ Expression = { $_.y } }, @{ Expression = { $_.handle } })
$cells = $columns * $rows
$tiled = New-Object System.Collections.ArrayList
$originals = New-Object System.Collections.ArrayList

for ($index = 0; $index -lt $ordered.Count -and $index -lt $cells; $index++) {
  $window = $ordered[$index]
  [void]$originals.Add([pscustomobject]@{ handle = $window.handle; pid = $window.pid; title = $window.title; x = $window.x; y = $window.y; width = $window.width; height = $window.height })
  $column = $index % $columns
  $row = [math]::Floor($index / $columns)
  $x = $work.X + $Padding + $column * ($cellWidth + $Padding)
  $y = $work.Y + $Padding + $row * ($cellHeight + $Padding)
  [void][Win32Tile]::ShowWindow([IntPtr]$window.handle, 9)
  [void][Win32Tile]::SetWindowPos([IntPtr]$window.handle, [IntPtr]::Zero, [int]$x, [int]$y, [int]$cellWidth, [int]$cellHeight, 0x0004 -bor 0x0040)
  [void]$tiled.Add([pscustomobject]@{ handle = $window.handle; pid = $window.pid; title = $window.title; x = [int]$x; y = [int]$y; width = [int]$cellWidth; height = [int]$cellHeight; column = $column; row = $row })
}

# One level of undo: keep the positions from before this run unless we are already mid-layout.
if (-not (Test-Path $StateFile)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $StateFile) | Out-Null
  @{ savedAt = (Get-Date).ToString('o'); process = $ProcessName; windows = @($originals) } | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding UTF8
}

Write-Result @{
  ok = $true
  process = $ProcessName
  layout = $label
  padding = $Padding
  workArea = @{ x = $work.X; y = $work.Y; width = $work.Width; height = $work.Height }
  tiled = $tiled.Count
  untitled = $windows.Count - $tiled.Count
  stateFile = $StateFile
  windows = @($tiled)
}
