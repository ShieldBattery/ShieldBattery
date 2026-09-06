[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('ShieldBattery', 'Native', 'Off')]
  [string]$Mode,
  [switch]$Timing,
  [ValidateLength(0, 80)]
  [string]$Label = '',
  [string]$UserDataPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($UserDataPath)) {
  $UserDataPath = Join-Path $env:APPDATA 'ShieldBattery-Local'
}
if (-not (Test-Path -LiteralPath $UserDataPath -PathType Container)) {
  throw "User data directory does not exist: $UserDataPath"
}
$configPath = Join-Path (Resolve-Path -LiteralPath $UserDataPath).ProviderPath 'mouse-diagnostics.json'
if ($Mode -eq 'Off') {
  if (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath
  }
  Write-Output 'Mouse diagnostics disabled for subsequent game launches; normal ShieldBattery clock restored.'
  return
}

$config = [ordered]@{
  clock = $Mode.ToLowerInvariant()
  timing = [bool]$Timing
  label = $Label
}
$tempPath = $configPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
try {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($tempPath, ($config | ConvertTo-Json -Compress), $utf8)
  if (Test-Path -LiteralPath $configPath) {
    [IO.File]::Replace($tempPath, $configPath, [NullString]::Value)
  } else {
    [IO.File]::Move($tempPath, $configPath)
  }
} finally {
  if (Test-Path -LiteralPath $tempPath) {
    Remove-Item -LiteralPath $tempPath
  }
}
Write-Output "Next game launch: clock=$($config.clock), timing=$($config.timing), label=$Label"
Write-Output "Config: $configPath"
Write-Output 'Close the current StarCraft game before launching the next trial. The launcher can stay open.'
