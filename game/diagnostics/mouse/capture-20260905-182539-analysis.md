# Matched developer baseline: September 5, 2026, 18:25 PDT

Capture: [mouse-state-20260905-182539.jsonl](data/mouse-state-20260905-182539.jsonl). This supersedes the earlier capture's architecture and presentation-setting mismatches for the baseline comparison. No settings or production code were changed during analysis.

The recorded external pointer-state check is complete on this developer machine. There is no observed pointer-speed, acceleration-parameter, or window-DPI divergence between the matched runs. This is not a measurement of actual native cursor mode or cursor latency, and the developer does not report the original symptom.

## Capture quality and process identity

270 samples from 18:25:39.686 through 18:28:04.371 PDT (approximately 2 minutes 25 seconds). No API errors and no samples flagged for foreground changes during the read. The collector polls at a nominal 100 ms interval and writes state changes plus approximately one-second heartbeats.

| Session             | PID   | Foreground samples | First/last foreground sample, PDT |
| ------------------- | ----- | ------------------ | --------------------------------- |
| Battle.net sequence | 53152 | 115                | 18:25:45.323 - 18:26:51.676       |
| ShieldBattery       | 58276 | 107                | 18:27:06.592 - 18:28:02.842       |

Both paths are C:/Program Files (x86)/StarCraft/x86_64/StarCraft.exe. The executable was not hashed at each launch; the recorded path establishes that the architecture/path mismatch from the first capture is gone. SB identity is independently confirmed by SESSION_START at AppData/Roaming/ShieldBattery-Local/logs/game.0.log:7216. The other run follows Battle.net foreground activity, consistent with the user's test description; launch parentage is not a recorder field.

## Effective state and settings

| Item                             | Battle.net                    | ShieldBattery                 |
| -------------------------------- | ----------------------------- | ----------------------------- |
| Observed Windows pointer speed   | 10 throughout                 | 10 throughout                 |
| Observed SPI_GETMOUSE parameters | [0,0,0] throughout            | [0,0,0] throughout            |
| Observed window DPI / awareness  | 96 / 2                        | 96 / 2                        |
| Main full-size client dimensions | 2560 by 1440                  | 2560 by 1440                  |
| Custom sensitivity               | Off; inactive stored value 25 | Off; inactive stored value 25 |
| Hardware cursor request          | On                            | On                            |
| Mouse scaling                    | Off                           | Off                           |
| Cursor confinement               | On                            | On                            |
| Display mode                     | Windowed fullscreen           | Windowed fullscreen           |
| VSync                            | Off                           | Off                           |
| FPS cap                          | Enabled, 300                  | Enabled, 300                  |

The first four rows are observed recorder state. Remaining rows are checked against the saved native CSettings profiles, with SB additionally corroborated by its session command at game.0.log:7234. Blizzard's profile was last written at 18:26:48.644 PDT; SB's redirected native profile was written at 18:27:05.532 PDT. These are configuration evidence, not per-frame native-state readbacks or measured FPS.

SB's session uses legacyCursorSizing=true and useCustomCursorSize=false. The Legacy cursor sizing enabled message at game.0.log:7222 corroborates bypassing the cursor-dimension patch. Stored customCursorSize=0.5 is inactive. The relevant cursor sizing difference from the first capture is therefore controlled.

Pointer speed and acceleration parameters also remain 10 and [0,0,0] while other applications are foreground, including the captured periods after exit. There is no observed persistent speed leak. Because the expected desktop and game speeds are equal with custom sensitivity disabled, this does not establish that every native restore/reapply call executed.

## Focus and clipping

The Battle.net process loses foreground around 18:26:30.357 and returns at 18:26:37.684. The SB process loses foreground around 18:27:47.088 and returns at 18:27:58.025. Both show the virtual-desktop clip rectangle while other applications have focus and a game rectangle upon return. GetClipCursor reports a rectangle, not ownership or an enabled flag.

Both games repeatedly alternate between (0,0)-(2560,1440) and (0,0)-(2559,1149). The latter occurs in 38 Battle.net samples and 40 SB samples; these event-driven sample counts do not estimate a duty cycle. Its occurrence is shared, and this capture supplies no basis for calling it an SB-specific clipping fault. Smaller initialization/exit rectangles differ, consistent with the different startup sequences; a link from those transient differences to sustained cursor motion remains unestablished.

SB's game-start event is at 18:27:16.069 (game.0.log:7396), followed by approximately 31 seconds before focus is lost. Its game loop ends at 18:28:02.891 (line 7411). This provides the requested sustained gameplay interval and a focus-away/return comparison, addressing the short games in the first capture.

## Consequence for the investigation

No repeat of the same external-state baseline is needed at this point. These results weaken a persistent Windows pointer-speed, acceleration, or DPI difference on this setup as an explanation. They do not exclude brief changes between polls, hardware DPI/profile differences invisible to these APIs, actual native hardware/software cursor-mode differences, or input-to-display latency.

The next useful diagnostic work is internal cursor-mode/state readback and a launch-time GetTickCount-hook comparison with low-overhead input/render timing. This capture did not toggle the timer hook or measure its downstream effects. An affected player's controlled comparison remains needed to connect any measured difference to the reported symptom.
