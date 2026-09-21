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
- ShieldBattery overlay rendering and its startup draw timer are skipped. Native
  rendering and audio initialization are still present; muting does not unload the
  audio engine. Game speed, simulation steps, and turn processing are unchanged.

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
`renderCalls`. Increasing render calls are expected: this mode has not bypassed the
native renderer. The counters are compiled out of release DLLs.

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
2. Profile native rendering and audio work. Suppress rendering only at a boundary that
   preserves native draw-command resets, temporary-resource cleanup, and the message
   pump. The renderer's return value and auxiliary command buffers need analysis on
   both architectures; returning early from its entry point is insufficient.
3. Verify a full local match with a visible player and multiple hidden clients,
   including startup failure, bot crash, leaving, replay saving, and offline launch.
   Presentation mode alone does not implement the local transport or matchmaking UX.

The existing HD file hook substitutes dummy data for many HD animation/texture assets;
it is already active and accounts for much of the measured saving. Do not skip sprite
or image initialization wholesale: it also loads gameplay data such as iscript and
image tables. No samase_scarf changes or hardcoded game addresses were needed for this
checkpoint.
