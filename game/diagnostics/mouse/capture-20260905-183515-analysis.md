# Developer 150% scaling capture: September 5, 2026, 18:35 PDT

Capture: [mouse-state-20260905-183515.jsonl](data/mouse-state-20260905-183515.jsonl). The user changed Windows display scaling to 150% and started new StarCraft sessions without restarting either launcher. No system settings or production code were changed during analysis.

The scaling condition took effect in both game windows: every recorded StarCraft sample reports 144 DPI and per-monitor-v2 awareness. Repeating solely to restart the launchers is not needed to validate this window-DPI comparison. A separate claim about launcher-cached geometry or another startup dependency would require its own evidence; this result does not exclude every possible launcher-state interaction.

## Capture results

262 samples from 18:35:15.437 to 18:38:10.342 PDT, spanning approximately 2 minutes 55 seconds. There are no API errors. Nine samples flag a foreground change during the read; none belongs to a StarCraft foreground sample. One of those transitions has no foreground window, which the recorder represents with null identity/DPI fields.

| Item                                             | Battle.net sequence         | ShieldBattery               |
| ------------------------------------------------ | --------------------------- | --------------------------- |
| PID                                              | 34364                       | 24424                       |
| Foreground samples                               | 83                          | 73                          |
| First/last foreground sample                     | 18:35:21.210 - 18:36:30.270 | 18:36:44.294 - 18:37:28.513 |
| Executable directory                             | x86_64                      | x86_64                      |
| Window DPI                                       | 144 throughout              | 144 throughout              |
| DPI awareness category / mode                    | 2 / per-monitor-v2          | 2 / per-monitor-v2          |
| Windows mouse speed                              | 10 throughout               | 10 throughout               |
| SPI_GETMOUSE parameters                          | [0,0,0] throughout          | [0,0,0] throughout          |
| Full-size client rectangle reported by collector | 1706 by 960                 | 1706 by 960                 |

Both image paths are C:/Program Files (x86)/StarCraft/x86_64/StarCraft.exe. SB's PID is independently corroborated by SESSION_START at AppData/Roaming/ShieldBattery-Local/logs/game.0.log:7549. The other run follows Battle.net foreground activity and matches the user's stated comparison sequence; the collector does not record launch parentage.

The existing Battle.net launcher window reports 144 DPI / per-monitor-v1. The existing SB Electron launcher window reports 96 DPI / per-monitor-v1, yet its newly started game reports 144 DPI / per-monitor-v2. This is direct evidence that the SB game's observed window DPI and awareness mode are not simply those of the launcher window. The log does not establish why the launcher window reports 96 (for example, its monitor placement is not recorded).

## Configuration and focus

The relevant native CSettings values still match: custom sensitivity off (inactive stored value 25), hardware cursor requested on, mouse scaling off, confinement on, windowed fullscreen, VSync off, and an enabled 300 FPS cap. Blizzard's profile was saved at 18:36:26.092; SB's redirected profile at 18:36:43.220. SB's session payload at game.0.log:7567 corroborates those values, legacyCursorSizing=true, and useCustomCursorSize=false. Line 7555 logs Legacy cursor sizing enabled. These are requested settings, not actual native cursor-mode or presentation-timing measurements.

Battle.net loses foreground around 18:36:04.965 and returns at 18:36:12.186. SB loses foreground around 18:37:16.637 and returns at 18:37:21.292. Speed and acceleration parameters remain unchanged across both transitions and after exit. SB's game-start event is at 18:36:53.735 (line 7730); its game loop ends at 18:37:29.533 (line 7744).

## Coordinate interpretation

Both games have the same reported full-size client rectangle, 1706 by 960, and common clip rectangles (0,0)-(1707,960) and (0,0)-(1706,766). The latter corresponds approximately to the smaller gameplay clip rectangle seen at 100% scaling. Even the virtual-desktop clip rectangle has changed from (-2560,-603)-(4000,1957) to (-1707,-402)-(2666,1305), approximately division by 1.5.

This shared scaling of reported coordinates is consistent with collector-side DPI virtualization. It is not a measurement of render-target resolution, and it supplies no evidence of an SB-only resolution reduction or confinement scaling fault. Both client and clip coordinates must be interpreted in the calling API context, not assumed to be physical pixels. Native renderer sizes or a collector using a controlled DPI context would be needed to establish physical-pixel dimensions independently.

Microsoft documents GetDpiForWindow as reporting the monitor DPI for per-monitor-aware windows: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow . Windows also documents that API results can depend on thread DPI context: https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows .

## Consequence

There is no observed game-window DPI, awareness-mode, pointer-speed, or acceleration-parameter divergence in this 150% test. Along with the matched 100% run, this reduces the priority of a simple launcher-dependent DPI-awareness mismatch on this developer setup. It does not measure actual native hardware/software cursor use, hardware mouse DPI, application coordinate-conversion correctness, or cursor latency, and the developer does not report the original symptom.

No further repeat is required solely because the launchers stayed open. The next useful work remains internal cursor-mode/state diagnostics and the controlled GetTickCount-hook comparison.
