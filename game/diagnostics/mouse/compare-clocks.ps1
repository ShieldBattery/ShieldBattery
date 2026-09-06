# Read-only local illustration of the SB clock formula; does not hook any API or launch a game.
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class SbClockComparison {
  [DllImport("kernel32.dll", ExactSpelling=true)] static extern uint GetTickCount();
  public static string Run() {
    GetTickCount(); Stopwatch.GetTimestamp();
    long frequency = Stopwatch.Frequency;
    long start = Stopwatch.GetTimestamp();
    uint baseline = GetTickCount(), last = baseline;
    int minOffset = Int32.MaxValue, maxOffset = Int32.MinValue;
    uint minStep = UInt32.MaxValue, maxStep = 0;
    int advances = 0, samples = 0;
    for (;;) {
      long elapsed = (Stopwatch.GetTimestamp() - start) * 1000 / frequency;
      if (elapsed >= 3000) break;
      uint model = unchecked(baseline + (uint)elapsed);
      uint native = GetTickCount();
      int offset = unchecked((int)(model - native));
      minOffset = Math.Min(minOffset, offset); maxOffset = Math.Max(maxOffset, offset);
      if (native != last) {
        uint step = unchecked(native - last);
        minStep = Math.Min(minStep, step); maxStep = Math.Max(maxStep, step);
        advances++; last = native;
      }
      samples++;
      Thread.Sleep(1);
    }
    return String.Format("durationMs=3000 samples={0} nativeAdvances={1} observedNativeStepMs=[{2},{3}] modelMinusNativeMs=[{4},{5}]", samples, advances, minStep, maxStep, minOffset, maxOffset);
  }
}
"@
[SbClockComparison]::Run()
