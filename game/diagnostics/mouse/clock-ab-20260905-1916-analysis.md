# Developer clock A/B: September 5, 19:16-19:20 PDT

The diagnostics worked in both x64 game sessions. With identical settings payloads, replacing the ShieldBattery clock with native GetTickCount left average process-events and render-screen entry cadence essentially unchanged on this machine. This is a successful developer integration check and a negative result for a large cadence change under these conditions. It does not exclude a clock-dependent effect on an affected setup, actual cursor-mode differences, or unmeasured input/presentation latency.

## Provenance and controls

Source: `%APPDATA%\ShieldBattery-Local\logs\game.0.log`. A diagnostic-only extraction and derived measurements are saved in [clock-ab-20260905-1916-data.json](clock-ab-20260905-1916-data.json), including the source hash at analysis. Line references below refer to that snapshot; the live log is mutable and rotated/truncated by subsequent launches.

|                                          | ShieldBattery clock | Native clock |
| ---------------------------------------- | ------------------- | ------------ |
| PID                                      | 19164               | 57052        |
| Launch, PDT                              | 19:16:31.469        | 19:18:24.502 |
| SESSION_START line                       | 7882                | 8226         |
| Diagnostic startup line                  | 7883                | 8227         |
| Settings payload line                    | 7901                | 8245         |
| Game-loop start, PDT                     | 19:16:41.418        | 19:18:34.500 |
| Diagnostic summary, PDT                  | 19:17:58.524        | 19:20:01.345 |
| Diagnostic summary line                  | 8085                | 8429         |
| Game-loop start to logged end            | 77.132 s            | 86.871 s     |
| Sum of captured process-events intervals | 70.051 s            | 77.732 s     |

Both startup records report schema 1, x86_64, timing enabled and the intended clock. Each has one matching final summary and a normal game-loop end. All histogram bucket counts sum to the declared sample counts. There are no ERROR entries in these two sessions. Each has the same three egui widget-ID warnings during loading, before gameplay; there are no diagnostic-configuration or hook-setup warnings. The markers establish that the diagnostic code ran and selected the intended branch; they are not an independent measurement of returned native clock values.

The complete settings payloads compare equal, including local, SCR and team-color settings. Relevant controls: x64, windowed fullscreen, 300 FPS limit enabled, VSync off, hardware cursor requested, mouse scaling off, custom sensitivity off, confinement on, legacy cursor sizing on and custom cursor sizing off. This capture does not independently remeasure DPI/OS pointer state or mouse hardware profiles; those are covered only by the earlier developer baseline where measured. Gameplay state, physical mouse trajectories and background workload were not identical or replay-controlled.

The interval sums exclude focus boundaries and do not exactly measure total foreground time: the first event in each foreground epoch has no preceding interval. A scope crossing a focus transition loses its duration sample, so duration and cadence counts need not differ by a fixed one. The approximate gaps between loop wall time and interval sums are consistent with time outside capture, but no explicit focus timeline was logged. These values cannot verify the exact Alt+Tab sequence or timing.

## Measurements

All table values are means computed as `sumUs / count`. They measure the instrumented CPU-side functions and window-message handler, not DXGI Present, displayed FPS, HID rate or physical cursor latency.

| Mean measurement               | ShieldBattery clock | Native clock |
| ------------------------------ | ------------------: | -----------: |
| Input-pump entry interval      |         3.326235 ms |  3.324436 ms |
| Input-pump duration            |         0.402079 ms |  0.340448 ms |
| Render-function entry interval |         3.324958 ms |  3.323387 ms |
| Render-function duration       |         2.877993 ms |  2.931365 ms |
| Mouse-message entry interval   |         2.915125 ms |  3.943567 ms |
| Mouse-message duration         |         0.022186 ms |  0.026869 ms |

Input-pump intervals differ by about 1.8 microseconds (0.054%); render intervals differ by about 1.6 microseconds (0.047%). Both stay near 3.325 ms, consistent with the configured 300 Hz rendering limit. That consistency does not establish actual display presentation rate. There are only three process-events intervals above 8 ms in each run, out of 21,060 and 23,382 samples. Render intervals above 8 ms number three out of 21,058 versus two out of 23,380. Both runs' median cadence falls in the histogram's (2,4] ms bucket and its 95th/99th percentiles in (4,8] ms. The buckets cannot provide more precise percentiles.

The CPU work distributions are not numerically identical: process-events duration averages 402 versus 340 microseconds, while render duration averages 2.878 versus 2.931 ms. This pair does not establish why work is divided differently within the nearly identical entry interval. Timing overhead, event workload, gameplay state and ordinary scheduling variation remain confounders. Do not claim that the clock made all handling faster or that it had zero effect.

There are 24,018 mouse-message handler duration samples with the ShieldBattery clock and 19,680 with native, despite the longer native run. Handler time averages 22.2 versus 26.9 microseconds; observed maxima are 409 versus 807 microseconds. There is no multi-millisecond handler execution in either aggregate. This does not measure time waiting for dispatch or waiting for the visible cursor to update.

Mouse-message intervals average 2.915 versus 3.944 ms, with maxima of 636 versus 580 ms. The native run has more long gaps (over 8 ms: 3.35% versus 1.50%). The recorder observes handler entries, not a controlled stream of physical inputs, so this difference cannot be interpreted as polling rate, a sensitivity multiplier, input delay, or clock causality. Pauses in hand movement, trajectory and message coalescing are all compatible with it. The aggregate has no timestamps that correlate a long gap with another metric's spike.

The maxima include isolated 75-77 ms process-events intervals and approximately 50 ms render intervals in both modes. These are not a repeated ShieldBattery-only stall pattern. Without a per-event timeline, their cause and relation to startup/focus transitions are unknown.

## Result and next test

The x64 integration check is complete. Both clock modes initialize and exit normally and produce populated timing summaries. x86 has build/unit/lint validation but has not been exercised inside StarCraft with these hooks.

This non-affected developer setup provides no evidence of a large change in input-pump or render cadence caused by the clock replacement. It does not rule out player-specific symptoms or a software-cursor/presentation path not represented by these measurements.

The next useful test of the clock hypothesis is a blinded comparison on an affected player's setup, using a fresh game each time and omitting `-Timing`. Keep the same diagnostic build/settings for both modes, establish the player's Battle.net reference, randomize the sequence with a helper, and record ratings before revealing modes. Follow [clock-ab-test.md](clock-ab-test.md). More settings/scaling runs on this developer setup are not necessary for this checkpoint. Actual engine native/software cursor mode still requires separate verified binary-state instrumentation.

At analysis time the real user-data diagnostic config was absent, so subsequent launches already use the normal ShieldBattery clock with timing disabled. No production source, build output or user configuration was changed while analyzing this capture.
