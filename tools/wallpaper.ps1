# OpenCode Theme Manager - read the desktop wallpaper and hand it back as a small data URL.
#
# Why: the opencode desktop app's window is opaque (no transparent:true, no Mica material - verified in
# its bundle), so the real desktop can never show through it. The closest honest thing is to paint the
# wallpaper *into* the page behind translucent panels, which is what this feeds.
#
#   powershell -ExecutionPolicy Bypass -File .\wallpaper.ps1                 # -> { path, width, height, bytes, dataUrl }
#   powershell -ExecutionPolicy Bypass -File .\wallpaper.ps1 -Width 1600 -Quality 72
#   powershell -ExecutionPolicy Bypass -File .\wallpaper.ps1 -Path C:\some.jpg
#
# The image is resized and re-encoded as JPEG so the data URL stays small enough for localStorage.

[CmdletBinding()]
param(
  [string]$Path,
  [int]$Width = 1600,
  [int]$Quality = 70,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing | Out-Null

function Get-WallpaperPath {
  $item = Get-ItemProperty 'HKCU:\Control Panel\Desktop' -ErrorAction SilentlyContinue
  if ($item -and $item.WallPaper) { return [Environment]::ExpandEnvironmentVariables($item.WallPaper) }
  return $null
}

$source = if ($Path) { $Path } else { Get-WallpaperPath }
if (-not $source -or -not (Test-Path $source)) {
  $result = @{ ok = $false; error = "no wallpaper file found (looked at: $source)" }
} else {
  $image = [System.Drawing.Image]::FromFile($source)
  try {
    $targetWidth = [Math]::Min($Width, $image.Width)
    $scale = $targetWidth / $image.Width
    $targetHeight = [Math]::Max(1, [int]($image.Height * $scale))
    $bitmap = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image, 0, 0, $targetWidth, $targetHeight)
    } finally {
      $graphics.Dispose()
    }
    $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int]$Quality)
    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, $encoder, $parameters)
      $encode = [System.Convert]::ToBase64String($stream.ToArray())
    } finally {
      $stream.Dispose(); $bitmap.Dispose()
    }
    $result = @{
      ok = $true; path = $source; width = $targetWidth; height = $targetHeight
      bytes = $encode.Length; dataUrl = "data:image/jpeg;base64,$encode"
    }
  } finally {
    $image.Dispose()
  }
}

if ($Json -or $result.ok -eq $false) {
  $result | ConvertTo-Json -Depth 3 -Compress
} else {
  Write-Host "wallpaper: $($result.path) -> $($result.width)x$($result.height), $([int]($result.bytes/1024)) KB base64"
  Write-Host $result.dataUrl
}
