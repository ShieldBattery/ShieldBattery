# Clock A/B test

This experiment isolates ShieldBattery's process-wide GetTickCount replacement. In `shieldbattery` mode it keeps the existing high-resolution formula. In `native` mode it leaves the Windows API unpatched. All other ShieldBattery patches/settings remain active. It is not a Battle.net-equivalent build.

The DLL reads an optional `mouse-diagnostics.json` in its launch user-data directory once, before patching the game. The helper defaults to `%APPDATA%\ShieldBattery-Local`. For a different app installation, pass `-UserDataPath` with its actual directory. No launcher restart is necessary. Each trial requires a fresh StarCraft process. Missing config restores ordinary behavior; invalid config logs a warning and uses the ordinary clock with timing disabled.

## Developer smoke test and objective comparison

Keep the game settings from the matched baseline: same executable/architecture, display, refresh rate, 300 FPS cap, VSync off, mouse scaling off, and the same cursor sizing and mouse profile. Either 100% or 150% display scaling is fine; leave it constant through the comparison.

1. Close StarCraft, then select the ordinary clock with timing enabled:

   ```powershell
   powershell.exe -NoProfile -File .\game\diagnostics\mouse\set-mouse-diagnostics.ps1 -Mode ShieldBattery -Timing -Label dev-sb-clock
   ```

2. Launch a local/custom game through the development ShieldBattery app. Move the cursor across the middle of the play area for 60 seconds, avoiding screen-edge scrolling. Alt+Tab away and return once, then continue moving for another 15 seconds. Exit the game normally so the aggregate summary is written.
3. Select the native clock, then repeat the same game and movement:

   ```powershell
   powershell.exe -NoProfile -File .\game\diagnostics\mouse\set-mouse-diagnostics.ps1 -Mode Native -Timing -Label dev-native-clock
   ```

4. Save the log after both runs. The default development log is `%APPDATA%\ShieldBattery-Local\logs\game.0.log`; session-namespaced or simultaneous instances can use another filename. Find `[SESSION_START]` and `[MOUSE_DIAGNOSTICS]` in the log to identify each launch and its selected configuration. The startup marker proves the DLL supports this experiment; an absent marker when a valid config is present suggests a stale injected DLL or wrong user-data directory. A warning about config or hook setup invalidates a trial.
5. Repeat in reverse order if both launches work. One ordinary and one native run are enough for the first integration check. You do not need to feel a difference to verify startup, focus handling, nonzero timing samples, and whether timing distributions change.

The timing-enabled path records foreground gameplay durations and intervals for native `process_events`, native `render_screen`, and delivery of `WM_MOUSEMOVE` to the game window procedure. It uses `Instant` (QPC on Windows), fixed-size histograms, and an end-of-game summary; it does not log every movement/frame. Losing focus resets interval baselines so Alt+Tab downtime does not count as a cadence stall. It does add measurement overhead, which is why subjective trials below leave it off.

`render_screen` is a CPU-side function measurement, not a DXGI Present or mouse-to-photon measurement. Mouse-message spacing depends on how continuously you move and can include coalescing; it is not HID polling rate or event age. Neither metric proves a sensitivity change. These diagnostics do not yet read the engine's actual native/software cursor-mode flag, saved sensitivity globals, or original-vs-replacement tick differences. A crash/forced exit can lose the final aggregate.

## Affected-player comparison

An affected player is needed to decide whether the clock switch changes the reported sensation. After developer integration checks pass, provide the same validated build and use a local/custom game. Use the helper without `-Timing` so no additional native timing hooks are installed. Change only `-Mode`, using a fresh game process each time.

Have a helper choose a randomized, balanced order of eight trials (four of each mode), keep the mapping out of the player's view, and record each rating before revealing the modes. Ask about cursor movement separately from animation, camera scrolling, and network smoothness. Include a stock Battle.net reference with the matched settings before the trials. Strong, repeatable preference for the native clock would justify a second instrumented round on that affected setup; a null result on one setup does not exclude other causes or players.

The clock replacement also serves network-turn scheduling, so native mode can change networking behavior. This is an experiment, not a proposed default fix or something to deploy broadly based on a single trial.

## Restore ordinary behavior

```powershell
powershell.exe -NoProfile -File .\game\diagnostics\mouse\set-mouse-diagnostics.ps1 -Mode Off
```

This removes only the diagnostic configuration file. Its effect begins with the next StarCraft launch.

## Prepared build verification

Both debug DLLs were rebuilt through `game/build.bat` after the final hook changes. Their SHA-256 hashes match the corresponding `target` DLLs:

- `game/dist/shieldbattery_64.dll`: `18264E13A7819B8F4E10098936471722E05CC3E02A18F7BEAF74CFBE3320B394`
- `game/dist/shieldbattery.dll`: `01001DA4BC0D97363390380F0CFA21F02D0D0428E5DB490328AE64A47DEA8DE5`

Four focused diagnostic tests pass on each architecture. Workspace Clippy (`--all-targets --workspace -- -D warnings`) passes for both targets; workspace format checking and `git diff --check` pass. The selector's create/replace/remove path was exercised using Windows PowerShell 5.1 in a workspace fixture. At build verification the actual app user-data diagnostic file was absent. The subsequent x64 runtime check is recorded below; x86 in-game behavior remains untested. Build and unit checks alone do not prove native-game runtime behavior.

## Completed developer runtime check

The September 5 x64 comparison completed both instrumented game launches with matching settings and populated summaries. Input-pump/render entry cadence remained near 3.325 ms in both modes. See [clock-ab-20260905-1916-analysis.md](clock-ab-20260905-1916-analysis.md). This completes the initial x64 integration check; it does not validate x86 in-game behavior or an affected player's subjective clock comparison.
