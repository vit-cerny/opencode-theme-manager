# OpenCode Theme Manager - console-window probe.
# Answers "who is opening cmd windows?" by listing VISIBLE console windows (class ConsoleWindowClass) and
# proving the probe works: it spawns one deliberately visible console and one hidden one, and counts.
#
#   powershell -ExecutionPolicy Bypass -File .\console-probe.ps1
#   powershell -ExecutionPolicy Bypass -File .\console-probe.ps1 -Samples 5 -DelayMs 1500

[CmdletBinding()]
param([int]$Samples = 3, [int]$DelayMs = 1500, [switch]$Json, [int]$Watch = 0, [string]$Out)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Consoles {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint owner);
  // Helpers so the PowerShell callback never marshals [ref]/StringBuilder itself: that silently returned
  // 0 for every window, which made every console look like the same "pid 0" and hid the real owners.
  public static int PidOf(IntPtr hWnd) { uint owner; GetWindowThreadProcessId(hWnd, out owner); return (int)owner; }
  public static string ClassOf(IntPtr hWnd) { StringBuilder sb = new StringBuilder(256); GetClassName(hWnd, sb, 256); return sb.ToString(); }
  public static string TitleOf(IntPtr hWnd) { StringBuilder sb = new StringBuilder(512); GetWindowText(hWnd, sb, 512); return sb.ToString(); }
}
'@

# Console hosts: classic conhost windows and Windows Terminal windows (this machine delegates console
# apps to Windows Terminal, so a stray spawn shows up as a WT window titled with the command).
$consoleClasses = @('ConsoleWindowClass', 'CASCADIA_HOSTING_WINDOW_CLASS')

function Get-VisibleConsole {
  $found = New-Object System.Collections.ArrayList
  $callback = [Consoles+EnumProc]{
    param([IntPtr]$handle, [IntPtr]$param)
    if (-not [Consoles]::IsWindowVisible($handle)) { return $true }
    if ($script:consoleClasses -notcontains [Consoles]::ClassOf($handle)) { return $true }
    $pidValue = [Consoles]::PidOf($handle)
    $info = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
    [void]$found.Add([pscustomobject]@{
      pid = $pidValue
      process = if ($info) { $info.Name } else { "pid:$pidValue" }
      path = if ($info) { $info.ExecutablePath } else { "" }
      title = [Consoles]::TitleOf($handle)
    })
    return $true
  }
  [void][Consoles]::EnumWindows($callback, [IntPtr]::Zero)
  return @($found)
}

# -Watch <seconds>: run this in the background (started hidden) to log every console window that appears,
# with its owning process. That is how you tell "which app pops these windows" without guessing.
if ($Watch -gt 0) {
  $log = if ($Out) { $Out } else { Join-Path $env:TEMP 'octm-console-watch.log' }
  $seen = @{}
  $deadline = (Get-Date).AddSeconds($Watch)
  Set-Content -Path $log -Value "watching visible console windows for $Watch s (self pid $PID)" -Encoding UTF8
  while ((Get-Date) -lt $deadline) {
    foreach ($window in Get-VisibleConsole) {
      if ($window.pid -eq $PID) { continue }          # our own console
      $key = "$($window.pid):$($window.title)"
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = $true
      Add-Content -Path $log -Value ("{0}  {1,-16} pid {2,-7} {3}  {4}" -f (Get-Date).ToString('HH:mm:ss.fff'), $window.process, $window.pid, $window.path, $window.title) -Encoding UTF8
    }
    Start-Sleep -Milliseconds 200
  }
  Add-Content -Path $log -Value "done" -Encoding UTF8
  exit 0
}

$report = [ordered]@{ probe = @{}; samples = @() }

# Proof the probe sees what it claims to see.
$control = Start-Process cmd -ArgumentList '/c','timeout','3' -PassThru
Start-Sleep -Milliseconds 700
$visibleWithControl = @(Get-VisibleConsole).Count
$controlPid = $control.Id
# A hidden child: exactly what the project now does everywhere (windowsHide: true).
$hidden = Start-Process cmd -ArgumentList '/c','timeout','3' -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 700
$visibleWithHidden = @(Get-VisibleConsole | Where-Object { $_.pid -ne $controlPid }).Count
$report.probe = @{
  visibleWithUnhiddenChild = $visibleWithControl
  visibleWithHiddenChild = $visibleWithHidden
  probeWorks = ($visibleWithControl -gt 0)
}

for ($i = 1; $i -le $Samples; $i++) {
  $windows = @(Get-VisibleConsole)
  $report.samples += [pscustomobject]@{
    index = $i
    count = $windows.Count
    windows = @($windows | ForEach-Object { "$($_.process): $($_.title)" })
  }
  if ($i -lt $Samples) { Start-Sleep -Milliseconds $DelayMs }
}

if ($Json) {
  $report | ConvertTo-Json -Depth 5
} else {
  Write-Host ("probe: a normal child shows a console window ({0} visible), a hidden one does not ({1})" -f $report.probe.visibleWithUnhiddenChild, $report.probe.visibleWithHiddenChild)
  foreach ($sample in $report.samples) {
    Write-Host ("sample {0}: {1} visible console window(s)" -f $sample.index, $sample.count)
    foreach ($window in $sample.windows) { Write-Host "   $window" }
  }
}

$control | Stop-Process -Force -ErrorAction SilentlyContinue
$hidden | Stop-Process -Force -ErrorAction SilentlyContinue
