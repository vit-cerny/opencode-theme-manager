# OpenCode Theme Manager - find who is spawning a process (Windows).
#
#   powershell -ExecutionPolicy Bypass -File .\find-spawner.ps1 -Name rtk.exe -Seconds 45
#
# Watches for new processes of that name via WMI process-creation events and prints, for each one, the
# full parent chain with command lines. That is how you answer "what keeps opening these windows?"
# without guessing: the parent is the caller.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [int]$Seconds = 45,
  [switch]$Json
)

$ErrorActionPreference = 'Stop'
$processName = [IO.Path]::GetFileNameWithoutExtension($Name)
$query = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = '$processName.exe'"
$seen = New-Object System.Collections.ArrayList

Write-Host "watching for $processName.exe for $Seconds s (existing instances: $((Get-Process -Name $processName -ErrorAction SilentlyContinue | Measure-Object).Count))"

try {
  Register-CimIndicationEvent -Query $query -SourceIdentifier octmSpawnWatch -ErrorAction Stop | Out-Null
} catch {
  # Fall back to polling if the event subscription is unavailable (some hardened setups).
  $deadline = (Get-Date).AddSeconds($Seconds)
  $known = @{}
  foreach ($existing in Get-Process -Name $processName -ErrorAction SilentlyContinue) { $known[$existing.Id] = $true }
  while ((Get-Date) -lt $deadline) {
    foreach ($candidate in Get-CimInstance Win32_Process -Filter "Name='$processName.exe'" -ErrorAction SilentlyContinue) {
      if ($known.ContainsKey([int]$candidate.ProcessId)) { continue }
      $known[[int]$candidate.ProcessId] = $true
      [void]$seen.Add($candidate)
    }
    Start-Sleep -Milliseconds 250
  }
}

if ($seen.Count -eq 0) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $events = Get-Event -SourceIdentifier octmSpawnWatch -ErrorAction SilentlyContinue
    foreach ($event in $events) {
      [void]$seen.Add($event.SourceEventArgs.NewEvent.TargetInstance)
      Remove-Event -EventIdentifier $event.EventIdentifier
    }
    if ($seen.Count -gt 0 -and (Get-Date) -gt $deadline.AddSeconds(-2)) { break }
    Start-Sleep -Milliseconds 300
  }
}

$rows = New-Object System.Collections.ArrayList
foreach ($process in $seen) {
  $chain = New-Object System.Collections.ArrayList
  $cursor = $process
  for ($depth = 0; $depth -lt 4 -and $cursor; $depth++) {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId=$($cursor.ProcessId)" -ErrorAction SilentlyContinue
    if (-not $info) { break }
    [void]$chain.Add([pscustomobject]@{
      pid = [int]$info.ProcessId
      name = $info.Name
      command = ($info.CommandLine -replace '\s+', ' ')
      parent = [int]$info.ParentProcessId
    })
    $cursor = Get-CimInstance Win32_Process -Filter "ProcessId=$($info.ParentProcessId)" -ErrorAction SilentlyContinue
  }
  [void]$rows.Add([pscustomobject]@{ spawned = $process.Name; at = (Get-Date).ToString('HH:mm:ss'); chain = @($chain) })
}

if ($Json) {
  @{ watched = "$processName.exe"; hits = @($rows) } | ConvertTo-Json -Depth 6
} else {
  if ($rows.Count -eq 0) {
    Write-Host "no $processName.exe appeared in $Seconds s - it may have stopped, or it starts on an action you need to trigger."
  }
  foreach ($row in $rows) {
    Write-Host "`n$($row.at)  $($row.spawned)"
    for ($i = 0; $i -lt $row.chain.Count; $i++) {
      $link = $row.chain[$i]
      $indent = '  ' * ($i + 1)
      Write-Host ("$indent{0} pid {1} parent {2}: {3}" -f $link.name, $link.pid, $link.parent, ($link.command | Select-Object -First 1))
    }
  }
}

Unregister-Event -SourceIdentifier octmSpawnWatch -ErrorAction SilentlyContinue
