# Developer capture analysis: September 5, 2026, 18:03 PDT

Capture: [mouse-state-20260905-180343.jsonl](data/mouse-state-20260905-180343.jsonl). No settings or source code were changed during this analysis.

The capture is usable as a baseline. Missing a focus-loss/return test on the first SB launch does not invalidate it: the second SB launch contains that transition. There is no observed pointer-speed or acceleration-parameter difference. Architecture and presentation settings were not fully matched, so this is not a controlled cursor-latency or cursor-appearance comparison.

## Recorded results

231 samples over approximately 3 minutes 25 seconds, with no API errors. Four samples explicitly flag a foreground transition during the read; all four initially identify Explorer and are excluded from stable game comparisons. Samples are polled at a nominal 100 ms interval, but unchanged samples are only written as roughly one-second heartbeats. The heartbeat spacing is not evidence of a one-second polling interval.

| Session                     | PID   | First/last foreground sample, PDT | Image directory | Samples |
| --------------------------- | ----- | --------------------------------- | --------------- | ------- |
| Battle.net sequence, first  | 61840 | 18:03:54.075 - 18:04:27.222       | x86             | 38      |
| SB, first                   | 54680 | 18:04:59.195 - 18:05:11.417       | x86_64          | 17      |
| SB, second                  | 24300 | 18:05:25.778 - 18:05:41.685       | x86_64          | 16      |
| Battle.net sequence, second | 55720 | 18:05:52.419 - 18:06:24.578       | x86             | 36      |

SB identities are confirmed by SESSION_START records in AppData/Roaming/ShieldBattery-Local/logs/game.0.log at lines 6544 and 6884. The other two sessions follow Battle.net foreground activity and are assigned to the Battle.net runs from that sequence and the user's test description; the recorder itself does not capture launch parentage.

All stable StarCraft samples have:

- Windows mouse speed 10.
- SPI_GETMOUSE parameters [0,0,0].
- Window DPI 96 and DPI awareness value 2 (per-monitor aware category).
- Window class OsWindow.
- Main full-size client dimensions 2560 by 1440, with smaller initialization/exit dimensions also observed.

Desktop and other-application samples also retain speed 10 and parameters [0,0,0]. There is no persistent leaked speed in the captured post-exit periods. Equal speed with custom sensitivity off does not prove that every restore/reapply call executed: the intended active and desktop values are equal in this test.

The second SB process loses foreground around 18:05:36.431 and returns at 18:05:39.934. The clip rectangle returns to the full virtual desktop while other applications are foreground and to (0,0)-(2560,1440) after the game returns. Similar transitions occur in the Battle.net sequences. Both image architectures also show short (0,0)-(2559,1149) clip states; these are not an SB-only finding. GetClipCursor reports neither ownership nor an explicit enabled flag.

## Settings corroboration

SB command payloads at game.0.log lines 6562 and 6902 agree on the relevant settings. The native Documents/StarCraft/CSettings.json was last written at 18:06:21 PDT; its contents are a post-run profile snapshot, not proof of every value throughout the first Battle.net run.

| Setting                 | Battle.net saved native profile | SB native profile / session payloads |
| ----------------------- | ------------------------------- | ------------------------------------ |
| Custom sensitivity      | Off; inactive stored value 25   | Off; inactive stored value 25        |
| Hardware cursor request | On                              | On                                   |
| Mouse scaling           | Off                             | Off                                  |
| Cursor confinement      | On                              | On                                   |
| Display mode            | Windowed fullscreen             | Windowed fullscreen                  |
| VSync                   | Off                             | Off                                  |
| FPS limit               | On, 300                         | On, 500                              |

SB also used legacyCursorSizing=false, useCustomCursorSize=true, customCursorSize=0.5. Those are actual SB cursor modifications in this developer setup, unlike the original player's legacy-sizing configuration. They do not prove a motion/latency effect. For an equivalent cursor-resource/appearance comparison, disable custom cursor sizing and enable legacy cursor sizing in SB.

Native hardware cursor use remains unmeasured. Neither the profile nor this collector reads the native mode byte.

The SB game-start and game-loop-end log entries are 18:05:09.287 to 18:05:12.350 for the first game, and 18:05:35.449 to 18:05:42.595 for the second. Most recorded time for those processes is startup, and part of the second game's short duration is spent out of focus. This suffices to observe basic state transitions; spend roughly 30 seconds on the map before Alt-Tab in the next comparison to capture sustained foreground gameplay.

## Follow-up

Keep the matched native cursor settings for the next baseline. Match architecture and FPS cap as well. The readily available SB "Launch the 32-bit game client" setting can match these existing Battle.net launches; alternatively establish a 64-bit Battle.net launch and compare 64-bit in both. Match the SB cursor sizing as above. These are experimental controls, not suggested permanent fixes.

One short matched run per launcher, including about 30 seconds on the map, focus loss, return, and exit, is enough for this state check; repeating the entire 15-minute recording is unnecessary. Custom sensitivity 70 in both can be a separate follow-up to exercise a game speed different from the observed desktop baseline of 10. Do not mix that change into a baseline mid-session.

A matching follow-up does not rule out the original player's issue. This capture has no physical mouse motion, hardware DPI, actual native cursor-mode readback, or input-to-display latency measurement. The GetTickCount comparison still requires the proposed diagnostic build.
