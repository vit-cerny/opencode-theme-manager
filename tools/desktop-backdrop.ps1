# OpenCode Theme Manager - window backdrop (Windows 10 1803+ / Windows 11).
#
# The opencode desktop app creates its window WITHOUT transparent:true and without a Mica/acrylic
# material (verified in its bundle), so the app itself cannot show the wallpaper. Windows can still
# composite a backdrop behind any window, and that needs no app modification and no restart:
#
#   1. Windows 11 22H2+ : DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE=38) -> mica/acrylic/tabbed
#   2. fallback (1803+): SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND / BLURBEHIND)
#
# Both are tried; whichever succeeds is reported. The page must paint a transparent background for
# anything to show through, which the injected CSS does (html/body transparent).
#
#   powershell -ExecutionPolicy Bypass -File .\desktop-backdrop.ps1 -List
#   powershell -ExecutionPolicy Bypass -File .\desktop-backdrop.ps1 -Backdrop acrylic
#   powershell -ExecutionPolicy Bypass -File .\desktop-backdrop.ps1 -Backdrop blur -Json
#   powershell -ExecutionPolicy Bypass -File .\desktop-backdrop.ps1 -Backdrop none
#
# Pixel sampling (on unless -NoSample) measures mean colour and spread inside the window, so
# "something is showing through" is measured instead of asserted.

[CmdletBinding()]
param(
  [ValidateSet('none', 'mica', 'acrylic', 'tabbed', 'blur', 'auto')][string]$Backdrop = 'acrylic',
  [string]$ProcessName = 'OpenCode',
  [switch]$List,
  [switch]$NoSample,
  [switch]$Json,
  [int]$MinWidth = 400,
  [int]$MinHeight = 300
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing | Out-Null

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Backdrop {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint owner);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);
  [DllImport("user32.dll")] public static extern int SetWindowCompositionAttribute(IntPtr hWnd, ref WindowCompositionAttributeData data);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct AccentPolicy {
    public int AccentState;
    public int AccentFlags;
    public int GradientColor;   // ABGR
    public int AnimationId;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct WindowCompositionAttributeData {
    public int Attribute;
    public IntPtr Data;
    public int SizeOfData;
  }

  // AccentState: 0 disabled, 1 gradient, 2 transparent gradient, 3 blur behind, 4 acrylic blur behind
  public static int SetAccent(IntPtr hWnd, int accentState, int gradientColor) {
    AccentPolicy policy = new AccentPolicy();
    policy.AccentState = accentState;
    policy.AccentFlags = 2;
    policy.GradientColor = gradientColor;
    policy.AnimationId = 0;
    int size = Marshal.SizeOf(policy);
    IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      Marshal.StructureToPtr(policy, buffer, false);
      WindowCompositionAttributeData data = new WindowCompositionAttributeData();
      data.Attribute = 19; // WCA_ACCENT_POLICY
      data.Data = buffer;
      data.SizeOfData = size;
      return SetWindowCompositionAttribute(hWnd, ref data);
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
  }
}
'@

$DWMWA_USE_IMMERSIVE_DARK_MODE = 20
$DWMWA_SYSTEMBACKDROP_TYPE = 38
$DWM_TYPES = @{ auto = 0; none = 1; mica = 2; acrylic = 3; tabbed = 4 }
$ACCENT = @{ none = 0; blur = 3; acrylic = 4 }

function Get-AppWindow {
  $owners = @{}
  foreach ($process in Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) { $owners[[uint32]$process.Id] = $true }
  $found = New-Object System.Collections.ArrayList
  if ($owners.Count -eq 0) { return ,$found }
  $callback = [Backdrop+EnumProc]{
    param([IntPtr]$handle, [IntPtr]$param)
    if (-not [Backdrop]::IsWindowVisible($handle)) { return $true }
    if ([Backdrop]::GetWindowTextLength($handle) -eq 0) { return $true }
    [uint32]$owner = 0
    [void][Backdrop]::GetWindowThreadProcessId($handle, [ref]$owner)
    if (-not $owners.ContainsKey($owner)) { return $true }
    $rect = New-Object Backdrop+RECT
    [void][Backdrop]::GetWindowRect($handle, [ref]$rect)
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt $script:MinWidth -or $height -lt $script:MinHeight) { return $true }
    $title = New-Object System.Text.StringBuilder 256
    [void][Backdrop]::GetWindowText($handle, $title, 256)
    $class = New-Object System.Text.StringBuilder 256
    [void][Backdrop]::GetClassName($handle, $class, 256)
    [void]$found.Add([pscustomobject]@{
      handle = $handle.ToInt64(); pid = [int]$owner; title = $title.ToString(); class = $class.ToString()
      x = $rect.Left; y = $rect.Top; width = $width; height = $height; minimized = [Backdrop]::IsIconic($handle)
    })
    return $true
  }
  [void][Backdrop]::EnumWindows($callback, [IntPtr]::Zero)
  return ,$found
}

function Measure-Window {
  param([pscustomobject]$Window)
  if ($Window.minimized) { return $null }
  # Screen sampling only means something if this window is the one on screen at that point.
  [void][Backdrop]::ShowWindow([IntPtr]$Window.handle, 5)   # SW_SHOW
  [void][Backdrop]::SetForegroundWindow([IntPtr]$Window.handle)
  Start-Sleep -Milliseconds 350
  $x = $Window.x + [int]($Window.width * 0.3)
  $y = $Window.y + [int]($Window.height * 0.45)
  $point = New-Object Backdrop+POINT
  $point.X = $x + 40; $point.Y = $y + 20
  $top = [Backdrop]::GetAncestor([Backdrop]::WindowFromPoint($point), 2)   # GA_ROOT
  $occluded = $top.ToInt64() -ne $Window.handle
  $w = [Math]::Max(24, [int]($Window.width * 0.4))
  $h = [Math]::Max(12, [int]($Window.height * 0.15))
  $bitmap = New-Object System.Drawing.Bitmap($w, $h)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size($w, $h)))
    $sumR = 0.0; $sumG = 0.0; $sumB = 0.0; $lums = New-Object System.Collections.ArrayList; $n = 0
    $stepX = [Math]::Max(1, [int]($w / 24)); $stepY = [Math]::Max(1, [int]($h / 8))
    for ($px = 0; $px -lt $w; $px += $stepX) {
      for ($py = 0; $py -lt $h; $py += $stepY) {
        $colour = $bitmap.GetPixel($px, $py)
        $lum = 0.2126 * $colour.R + 0.7152 * $colour.G + 0.0722 * $colour.B
        $sumR += $colour.R; $sumG += $colour.G; $sumB += $colour.B
        [void]$lums.Add($lum); $n++
      }
    }
    $meanLum = ($lums | Measure-Object -Average).Average
    $spread = [Math]::Sqrt((($lums | ForEach-Object { ($_ - $meanLum) * ($_ - $meanLum) } | Measure-Object -Sum).Sum) / $n)
    return [pscustomobject]@{
      r = [int]($sumR / $n); g = [int]($sumG / $n); b = [int]($sumB / $n)
      luminance = [Math]::Round($meanLum, 1); spread = [Math]::Round($spread, 2); samples = $n
      occluded = $occluded
    }
  } finally {
    $graphics.Dispose(); $bitmap.Dispose()
  }
}

$windows = Get-AppWindow
$results = New-Object System.Collections.ArrayList
foreach ($window in $windows) {
  $before = if ($NoSample) { $null } else { Measure-Window -Window $window }
  $dwmResult = $null; $accentResult = $null; $applied = $null
  if (-not $List) {
    $dark = 1
    [void][Backdrop]::DwmSetWindowAttribute([IntPtr]$window.handle, $DWMWA_USE_IMMERSIVE_DARK_MODE, [ref]$dark, 4)
    $type = $DWM_TYPES[$Backdrop]
    $dwmResult = [Backdrop]::DwmSetWindowAttribute([IntPtr]$window.handle, $DWMWA_SYSTEMBACKDROP_TYPE, [ref]$type, 4)
    $actual = 0
    [void][Backdrop]::DwmGetWindowAttribute([IntPtr]$window.handle, $DWMWA_SYSTEMBACKDROP_TYPE, [ref]$actual, 4)
    # 0x80070057 (invalid arg) / 0x80004005 mean the build predates the attribute -> use the accent path.
    $accentState = if ($Backdrop -eq 'mica' -or $Backdrop -eq 'tabbed' -or $Backdrop -eq 'auto') { 4 } else { $ACCENT[$Backdrop] }
    $accentResult = [Backdrop]::SetAccent([IntPtr]$window.handle, $accentState, [int]0x99201016)
    $applied = if ($dwmResult -eq 0) { "dwm type $actual" } else { "accent state $accentState" }
    Start-Sleep -Milliseconds 500
  }
  $after = if ($NoSample) { $null } else { Measure-Window -Window $window }
  [void]$results.Add([pscustomobject]@{
    handle = $window.handle; pid = $window.pid; title = $window.title; class = $window.class
    rect = "$($window.width)x$($window.height) at $($window.x),$($window.y)"
    requested = $Backdrop; applied = $applied; dwmHresult = $dwmResult; accentHresult = $accentResult
    sampleBefore = $before; sampleAfter = $after
  })
}

if ($Json) {
  @{ ok = $true; backdrop = $Backdrop; windows = @($results) } | ConvertTo-Json -Depth 6
} else {
  if ($results.Count -eq 0) { Write-Host "no $ProcessName window found (>= $MinWidth x $MinHeight, visible)" }
  foreach ($entry in $results) {
    Write-Host "$($entry.title) [$($entry.class)] $($entry.rect)"
    if ($List) { Write-Host "  listed (nothing changed)"; continue }
    Write-Host "  requested=$($entry.requested) -> $($entry.applied) (dwm hr=$($entry.dwmHresult), accent hr=$($entry.accentHresult))"
    if ($entry.sampleBefore -and $entry.sampleAfter) {
      Write-Host ("  pixels before rgb({0},{1},{2}) lum {3} spread {4} -> after rgb({5},{6},{7}) lum {8} spread {9}" -f `
        $entry.sampleBefore.r, $entry.sampleBefore.g, $entry.sampleBefore.b, $entry.sampleBefore.luminance, $entry.sampleBefore.spread, `
        $entry.sampleAfter.r, $entry.sampleAfter.g, $entry.sampleAfter.b, $entry.sampleAfter.luminance, $entry.sampleAfter.spread)
    }
  }
}
