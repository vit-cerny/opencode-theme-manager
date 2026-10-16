# Test fixture: show one real, tiling-targetable window and keep it open until killed.
# Spawned twice by test/tile.test.mjs so the tiler has two deterministic windows to arrange.
[CmdletBinding()]
param([string]$Title = 'octm tile test')

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.Width = 420
$form.Height = 320
$form.StartPosition = 'Manual'
$form.Left = 40
$form.Top = 40
$label = New-Object System.Windows.Forms.Label
$label.Text = $Title
$label.AutoSize = $true
$label.Left = 16
$label.Top = 16
$form.Controls.Add($label)
[void]$form.ShowDialog()
