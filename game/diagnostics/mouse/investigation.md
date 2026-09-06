# Mouse feel investigation, 2026-09-05

No ShieldBattery-specific cause of the ordinary cursor-movement complaint has been established. The native sensitivity conversion, saved Windows-speed baseline, focus restoration, and hardware-cursor fallback all belong to the same SC:R binary used through Battle.net. Their existence does not explain a difference between launchers. They become causal leads only if an SB change is shown to alter the settings, state, call sequence, API behavior, or presentation feeding those paths.

## Evidence needed to explain an SB/Battle.net difference

| Finding                                       | What actually differs in SB                                                                             | What remains unproved                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GetTickCount hook                             | SB replaces an API used by the shared native code, process-wide for callers reaching the patched entry. | A connection from the changed clock to ordinary visible cursor travel or latency. This is a concrete SB modification to test.                                                      |
| Additional rendering work                     | SB runs overlay work and adds draw commands.                                                            | A relevant delay on affected hardware and whether the visible cursor depends on that rendering.                                                                                    |
| Redirected settings                           | SB supplies its own CSettings profile and persisted overrides.                                          | A relevant settings difference in a matched comparison. With equivalent effective settings this does not explain the complaint.                                                    |
| Native pointer-speed baseline and restoration | No change to this native algorithm was identified.                                                      | An SB-specific difference in the captured baseline or transitions. A hypothetical external mouse utility is not evidence of one.                                                   |
| Native hardware-cursor fallback               | No change to the fallback condition was identified.                                                     | An SB-specific resource/state difference. If both launches use software cursors, fallback alone explains no difference; SB rendering/timing would still need to differ materially. |
| Compatibility override removal                | SB can clear an executable's configured overrides during launch.                                        | Applicability to players without overrides; prior user investigation makes this a subset explanation.                                                                              |

The investigation should prioritize tracing actual SB modifications into the shared cursor path. Native state readbacks are controls for that comparison, not independent evidence against SB or against the player's report. Sections below preserve the reverse-engineering details needed to test those interactions.

Scope clarified by Travis: these reports concern the cursor moving across the screen, not middle-button camera panning. Prior compatibility-setting checks found that most affected players have no overrides. Accordingly, grab pan is excluded and compatibility overrides are a subset explanation, not the leading general hypothesis. The process-wide GetTickCount replacement is investigated separately below.

Initial source review: ShieldBattery `b83324289` (11.2.1). The clock diagnostic implementation and completed x64 runtime check are recorded later in this report. The diagnostic source is preserved on this investigation branch; no cause or production fix has been established.

Original player evidence: `<player-log-dir>` (external to this archive; the local path remains in the ignored scratch notes).

Binary Ninja view: `samase_scarf/tests/64/12310g.exe.bndb`, original image `12310g.exe`, PE x86_64, file/product version **1.23.10.13515**, matching the build reported in the supplied DLL log. Original image SHA256: `AEDFA558721A6DAF059E3760E99121C5655228BE5EAC934265EA6E850965E2AB`. Addresses below use preferred image base `0x140000000`; live addresses require ASLR relocation. Names are existing analysis annotations; the important claims were checked against function bodies, xrefs, and, for the sensitivity calculation, disassembly. The focused decompilation excerpts are saved in `native-mouse-path.txt` beside this report. No BN database mutations were made. The 32-bit binary was not independently analyzed; these addresses must not be reused for it.

## 1. Shared native behavior: Windows pointer speed

The relevant native path is not isolated raw input. Its main window procedure `sub_1406064d0` handles `WM_MOUSEMOVE` at `0x140606c45`, uses `GetCursorPos` and `ScreenToClient` at `0x140606cfe..0x140606d2b`, and sends an engine mouse-move event. `handle_os_input_event` at `0x1402f0970` routes this to `input_driver_handle_mouse_move` at `0x1402f0cba`. `update_ui_mouse_position` at `0x1402f10a0` converts client coordinates to renderer coordinates and clamps them.

There is also a native relative/warped-cursor branch, so this describes the ordinary cursor path, not every input mode in the executable. The imported-address symbol inventory contains no raw-input registration/data API; that alone is not proof against dynamically resolved APIs, but the traced ordinary path is positively identified.

The sensitivity implementation is:

| Native function | Verified behavior                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x140606230`   | Reads `SPI_GETMOUSESPEED` once into saved desktop speed; copies it to the current/requested speed cache.                                                                                 |
| `0x14036e320`   | If `MouseUseSensitivity` is enabled, converts `MouseSensitivity` to `max(0.1f, 2 * sensitivity / 100.0f)` and calls the OS setter wrapper.                                               |
| `0x140606440`   | Clamps the float to 0.1..2.0, multiplies by 10 and truncates to an integer, stores the requested speed, and calls `SPI_SETMOUSESPEED` if its native active flag is set.                  |
| `0x140608860`   | On an active-state transition, writes requested speed when becoming active and saved desktop speed when becoming inactive. It also clears key/button state and dispatches a focus event. |
| `0x140606390`   | Restores saved desktop speed and changes the current/requested cache back to that value; used when custom sensitivity is disabled and on cursor leave.                                   |
| `0x14036e400`   | Applies `MouseUseSensitivity`: disabled calls restoration; enabled reapplies the stored sensitivity property.                                                                            |

The result is approximately `floor(clamp(sensitivity / 5, 1, 20))`, with the native single-precision arithmetic authoritative at boundaries. Sensitivity 70 requests Windows speed 14. A stored value of 75 with custom sensitivity disabled does **not** request speed 15; it uses the saved desktop baseline instead.

Native globals in this exact image:

| Address / RVA               | Meaning inferred from reads/writes       |
| --------------------------- | ---------------------------------------- |
| `0x1410b6da8` / `0x10b6da8` | Native input active flag, byte           |
| `0x1410b6daa` / `0x10b6daa` | Mouse baseline initialization flag, byte |
| `0x1410b6db0` / `0x10b6db0` | Saved desktop speed, int32               |
| `0x1410b6db4` / `0x10b6db4` | Cached current/requested speed, int32    |

`WM_ACTIVATE` invokes that focus transition at `0x140606950`; `WM_ACTIVATEAPP` can invoke the inactive transition at `0x1406068d6`. `WM_MOUSELEAVE` also restores speed: window procedure event 0xF -> `handle_os_input_event` -> `0x140606390`. The next client-area mouse entry causes event 0x10 and reapplies `MouseUseSensitivity`. This player requests confinement, so healthy clipping should prevent routine client-area leave during gameplay; leave/enter is primarily a focus/edge-state diagnostic here.

This creates two important testing consequences:

1. Opening Mouse Settings after Alt-Tab can show the same desktop speed for two games that used different speeds while focused. Looking only at registry values also misses transient `SPI_SETMOUSESPEED` calls with flags zero.
2. With custom sensitivity off, the game uses a **one-time initialization snapshot**, not a continuous reread of desktop preference. If another game or profile utility temporarily owns the global speed while SC:R takes its snapshot, that value can become its baseline. Both launchers inherit this native mechanism. Neither its occurrence in this report nor an SB-specific difference in initialization state has been established. Test isolated launches first, then the user's normal concurrent-process workflow.

All five indexed references to imported `SystemParametersInfoW` in this image are the speed operations above. No acceleration/threshold write was found in that call inventory. Microsoft distinguishes `SPI_GETMOUSESPEED` (1..20) from `SPI_GETMOUSE` (two thresholds and acceleration). Record both; do not describe the speed setter itself as enabling Enhance Pointer Precision.

Windows documentation: [SystemParametersInfoW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow), [mouse movement and Windows ballistics](https://learn.microsoft.com/en-us/windows/win32/dxtecharts/taking-advantage-of-high-dpi-mouse-movement).

## 2. What the player logs establish

The settings payloads are at `shieldbattery.log:22`, `:635`, `:1395`, and `:2041`. The first recorded session starts at 15:37 UTC; the next at 16:37 UTC. All are SB 11.2.1 and 64-bit SC:R build 13515.

| Setting                     | First captured game | Following three games         |
| --------------------------- | ------------------- | ----------------------------- |
| Custom mouse sensitivity    | On, 70              | Off; inactive stored value 75 |
| Custom grab-pan sensitivity | On, 40              | Off                           |
| Display mode                | Windowed fullscreen | Windowed fullscreen           |
| Hardware cursor             | On                  | On                            |
| Legacy cursor sizing        | On                  | On                            |
| Custom cursor size          | Off                 | Off                           |
| Mouse scaling               | Off                 | Off                           |
| Cursor confinement          | On                  | On                            |
| VSync / FPS limit           | Off / off           | Off / off                     |

These changes are consistent with someone trying settings to diagnose the problem; they do not establish user error. The bundle lacks a simultaneous Battle.net settings snapshot, actual foreground `SPI_GETMOUSESPEED`/`SPI_GETMOUSE` values, mouse hardware DPI/profile, and paired presentation/input-latency measurements. The payload is also requested configuration, not an independent readback of all effective engine state.

The player's legacy-cursor setting is corroborated by the DLL's `Legacy cursor sizing enabled` messages. `game/src/bw_scr.rs:2327` skips the cursor-dimension patch, and `:2435` only replaces the scale when custom cursor size is enabled. Therefore the default SB cursor enlargement is a poor explanation for these captured sessions.

## 3. ShieldBattery differences and native state worth measuring

### Independent settings can change native pointer speed

`app/settings.ts:396` maps the input settings directly to `MouseUseSensitivity`, `MouseSensitivity`, `MouseScaling`, `MouseHardwareCursor`, and `MouseConfine`. Defaults import Blizzard's profile when SB's own settings are first created (`:515..555`). Later Blizzard-file changes update the base object (`:640`), but `writeGameSettingsFile` writes `{ ...blizzardSettings, ...fromSbToBlizzard(this.settings) }` (`:654..670`). Existing SB overrides win for keys present in its persisted profile; absent keys still pass through from the Blizzard base.

`game/src/bw_scr.rs:6186` and `:6293` redirect native non-replay CSettings accesses to that SB file. Postgame synchronization reads that redirected file back into SB's profile (`app/settings.ts:673`); it does not synchronize the two products' profiles bidirectionally.

This confirms that the profiles can diverge. It does not establish that relevant settings differed in an affected player's comparison, and no broken sensitivity conversion was found. The mapping itself has no extra SB multiplier. To retire this hypothesis for a particular player, compare both native JSON profiles and foreground speed, rather than just the slider labels or screenshots. Also compare hardware cursor, scaling, window mode, VSync and frame limit because they affect the comparison's presentation conditions.

### Compatibility overrides can make identical game settings behave differently

`app/game/active-game-manager.ts:871..934` temporarily clears the **entire exact-executable HKCU AppCompatFlags\\Layers value** before `launchProcess` and restores it afterward. When a nonempty string is readable and the best-effort write succeeds, this blanks that one executable value (not the whole Layers key) and makes the SB launch different from a normal launch that honors it. The whole-value reset dates to July 2025 (4121869f43). The older April 2023 implementation set __COMPAT_LAYER=RunAsInvoker to suppress elevation; it did not clear this registry value. The whole-value-reset hypothesis therefore does not explain reports predating July 2025.

That is broader than disabling an old Windows-version compatibility mode. If a player's value contains DPI/scaling or fullscreen compatibility options, clearing it can remove a deliberate per-game choice. The flags can look correct again when inspected after launch because SB restores the registry value. This can explain a subset of players using compatibility overrides, including cases where both CSettings files match. Travis reports that prior investigation found most affected players have none; it is therefore a poor general explanation for this issue.

Microsoft documents both per-executable DPI compatibility workarounds and fullscreen optimizations changing the presentation path. It does **not** follow that disabling fullscreen optimizations is universally faster, or that every modern DPI issue is the old Windows 8.1 bug. Measure the actual window DPI awareness and presentation mode. The supplied `app.log` contains none of the found/override/restore compatibility messages, so this is not positively supported for Azhi_Dahaki.

Sources: [DirectX team's fullscreen explanation](https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/), [Windows DPI modes](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows), [historical input/output DPI mismatch](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/mouse-input-incorrectly-scaled).

### SB rendering work and the shared native cursor-mode control

SB performs egui work and injects draw commands per main render (`game/src/bw_scr.rs:2634..2863`). This can change frame times on a constrained machine. The renderer hook calls the original renderer synchronously (`:2869..2960`); no SB Present/SwapBuffers replacement or persistent gameplay 60-Hz cap was found. The 60-Hz timer is loading-only and is stopped before entering the native game loop (`game/src/forge/mod.rs:911`).

Native `draw_software_cursor` at `0x1402cbcc0` exits when `use_native_game_cursor` is set; `apply_current_cursor_to_window` at `0x1402cbc10` selects the OS cursor resource. A confirmed native cursor would weaken an explanation based on game-frame rendering delay affecting pointer position. But the settings payload does not confirm that mode.

**The native mode setter has a fallback gate.** At `0x1402cec20`, a hardware-cursor request becomes active only if cursor resource slots 0 through 18, excluding slot 10, are all non-null. Otherwise it sets `use_native_game_cursor = 0`. This was checked in decompilation and disassembly. The actual mode byte is `0x1410541db` (RVA `0x10541db`); the resource-pointer array begins at `0x141053fc0` (RVA `0x1053fc0`). The hardware/scaling setting observers at `0x14036dd70` and `0x14036df80` call this gate. Mouse scaling can independently force software mode.

This shared fallback makes actual cursor mode a useful measurement control. Its existence is not a standalone explanation for SB feeling different from Battle.net. It is **not evidence that SB fails to load those resources**, and no such failure is established for this player. Legacy sizing and custom size off remove two obvious SB cursor modifications from these sessions. Compare the actual mode and resource success in both launches before attributing the report to rendering.

The native cursor-position synchronization calls found in `0x14036e890` are reached by cursor-option/confinement/resize changes. Explicit cursor positioning also occurs on certain focus/scroll/initialization transitions. No recurring recenter operation was established for ordinary, stationary-camera cursor motion. SB's custom middle-button recentering is outside the reported behavior.

Equal average FPS alone does not rule out added latency: render queue depth, frame-time tails, scanout and presentation mode matter. A paired PresentMon trace plus, if necessary, high-speed physical mouse-to-screen measurement is the right follow-up after state/gain differences are excluded. Avoid screen-recording overlays in the first comparison because they can change composition behavior.

Microsoft: [windowed-game presentation optimizations](https://support.microsoft.com/en-US/Windows/Hardware/Display-Graphics/optimizations-for-windowed-games-in-windows-11).

## 4. Leads that did not survive as strong explanations

- **The wrapper scales ordinary movement:** `game/src/bw_scr/draw_overlay.rs:919..925` records an egui mouse event and returns `None`. `game/src/forge/mod.rs:235..273` then calls the original procedure with the original arguments. The normal motion coordinates are not transformed by the wrapper. Click/wheel capture is restricted to overlay regions or a disconnect block.
- **Missing native activation:** ordinary `WM_ACTIVATE` and `WM_ACTIVATEAPP` pass through. No direct SB `SystemParametersInfo`, raw-input registration, or DPI-awareness call was found. Foregrounding is different, but the identified native focus handlers remain reachable.
- **Fake minimize resets speed:** SB's clip workaround invokes native `WM_SIZE/SIZE_MINIMIZED` (`forge/mod.rs:106`). In this binary the `WM_SIZE` branch calls `0x140605b80`; that function queries actual `IsIconic` and geometry and does not call the speed/focus transition. It does not treat the supplied SIZE_MINIMIZED value as an instruction to change pointer speed. Bad confinement would primarily cause edge clamping, not a uniform gain increase. [ClipCursor documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-clipcursor).
- **Skipped process cleanup proves leaked speed:** native registers `0x1406060c0` with `atexit` at `0x140347f6b`; SB has a TODO native cleanup and exits its own runtime. However, normal SB game completion explicitly hides the window (`game_thread.rs:250`), which can deliver native deactivation/restoration. This is not proof of a normal-exit leak. Crashes, shutdown timing and concurrent instances are test cases, not established causes.
- **Changed window title:** current creation forwards the native title and class. The historical title customization was removed in October 2022. SB uses the original installed `x86_64/StarCraft.exe` (or user-selected x86 image), not a renamed copy (`app/game/active-game-manager.ts:833`). Parent process, arguments, injected modules, inherited environment and architecture can still distinguish third-party profiles; none is established as this report's cause.
- **Custom middle-button panning:** SB changes camera movement only during middle-button drag. Travis confirms these reports are ordinary cursor motion, so that path is excluded.

## 5. GetTickCount: a real clock-contract change, without a proven cursor-motion failure

At `game/src/bw_scr.rs:2566..2587`, SB samples `Instant::now()`, samples native `GetTickCount()`, and replaces the exported API with:

```text
hooked_now = initial_native_tick + floor(monotonic_elapsed_ms)  (mod 2^32)
```

The hook at the Windows function entry is process-wide for calls reaching that entry, including other modules; it is not restricted to network-turn callers or the EXE's import table. It changes the values returned to callers. It does not itself change the Windows timer resolution, HID sampling, Windows pointer ballistics, or timer/message scheduling.

The initial uptime offset fixes the gross mismatch with Windows event timestamps described in the source comment. It does **not** make the two clocks identical: a coarse GetTickCount sample and a continuously advancing monotonic clock retain sampling/quantization phase error. A thread descheduled between the two initialization samples can introduce additional offset. Mixed-clock deadline arithmetic deserves inspection even though the overall uptime range matches. Microsoft documents [GetTickCount's usual 10-16 ms resolution](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-gettickcount) and [GetMessageTime's message-creation timestamp](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getmessagetime).

A read-only local Windows probe over three seconds observed native GetTickCount in 15/16 ms steps (192 advances). An equivalent Stopwatch/QPC-based model of the SB initialization produced replacement-minus-native offsets from -5 to +12 ms in the independently repeated run (the sampling phase varies between runs). The reproducible probe is saved as compare-clocks.ps1 beside this report. No timer-resolution API, hook, or game process was involved. This illustrates the phase mismatch, not growing drift, an affected player's offset, or a cursor bug. Rust documents [Instant using QueryPerformanceCounter on Windows](https://doc.rust-lang.org/stable/std/time/struct.Instant.html); Microsoft documents [QPC time semantics](https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps). The current hook is not made unsuitable simply by ordinary system suspend: both relevant Windows clocks include sleep time.

The exact-build caller trace narrows the plausible effects:

| Path                        | Evidence and implication                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows message pump        | `process_events` calls `0x140606380` at `0x1402f17e5`, before its GetTickCount at `0x1402f17ea`. The wrapper calls `0x140607880`, which drains PeekMessage/TranslateMessage/DispatchMessage without a GetTickCount-based time budget. An optional message filter is present, but no indexed setter was found.                                           |
| Ordinary cursor movement    | `handle_os_input_event` forwards x/y without event time for OSINPUT_MOUSE_MOVE. The concrete driver vtable's movement slot points to `0x140233410`, which updates UI position; no elapsed-time integration was found. Buttons, keys and wheel do receive event time.                                                                                    |
| Main loop                   | `step_game_loop` pumps events at `0x140306f99`, samples time, then calls `update_game_cursor` at `0x140307003`. The 10 ms screen-scroll gate and simulation-time gate are later. Cursor updates are not behind those gates.                                                                                                                             |
| Conditional render throttle | `0x14030708e..0x1403070ba` compares GetTickCount against a render interval when its throttle flag is enabled. The hook can alter frame cadence there. That could affect a software cursor's presentation; it does not scale the OS pointer coordinates. The condition must be checked in the affected session rather than assumed active.               |
| Cursor animation            | `0x1402cbbd0`, `0x1402cbc10` and the tail of `update_game_cursor` use time for cursor animation/frame selection. These are not a demonstrated pointer-trajectory smoother.                                                                                                                                                                              |
| Native cursor timer         | `0x140603140` advances a cursor-resource frame and reschedules with `resourceDelay + TIMERPROC.dwTime - GetTickCount()`. This is a possible mixed-clock boundary. Underflow could turn a late timer into an excessive delay, but its observed role is cursor-frame animation; native dwTime's actual behavior under this export hook needs measurement. |

For the timer callback, Windows documents [dwTime as an uptime/GetTickCount value](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nc-winuser-timerproc), and [SetTimer clamps an excessively large unsigned interval](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-settimer). This arithmetic is worth instrumenting once the callback time source is established; it is not a proven explanation for gliding across the screen.

**Assessment:** the timer hook deserves a controlled A/B. It is weaker as a direct gain/smoothing explanation for an actual native cursor; its stronger plausible connection is altered processing/render cadence when the visible cursor is software-drawn, or an untraced cross-module timing dependency. Git history places the hook, including the initial uptime offset, in commit b388e8ca5 on February 5, 2022. Its age is consistent with longstanding reports; chronology only excludes reports demonstrably predating that introduction.

The discriminating diagnostic is a launch-time switch that either installs this hook or leaves native GetTickCount intact, holding all other patches/settings fixed. Choose the mode before process initialization, not midway through an active session: changing clock values after deadlines exist introduces a new confounder. Use a local/custom game for comparison and expect network timing to change too. In a separate instrumentation build, record original and replacement ticks, GetMessageTime, QPC, actual cursor mode, and input-pump/render durations. Compare signed modular event ages at any actual event-rejection sites. Do not globally hook GetMessageTime to return "now": that destroys message age information.

## 6. Concrete next experiment

`watch-mouse-state.ps1` beside this report records Windows speed, acceleration parameters, foreground PID/image/class, client/clip rectangles and available window DPI/awareness data. It only reads system state and writes a new JSONL file. It installs no hooks, registers no raw-input device, injects nothing, and changes no input settings. It samples at 100 ms by default, emitting changes and one-second heartbeats; it is not a per-input-event or latency recorder. GetClipCursor returns a rectangle even when unconstrained and reports no owner/active flag, so the rectangle alone does not prove clipping is enabled or which process requested it. See [GetClipCursor](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipcursor).

Run it before launching the games. For example, from the repository root:

```powershell
powershell.exe -NoProfile -File .\game\diagnostics\mouse\watch-mouse-state.ps1 -DurationSeconds 600 -Label comparison
```

Keep its console out of focus while evaluating the games. It can also run hidden using `Start-Process -WindowStyle Hidden` with the same arguments. Captures are local; review them before sharing because they include foreground executable paths.

Protocol:

1. Save a copy of Blizzard's actual Documents-folder CSettings and SB's redirected CSettings/scr-settings before changing anything. Use the paths logged by the launcher, since Documents can be redirected. Note the exact StarCraft executable, monitor/refresh, mouse DPI/polling/profile, and any compatibility overrides.
2. Close all StarCraft instances. Record desktop baseline, launch stock through Battle.net, then compare in an actual game with fixed settings. Test ordinary cursor motion in the center of the screen, separated from camera scrolling. Record focus loss, return, and game exit.
3. Repeat via SB, with the same monitor, architecture, game settings and hardware profile. Do not change sensitivity or grab-pan during this comparison. Repeat in reversed order. Use disabled custom sensitivity first to test baseline restoration; use 70 in both as a separate run to test a requested Windows speed of 14.
4. Compare stable foreground samples. A speed or acceleration difference identifies the OS/profile/settings branch immediately. Matching those values does not exclude hardware DPI or proprietary driver transforms. A DPI-awareness/geometry difference points to compatibility/monitor configuration. Rectangles are in the recorder's API context and must not be treated as proven physical-pixel equivalence across mixed-DPI processes.
5. Check actual native cursor mode in both launches using the exact-build globals above or dynamically resolved diagnostic logging. If state matches, measure physical distance to cross a fixed screen distance at both slow and fast movement speeds, away from clip boundaries. A repeatable gain difference still calls for raw-count/hardware-profile tracing. If gain matches but delay remains, capture presentation timing and mouse-to-photon latency. Standard PresentMon frame timing alone is not a complete measurement of hardware-cursor latency.
6. For a player with nonempty AppCompat overrides, compare a diagnostic SB launch that preserves the selected DPI/fullscreen flags against the current launch policy. Review the exact flags before implementing that diagnostic; do not remove all compatibility protection or change every user's defaults on this evidence.

If deeper native state is needed, the exact-build baseline/requested/active globals in section 1 are suitable debugger watchpoints, or can motivate dynamically resolved diagnostics. Do not ship these absolute addresses. Correlate native setter calls (including return status) with foreground/enter/leave transitions and effective CSettings. That distinguishes a wrong requested setting, wrong cached baseline, failed native write, and external last-writer interference.

A repeatable measurement on an affected setup remains necessary. The source and binary inspection give no basis to dismiss the report as imagined, and no basis yet to claim a universal mouse-sensitivity fix.

## Verification and remaining limits

The read-only recorder was independently run on this Windows machine for two seconds. It emitted one header and two heartbeat samples, returned pointer speed 10, mouse parameters [0,0,0], a valid foreground class, DPI 96 / awareness 2, and no sample errors. That verifies collector operation here, not the affected player's state. It does not record physical motion, hardware DPI, per-event latency, or the game's internal mode byte.

At the initial research checkpoint, no affected-player A/B, real StarCraft runtime instrumentation, presentation trace, or physical mouse-to-screen latency measurement had been performed, and no production source or BN database had been changed. See the diagnostic implementation checkpoint below for subsequent source changes; in-game validation remains pending.

## Developer baseline capture, September 5 at 18:03 PDT

The subsequent real-game capture is analyzed in [capture-20260905-180343-analysis.md](capture-20260905-180343-analysis.md). Windows speed remained 10 and acceleration parameters remained [0,0,0] across four game processes and recorded focus/exit transitions. The comparison used x86 for the Battle.net sequence and x86_64 for SB. SB session settings used an FPS cap of 500 and custom cursor sizing; the post-run Battle.net profile uses a cap of 300. These differences need controlling for a presentation comparison. No SB-specific pointer-state fault is demonstrated by this capture. Actual native cursor mode and timer-hook effects remain unmeasured.

## Matched developer baseline, September 5 at 18:25 PDT

The next capture resolves the preceding baseline's identified control differences: both runs use the same x86_64/StarCraft.exe path, the relevant profiles match including a 300 FPS cap, and SB logs legacy sizing enabled with custom sizing disabled. There are 270 samples with no errors or flagged foreground-read races. Windows pointer speed remains 10, SPI_GETMOUSE remains [0,0,0], and game-window DPI/awareness remains 96/2 through sustained gameplay and both focus-away/return sequences. Both also exhibit the same recurring smaller gameplay clip rectangle. No persistent external pointer-state divergence is demonstrated on this setup. This completes the external-state baseline; actual native cursor mode and timer/presentation effects remain unmeasured. Details: [capture-20260905-182539-analysis.md](capture-20260905-182539-analysis.md).

## Additional coverage: Windows display scaling

The matched baseline used 96 DPI with per-monitor awareness category 2. That covers the game monitor at 100% scaling; it does not test higher scale factors or mixed-DPI initialization. Normal Windows display scaling is separate from executable compatibility overrides and from SC:R's MouseScaling option.

A useful single additional comparison is to close both games and both launchers, set the game monitor's ordinary Windows Display > Scale setting to 150%, retain its physical resolution and refresh rate, then restart the launchers. Keep the matched game settings, including MouseScaling off. Record one Battle.net and one SB game on that same monitor with the same 30-second gameplay/focus-return sequence. Restore the display scale afterward if desired. Do not change scaling while either game is running in this first test; that would test a different transition.

For a per-monitor-aware window on a 150% display, GetDpiForWindow should report 144. Compare the two games under that condition. A DPI or awareness-mode difference would identify a concrete launch-dependent divergence. Equal DPI values alone do not establish correct coordinate conversion or equal cursor latency. Recorder rectangle coordinates remain subject to its documented caller-DPI limitations.

The original recorder's numeric dpiAwareness=2 combines per-monitor v1 and v2. It has been extended with dpiAwarenessMode, using AreDpiAwarenessContextsEqual against the documented context constants rather than comparing opaque handles. This is additive read-only diagnostics and does not change DPI settings. A two-second live smoke capture correctly classified the current foreground window as per-monitor-v2 with no errors. This was not a StarCraft measurement and does not retroactively identify the games' specific modes in earlier files.

Sources: [GetDpiForWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow), [Windows DPI scaling behavior](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows), [DPI awareness contexts](https://learn.microsoft.com/en-us/windows/win32/hidpi/dpi-awareness-context), [context comparison](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-aredpiawarenesscontextsequal).

## Developer 150% display-scale result, September 5 at 18:35 PDT

The user kept both launchers running while changing display scale, then launched fresh games. Both game windows consistently report 144 DPI and per-monitor-v2, on the same x86_64 executable path with matched relevant settings. Windows speed remains 10 and SPI_GETMOUSE remains [0,0,0] across both focus-away/return sequences. No API errors occurred; flagged foreground-read transitions affect only non-game samples. The shared reduction in reported client/clip coordinate values is consistent with collector DPI virtualization, not evidence of an SB-only render-resolution change. Restarting launchers is not required to validate that the intended DPI condition was reached; other hypothesized launcher-state interactions remain untested. Actual native cursor mode and input-to-display timing still require separate diagnostics. Details: [capture-20260905-183515-analysis.md](capture-20260905-183515-analysis.md).

## Launch-time clock experiment implementation

The next developer test is described in [clock-ab-test.md](clock-ab-test.md). Both existing DLL architectures support an opt-in `mouse-diagnostics.json` in the launch user-data directory. [set-mouse-diagnostics.ps1](set-mouse-diagnostics.ps1) selects `shieldbattery` or `native` and independently enables timing collection. The helper defaults to `%APPDATA%\ShieldBattery-Local`, reads no preferences, and atomically replaces only this diagnostic file. It was smoke-tested under Windows PowerShell 5.1 in a workspace fixture, including both modes and removal. No real user-data diagnostic file was created by the implementation work.

`native` omits ShieldBattery's GetTickCount detour entirely. `shieldbattery` retains the existing initialization and elapsed-time formula. The choice is made before game patching; it does not switch clocks within an active game. Timing-disabled comparisons add no native process-events/render-screen measurement detours. Valid configs log a schema-versioned startup marker even when timing is off, so blind-test labels and active modes can be recovered from the session log.

With timing enabled, dynamically resolved process_events and render_screen entry hooks plus the existing game wndproc aggregate intervals and durations using Instant. They preserve scalar return registers and use the existing architecture-specific hook conventions. Same-kind recursion is excluded, no aggregation lock spans native calls, focus transitions clear interval bases, and scopes crossing focus epochs are discarded. The final JSON summary is written after normal gameplay exit. Samples describe CPU function duration and window-message cadence; they do not measure physical latency, actual frame presentation, HID rate, or cursor gain. Mouse movement pauses naturally appear as longer message intervals. Focus tracking uses WM_ACTIVATEAPP, initially seeded from the exact game HWND; owned/modal windows are not a separately measured state, so keep the test in ordinary gameplay.

The pinned samase_scarf API has no ready-made actual-native-cursor-mode or saved/requested-sensitivity operand. Existing dynamic anchors alone do not safely identify those globals on both architectures. The actual mode byte and resource-gate resolver is deferred until the semantic pattern can be validated for both x86 and x64. No absolute addresses were added. Binary Ninja MCP connectivity was unavailable during this implementation checkpoint, so no new binary-return or cursor-global evidence is claimed. The native timing detours use the arguments already used by ShieldBattery's direct native calls and conservatively forward the scalar return value for other native callers.

Developer timing comparisons can establish whether the instrumented launch works and whether cadence changes on Travis's setup. An affected player is still needed for a blinded clock-only comparison of the complaint itself; the helper's default timing-off mode supports that. Use local/custom games because disabling the clock replacement also changes network scheduling. This is a diagnostic experiment, not an established fix.

Validation: four focused config/histogram/focus/recursion tests pass on each of x86 and x64. Workspace Clippy with all targets and warnings denied passes for both architectures, and workspace format checking passes. Both debug DLLs were built with game/build.bat; final dist hashes are recorded in the A/B protocol after the last rebuild. At that implementation checkpoint, actual StarCraft launches with these added diagnostics, actual native cursor-mode comparison, affected-player blind trials, and mouse-to-photon measurements remained pending. The x64 runtime check is recorded below.

## Developer clock A/B result, September 5 at 19:16-19:20 PDT

Both x64 sessions ran the intended clock mode with timing enabled and produced complete summaries without configuration/hook errors. The full settings payloads match. Average native process-events entry spacing was 3.326 ms with ShieldBattery's clock and 3.324 ms with native GetTickCount; render-screen entry spacing was 3.325 versus 3.323 ms. Each run has only two or three intervals above 8 ms per process/render metric across more than 21,000 samples. Mouse-message handling averaged 22.2 versus 26.9 microseconds; its unequal delivery intervals cannot be interpreted as physical latency or clock causality because mouse movement was not controlled.

This validates the x64 instrumentation and weakens a large cadence-change explanation on this non-affected setup. It does not exonerate the clock on affected systems, measure actual native/software cursor mode, or establish end-to-end latency. The next discriminating clock test is a blinded affected-player comparison with timing instrumentation disabled. The real diagnostic config was absent at analysis, restoring default behavior for subsequent launches. See [clock-ab-20260905-1916-analysis.md](clock-ab-20260905-1916-analysis.md) for complete measurements, controls and limitations, and [clock-ab-20260905-1916-data.json](clock-ab-20260905-1916-data.json) for the sanitized extraction.
