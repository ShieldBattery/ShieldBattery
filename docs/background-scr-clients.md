# Background SC:R clients

The launcher accepts `presentation: 'background'` on a `GameLaunchConfig`. This is a
working low-resource presentation mode for a single SC:R process, intended as the
foundation for local BWAPI opponents. It uses the regular ShieldBattery injection,
settings handshake, simulation, and process-exit path.

It is not a graphics-free engine or the multi-bot session supervisor. The existing
`ActiveGameManager` still owns one active game; launching another config replaces it.
There is no user-facing bot launch UI yet.

## Process behavior

- The presentation flag reaches the DLL on its command line, before hooks are installed.
- The main game window is created without `WS_VISIBLE`. Show, foreground, activation,
  focus, cursor-warp/confinement, global-hotkey, display-mode, and gamma changes are
  suppressed for background clients. The window and message pump remain alive.
- Each launch gets a private canned `CSettings.json` under
  `<userData>/background-games/client-*/`. It selects SD graphics, disables music,
  sound, portraits, lighting, foliage, and optional visual effects. Local settings
  select a 640x480 window, zero master volume, and the existing HD asset-skip path.
- Background game settings never merge into the player's SC:R settings. Window-position
  and minimap preference writes are suppressed. Normal clients retain their own settings.
- The startup handshake installs the settings redirect before releasing SC:R's main
  thread to initialize. The temporary file is removed after confirmed process exit or
  launch failure. If waiting for exit fails, it is retained because the process may
  still need it. Abrupt app termination can also leave a temporary directory.
- ShieldBattery overlay rendering and its startup draw timer are skipped. Live games
  retain native rendering with a 30 FPS cap: bypassing it caused immediate peer drops
  in a visible-player/hidden-bot match. Replay playback can use SC:R's no-draw frame
  finalizer after the first logic step, preserving command-buffer, light, and palette
  cleanup. For replays, a 16 ms wait replaces the renderer's frame cap while normal
  event and turn loops keep running. Startup renders normally. If analysis cannot
  resolve the finalizer, native rendering remains enabled and a warning is logged.
- The native SFX loader returns its ordinary failure result without opening or decoding
  assets. Audio initialization stays intact. Unsupported loader shapes retain the
  muted native behavior and log a warning. With the canned settings, the measured
  extra saving is only the unconditional startup button sound.
- Background clients use two Tokio workers instead of one per logical processor.
  Simulation remains on its own native thread; game speed and turn rules are unchanged.
- Background clients never save replays: ShieldBattery's temporary upload save, native
  named/manual/crash writes, LastReplay replacement, and LastReplay autosave copying
  are suppressed. The named-save hook returns before creating paths or deleting an
  existing replay. A missing named-save analysis prevents background launch rather
  than risking the player's LastReplay. Visible clients keep normal replay saving.
  Replay command recording in memory is still enabled.

The canned file is `app/game/background-csettings.json`; it does not copy player or
account fields. Its directory is per launch, including repeated launches of the same
match ID. It is separate from a bot's persistent learning data.

## Development launch

Build the app main bundle with `pnpm run build-app-main` and the DLL with
`game\build.bat` or `game\build.bat x86`, then restart the dev Electron instance.
The dev-only console helper accepts a normal launch config:

```js
const gameId = await window.__sbDebugGame.launch({
  ...gameConfig,
  presentation: 'background',
})
await window.__sbDebugGame.queryGameState(gameId)
// Finish a development run that has no visible controls:
await window.__sbDebugGame.forceQuit(gameId)
```

Omit `presentation` for the visible baseline. The debug state includes
`presentation.background`, `windowVisible`, `gameFrame`, `hdAssetSkips`, and
`renderCalls`, `skippedRenderCalls`, and `skippedSoundLoads`. On supported builds,
replay render calls stop increasing after startup while skipped renders and game
frames advance. Live games continue incrementing native render calls. The counters
are compiled out of release DLLs.

The normal `launch32Bit` setting still chooses the executable architecture. Use an
isolated `SB_SESSION` for testing. To attach an existing external bot, additionally
set `SB_BWAPI=1` before starting that Electron process and follow the
[BWAPI bridge launch instructions](../tools/bwapi/README.md#launch). Background
presentation does not enable BWAPI by itself or change its compatibility limits.

## Verification, 2026-09-21

Live tests used x64 build 12310g and x86 build 12409, launched through Electron.
Both hidden windows had a measured 640x480 client area, remained invisible, and
advanced the simulation at normal speed. An external WinEvent observer recorded
window creation but no show/foreground events for the hidden clients; visible
baselines produced show and foreground events as expected.

The same replay produced identical logged sync probes at frames 0, 240, 480, 720,
and 960 across visible/hidden runs on both architectures. These probes cover RNG,
resources, and trigger timing; they are not an exhaustive proof of engine equivalence.

| Client                   | Working set | Private bytes |
| ------------------------ | ----------: | ------------: |
| x64, visible HD baseline |     726 MiB |      1372 MiB |
| x64, background          |     289 MiB |       406 MiB |
| x86, visible HD baseline |     676 MiB |       675 MiB |
| x86, background          |     255 MiB |       250 MiB |

These are single-machine debug-build snapshots during the same replay, not peak-memory
measurements or a general benchmark. The visible baseline used that test profile's
ordinary settings; the background mode changes several settings together. Hidden runs
skipped 895 HD assets. Fifteen-second CPU samples were about 16% of one core for hidden
x64, 20% for hidden x86, and 32% for the visible x64 baseline; sample intervals were
not frame-aligned and compiler activity may affect them.

Player settings hashes stayed unchanged during the hidden replay, and its private
settings directory disappeared after exit. Focused app tests cover concurrent settings
isolation, launch failure cleanup, normal exit cleanup, and retaining settings after a
failed process wait. Typechecking, both DLL builds, both-target clippy, Rust formatting,
and the Rust workspace tests passed.

A hidden x64 solo match also ran the existing ZZZKBot against a built-in Terran
computer through frame 4387. Its BWAPI snapshot showed a completed Spawning Pool,
mining Drones, and Zerglings moving across the map. At frame 4320 the bridge had
accepted 8554 commands and rejected 25; this was an activity smoke test, not a
complete match or a new compatibility certification. The client stayed invisible at
640x480, and the app's local settings, SC:R preferences, and Blizzard CSettings file
all retained their pre-launch hashes. The bot test was stopped explicitly.

## Next work

1. Give a local match a supervisor that owns the visible player client, hidden bot
   clients, and external bot processes. Define cancellation and crash cleanup for all
   of them, including leaving the player's match and unexpected app exit. Give each
   process separate logs and deterministic BWAPI attachment; stock discovery is
   ambiguous with multiple unclaimed servers.
2. Investigate the retained memory described below, GPU/backend initialization, and
   the memory held by replay recording. Preserve native cleanup and gameplay data;
   avoid disabling image/iscript initialization or treating every rendering call as
   interchangeable. Verify long-running games and network stalls before claiming
   resource or determinism equivalence.
3. Verify a full local match with a visible player and multiple hidden clients,
   including startup failure, bot crash, leaving, replay saving, and offline launch.
   Presentation mode alone does not implement the local transport or matchmaking UX.

The existing HD file hook substitutes dummy data for many HD animation/texture assets;
it is already active and accounts for much of the measured saving. Do not skip sprite
or image initialization wholesale: it also loads gameplay data such as iscript and
image tables. Renderer and audio entry points are resolved by samase_scarf, with no
hardcoded runtime addresses. The native no-draw finalizer resolves in all 165 stored
binary fixtures; the optional SFX loader resolves in 125, with 40 explicit fallbacks.

## Rendering optimization follow-up, 2026-09-21

Thirty-second process samples during the same replay (debug builds, one machine).
These samples exclude the external bot process and run without the BWAPI bridge.
The rendering bypass is now restricted to replays; these CPU savings do not describe
the supported live-game configuration:

| Client                                         | CPU, percent of one core | Working set | Private bytes |
| ---------------------------------------------- | -----------------------: | ----------: | ------------: |
| x64, hidden settings only                      |                    21.7% |     290 MiB |       407 MiB |
| x64, rendering bypass + two workers + SFX gate |                     1.4% |     320 MiB |       438 MiB |
| x86, rendering bypass + two workers + SFX gate |                     1.9% |     287 MiB |       296 MiB |

The x64 sample uses about 94% less CPU than the earlier hidden client. It also holds
about 30 MiB more private memory; a repeated original-build run reproduced the lower
baseline. The x86 baseline above was about 250 MiB private, versus 296 MiB in the final
sample. These changes prioritize
CPU and drawing work, and are **not** a further memory reduction. The extra retained
memory has not been explained. Allowing an additional initial game render increased
memory further and was not retained. No GPU-memory or peak-memory claim is made.

Both architectures remained hidden and performed four startup renders, with no further
native draws while simulation advanced. Replay sync probes matched the original hidden
x64 baseline through frame 2880 on both final architectures; intermediate
render/audio experiments also matched through frame 4560. The final 16 ms wait retained
the expected 10.08 seconds per 240 simulation frames. These are sampled fingerprints,
not exhaustive determinism validation or a multi-client network-stall test.

Before the live-game regression was discovered, a solo ZZZKBot run on x86
with the rendering bypass enabled measured 3.1% of one core
for SC:R including the BWAPI bridge, and 0.16% for the external bot. Working sets
were 318 MiB and 17 MiB respectively. This measures one small early-game army and
one bot; more expensive bots and later-game simulation can cost substantially more.
The bot completed a Spawning Pool and continued issuing commands through frame 2160
(1454 accepted, zero rejected). The x64 activity run reached frame 2525. Neither
activity run was a full-match or multi-bot compatibility test.

Normal native quit/confirmation paths were verified on hidden x64 and x86 games.
Replay directory inventories, LastReplay content hashes and modification times, and
upload-temp paths remained unchanged. Logs confirmed both native autosave and the
LastReplay copy were suppressed; result messages contained no temporary replay path.
A visible x86 regression run still wrote LastReplay and its named autosave and emitted
`replaySaved`. The prior LastReplay was restored after that visible test.

Both DLL builds, both-target clippy, formatting, the 250 Rust workspace tests per
architecture, seven launcher tests, and TypeScript typechecking passed. The analysis
repository's 109 binary-fixture tests plus unit/doc tests passed. This does not cover
multiple simultaneous hidden clients, long-running memory stability, or network stalls.

## Live peer regression and fallback, 2026-09-21

A visible x64 player and hidden x64 ZZZKBot client dropped each other immediately
with rendering bypass enabled. The initial sync probes agreed, but native drops
occurred at frames 4 and 9. Thus matching replay probes and solo bot activity did
not establish live-peer compatibility.

An A/B retry retained the hidden window, SD/HD asset settings, audio suppression,
and worker limit, but restored native rendering at 30 FPS. It reached frame 8721
with both clients connected and the bot window still hidden. Sync probes matched
at frames 0, 240, and 480. This establishes a usable fallback on x64, not the exact
cause of the divergence or a completed-match certification. The equivalent paired
live-game check on x86 remains outstanding.

The render bypass is restricted to replay playback. Native rendering performs UI,
viewport, and graphics-layer updates that the no-draw finalizer omits; further
instrumentation must identify which omitted work affects peer synchronization
before live games can use it safely. Existing no-replay-save behavior is unchanged.

This interactive test used two isolated Electron sessions and the normal developer
server lobby/relay flow. It does not implement offline local transport or a general
bot supervisor. A temporary process watcher closes the bot client, external bot,
and bot Electron session when the player's game exits.

The replay-only guard compiled for both architectures, and both-target clippy and
formatting checks passed. Both DLLs were copied to `dist`; the x64 refresh completed
after the interactive game exited. The player reported that the match worked well.
The process watcher completed, and the bot game, external bot, and bot Electron
session were confirmed stopped.
