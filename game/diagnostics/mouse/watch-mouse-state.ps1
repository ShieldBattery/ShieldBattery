[CmdletBinding()]
param(
  [ValidateRange(1, 3600)][int]$DurationSeconds = 180,
  [ValidateRange(20, 5000)][int]$IntervalMilliseconds = 100,
  [string]$Label = 'comparison',
  [string]$OutputPath
)

# Resolve the default after parameter binding, when the script root is available.
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path (Join-Path $PSScriptRoot 'captures') ("mouse-state-{0}.jsonl" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MouseStateNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public const uint SPI_GETMOUSE = 3, SPI_GETMOUSESPEED = 0x70;
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", ExactSpelling=true, SetLastError=true)]
  public static extern bool SystemParametersInfo(uint action, uint param, [Out] int[] value, uint flags);
  [DllImport("user32.dll", EntryPoint="SystemParametersInfoW", ExactSpelling=true, SetLastError=true)]
  public static extern bool SystemParametersInfo(uint action, uint param, out uint value, uint flags);
  [DllImport("user32.dll", ExactSpelling=true)] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", EntryPoint="GetClassNameW", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  public static extern int GetClassName(IntPtr window, [Out] char[] name, int maxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClipCursor(out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", ExactSpelling=true)]
  public static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
  public static string DescribeDpiAwarenessContext(IntPtr context) {
    if (AreDpiAwarenessContextsEqual(context, new IntPtr(-4))) return "per-monitor-v2";
    if (AreDpiAwarenessContextsEqual(context, new IntPtr(-3))) return "per-monitor-v1";
    if (AreDpiAwarenessContextsEqual(context, new IntPtr(-2))) return "system-aware";
    if (AreDpiAwarenessContextsEqual(context, new IntPtr(-5))) return "unaware-gdi-scaled";
    if (AreDpiAwarenessContextsEqual(context, new IntPtr(-1))) return "unaware";
    return null;
  }
}
'@

$schema = 'watch-mouse-state/v1'
$limitations = @(
  'SPI_GETMOUSESPEED and SPI_GETMOUSE are read at each sample; values can change when another process changes system settings.',
  'Foreground identity is captured before the other reads; foregroundChangedDuringRead reports a transition detected by the final check.',
  'Client rectangles are window-client coordinates subject to collector DPI virtualization; clipCursor is desktop-screen coordinates and has no owner or clipping-enabled flag.',
  'DPI is effective per-window DPI when supported. DPI awareness and its specific mode (including per-monitor v1/v2) are reported when supported; no DPI or system setting is changed.',
  'Window titles, input events, hooks, raw input, process memory, and game launch are intentionally not accessed.'
)
$parent = Split-Path -Parent $OutputPath
if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$stream = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))
$start = [DateTime]::UtcNow
$header = [ordered]@{
  recordType = 'header'; schema = $schema; label = $Label; startUtc = $start.ToString('o')
  sampleIntervalMilliseconds = $IntervalMilliseconds; collectorOs = [Environment]::OSVersion.VersionString
  collectorPowerShell = $PSVersionTable.PSVersion.ToString(); collectorBitness = [IntPtr]::Size * 8
  limitations = $limitations
}
$writer.WriteLine(($header | ConvertTo-Json -Compress)); $writer.Flush()
Write-Host 'Leave running while switching between stock StarCraft and ShieldBattery; capture desktop, game, alt-tab, return and exit.'
Write-Host "Recording to $OutputPath"

$lastSignature = $null
$lastHeartbeat = [Diagnostics.Stopwatch]::StartNew()
$watch = [Diagnostics.Stopwatch]::StartNew()
try {
  while ($watch.Elapsed.TotalSeconds -lt $DurationSeconds) {
    $sample = [ordered]@{
      recordType = 'sample'; schema = $schema; label = $Label
      timestampUtc = [DateTime]::UtcNow.ToString('o')
      elapsedMilliseconds = [int64]$watch.Elapsed.TotalMilliseconds
      foregroundChangedDuringRead = $false; errors = @()
    }
    $hwndBefore = [MouseStateNative]::GetForegroundWindow()
    $sample.foregroundHwnd = if ($hwndBefore -eq [IntPtr]::Zero) { $null } else { '0x{0:X}' -f $hwndBefore.ToInt64() }
    $foregroundPid = [uint32]0
    $hasForeground = $hwndBefore -ne [IntPtr]::Zero -and [MouseStateNative]::GetWindowThreadProcessId($hwndBefore, [ref]$foregroundPid)
    $sample.foregroundProcessId = if ($hasForeground) { [int]$foregroundPid } else { $null }
    $sample.foregroundProcessName = $null; $sample.foregroundProcessPath = $null
    $sample.foregroundClassName = $null; $sample.clientRect = $null
    $sample.dpi = $null; $sample.dpiAwareness = $null; $sample.dpiAwarenessMode = $null
    if ($hasForeground) {
      $p = $null
      try {
        $p = Get-Process -Id $foregroundPid -ErrorAction Stop
        $sample.foregroundProcessName = $p.ProcessName
        try { $sample.foregroundProcessPath = $p.MainModule.FileName } catch { $sample.errors += 'Foreground process path unavailable' }
      } catch { $sample.errors += 'Foreground process unavailable' }
      finally { if ($p) { $p.Dispose() } }
      $classChars = New-Object char[] 256
      $classLength = [MouseStateNative]::GetClassName($hwndBefore, $classChars, $classChars.Length)
      if ($classLength -gt 0) { $sample.foregroundClassName = -join $classChars[0..($classLength - 1)] } else { $sample.errors += 'GetClassNameW failed' }
      $rect = [MouseStateNative+RECT]::new()
      if ([MouseStateNative]::GetClientRect($hwndBefore, [ref]$rect)) {
        $sample.clientRect = [ordered]@{ left=$rect.Left; top=$rect.Top; right=$rect.Right; bottom=$rect.Bottom; width=$rect.Right-$rect.Left; height=$rect.Bottom-$rect.Top }
      } else { $sample.errors += 'GetClientRect failed' }
      try {
        $dpi = [MouseStateNative]::GetDpiForWindow($hwndBefore)
        if ($dpi -gt 0) { $sample.dpi = [int]$dpi } else { $sample.errors += 'GetDpiForWindow returned zero' }
      } catch { $sample.errors += 'GetDpiForWindow unavailable' }
      try {
        $context = [MouseStateNative]::GetWindowDpiAwarenessContext($hwndBefore)
        if ($context -ne [IntPtr]::Zero) {
          $awareness = [MouseStateNative]::GetAwarenessFromDpiAwarenessContext($context)
          if ($awareness -ge 0) { $sample.dpiAwareness = $awareness } else { $sample.errors += 'DPI awareness unknown' }
          try {
            $sample.dpiAwarenessMode = [MouseStateNative]::DescribeDpiAwarenessContext($context)
            if ($null -eq $sample.dpiAwarenessMode) { $sample.errors += 'DPI awareness mode unknown' }
          } catch { $sample.errors += 'DPI awareness context comparison unavailable' }
        } else { $sample.errors += 'DPI awareness context unavailable' }
      } catch { $sample.errors += 'DPI awareness APIs unavailable' }
    }
    $speed = [uint32]0
    if ([MouseStateNative]::SystemParametersInfo([MouseStateNative]::SPI_GETMOUSESPEED, 0, [ref]$speed, 0)) { $sample.mouseSpeed = [int]$speed } else { $sample.mouseSpeed = $null; $sample.errors += "SPI_GETMOUSESPEED failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    $mouse = [int[]](0, 0, 0)
    if ([MouseStateNative]::SystemParametersInfo([MouseStateNative]::SPI_GETMOUSE, 0, $mouse, 0)) { $sample.mouseParameters = $mouse } else { $sample.mouseParameters = $null; $sample.errors += "SPI_GETMOUSE failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    $clip = [MouseStateNative+RECT]::new()
    if ([MouseStateNative]::GetClipCursor([ref]$clip)) { $sample.clipCursor = [ordered]@{ left=$clip.Left; top=$clip.Top; right=$clip.Right; bottom=$clip.Bottom } } else { $sample.clipCursor = $null; $sample.errors += 'GetClipCursor failed' }
    $sample.foregroundChangedDuringRead = $hwndBefore -ne [MouseStateNative]::GetForegroundWindow()
    $stable = [ordered]@{}
    foreach ($key in @('mouseSpeed','mouseParameters','foregroundHwnd','foregroundProcessId','foregroundProcessName','foregroundProcessPath','foregroundClassName','clientRect','dpi','dpiAwareness','dpiAwarenessMode','clipCursor','foregroundChangedDuringRead','errors')) { $stable[$key] = $sample[$key] }
    $signature = $stable | ConvertTo-Json -Compress -Depth 6
    if ($signature -ne $lastSignature -or $lastHeartbeat.Elapsed.TotalSeconds -ge 1) { $writer.WriteLine(($sample | ConvertTo-Json -Compress -Depth 6)); $writer.Flush(); $lastSignature = $signature; $lastHeartbeat.Restart() }
    Start-Sleep -Milliseconds $IntervalMilliseconds
  }
} finally { $writer.Dispose(); $stream.Dispose() }
