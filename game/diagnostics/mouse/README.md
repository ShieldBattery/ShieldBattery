# Mouse cursor investigation

This directory preserves an investigation into reports that ordinary cursor movement feels different through ShieldBattery and Battle.net. It includes experimental game-DLL changes on the `investigate/mouse-clock-ab` branch. No cause or production fix has been established; this branch is for resuming controlled tests with an affected player, not a proposed general rollout.

## Resume here

1. Read the [latest clock comparison](clock-ab-20260905-1916-analysis.md) and the [clock A/B procedure](clock-ab-test.md).
2. Build this branch using `game\build.bat debug` for x64 and `game\build.bat debug x86` for x86, from the repository root. Use `build.bat` so the app's injected files in `game/dist` are updated. The completed developer comparison used debug x64. Release builds can be produced with the `release` argument, but a release build needs its own integration check before an affected-player trial. Use the same DLL build for both clock modes.
3. On an affected setup, establish the player's Battle.net reference with matched game settings, display, architecture and hardware mouse profile. Run the blinded clock comparison from the procedure, without `-Timing`. The selector defaults to `%APPDATA%\ShieldBattery-Local`; pass `-UserDataPath` with the app's actual launch user-data directory when using another installation.
4. Record each trial's assessment before revealing the chosen mode. The game log's `[MOUSE_DIAGNOSTICS]` startup record confirms the selected configuration. Quit each game normally and launch a fresh StarCraft process for the next trial; the ShieldBattery launcher can stay open.
5. Restore ordinary behavior with `-Mode Off` when finished. A missing config means the normal ShieldBattery clock and no timing collection.

From the repository root, select a clock for the next launch:

```powershell
powershell.exe -NoProfile -File .\game\diagnostics\mouse\set-mouse-diagnostics.ps1 -Mode ShieldBattery -Label trial-a
powershell.exe -NoProfile -File .\game\diagnostics\mouse\set-mouse-diagnostics.ps1 -Mode Native -Label trial-b
powershell.exe -NoProfile -File .\game\diagnostics\mouse\set-mouse-diagnostics.ps1 -Mode Off
```

Run one selector command between games; these are alternatives, not a sequence to run before one game. For a blinded trial a helper selects the modes and keeps the mapping out of the player's view. Add `-Timing` only for the separate instrumented comparison; its CPU timing hooks add measurement overhead. The native clock option also changes network scheduling, so start in local/custom games.

## What has been established

- Matching x64 external-state comparisons at 100% and 150% display scaling found no Windows pointer-speed, acceleration-parameter or game-window DPI divergence on the developer setup. The developer does not experience the reported symptom.
- Both x64 clock modes passed an in-game diagnostic run with identical settings. Input-pump and render-function entry intervals remained near 3.325 ms. This did not identify a clock-dependent cadence problem on that setup.
- Both architectures passed compilation, focused diagnostic tests, workspace Clippy and formatting checks. Only x64 has been exercised in-game with the added instrumentation.
- Actual engine hardware/software cursor mode and physical mouse-to-screen latency remain unmeasured. Native fallback/sensitivity behavior is shared with Battle.net and needs a demonstrated SB-specific change in state/timing to explain the complaint.

The immediate remaining clock experiment requires a player who experiences the symptom. The separate binary-analysis task is to resolve and validate the actual cursor-mode state on both x86 and x64. Known addresses in the research notes apply only to the exact analyzed x64 build and must not be hardcoded into a general diagnostic.

## Files and evidence

| File                                                       | Purpose                                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [investigation.md](investigation.md)                       | Source/binary findings, Windows documentation, hypotheses, completed checkpoints and limits  |
| [clock-ab-test.md](clock-ab-test.md)                       | Developer and affected-player clock comparison, configuration, log locations and restoration |
| [set-mouse-diagnostics.ps1](set-mouse-diagnostics.ps1)     | Select the next launch's clock and optional timing collection                                |
| [watch-mouse-state.ps1](watch-mouse-state.ps1)             | Read-only Windows pointer, foreground-window, clipping and DPI recorder                      |
| [compare-clocks.ps1](compare-clocks.ps1)                   | Standalone three-second illustration of the clock formula; does not modify or launch a game  |
| [native-mouse-path.txt](native-mouse-path.txt)             | Focused reverse-engineering excerpts from SC:R 1.23.10.13515 x64                             |
| [Initial baseline](capture-20260905-180343-analysis.md)    | First capture with architecture/settings mismatches                                          |
| [Matched baseline](capture-20260905-182539-analysis.md)    | Matched x64 comparison at 100% display scale                                                 |
| [150% scale baseline](capture-20260905-183515-analysis.md) | Matched higher-DPI comparison                                                                |
| [Clock comparison](clock-ab-20260905-1916-analysis.md)     | Completed x64 clock A/B and quantitative interpretation                                      |
| [Clock diagnostic data](clock-ab-20260905-1916-data.json)  | Extracted startup/summary records, selected settings and derived values                      |
| [Capture manifest](data/manifest.json)                     | Three archived external-state captures and original file hashes                              |

The selected developer captures are preserved under `data/`. Local repository/user-profile path prefixes are replaced with `<repo>`, `%APPDATA%` and `%USERPROFILE%`; these are descriptive placeholders, not automatically expanded by JSON readers. Their measured values, identities, timestamps and ordering are preserved. The clock data's source hash identifies the original full game log at analysis time. The full game/player logs, binaries, personal settings files and disposable smoke-test captures are not part of this archive. Source/log line references in dated reports refer to the snapshots named there and may drift as code/logs change.

Future recorder output defaults to this directory's ignored `captures/` folder. Review a capture before deliberately archiving it: foreground executable paths can contain personal information. To record external state:

```powershell
powershell.exe -NoProfile -File .\game\diagnostics\mouse\watch-mouse-state.ps1 -DurationSeconds 600 -Label affected-comparison
```

The scratch originals remain in the local workspace for continuity; this tracked directory is the maintained handoff.
