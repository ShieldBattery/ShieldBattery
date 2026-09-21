# BWAPI bot compatibility research

This note records the compatibility boundaries for running existing BWAPI bots
against ShieldBattery's StarCraft: Remastered bridge. It uses upstream project
documentation and source as the authority. The implementation status here is a
development snapshot, not a promise that every API call or bot is supported.

## Verified results

The first integration target is
[ZZZKBot at `7183e37`](https://github.com/chriscoxe/ZZZKBot/tree/7183e37b6b416ea53c1040c83e639a3a3c395eed),
compiled without changes to its bot sources into a 32-bit external-client host.
The host uses the stock BWAPI 4.4 client transport and public API implementation
at [`7687da8`](https://github.com/bwapi/bwapi/tree/7687da8abc4726f8366401f11ab648d421385793).
This moves the C++ bot across the process boundary instead of loading its native
32-bit DLL into 64-bit StarCraft: Remastered.

Two unchanged-source bots have now completed narrow end-to-end scenarios through
the stock BWAPI 4.4 client implementation:

- **ZZZKBot:** the Win32 `ZZZKBotClient.exe` completed winning games against
  both SC:R architectures. On 32-bit SC:R it beat the built-in Terran computer
  in game `01a0c395-16ec-76f3-9dee-f49df1ebb1d7` at frame 9089. That run
  exercised mining, spawning-pool construction, larva association, zergling
  morphing, combat, `onEnd winner=1`, and an 804-byte learning file. On x64
  SC:R it beat a passive Random peer that resolved to Protoss in game
  `01a0c3af-efac-79f3-be69-aefcfcbfaefd`. The opponent race was Unknown
  (BWAPI race 8) at frame 1759 and was later revealed as Protoss; pool,
  zerglings, and the Extractor unit-type-149 construction trick all occurred.
  `onEnd winner=1` arrived at frame 4126 while the victory dialog was still
  open, before the manual End Mission action, and the following acknowledgement
  transitioned the client to menu state. All 18 synchronization probes from
  frame 0 through frame 4080 were identical. Divergence at frames 4320 and 4560
  occurred only after match end during local-only execution. The 517-byte
  learning file recorded `raceScouted 3445 Protoss` and
  `onEnd 4126 winner 1`. The bridge accepted 8763 commands and rejected 14
  invalid or stale-target requests during this run.
- **UAlbertaBot:** the pinned Win32 external executable, with its source and
  configuration unchanged, won an x64 SC:R netcode v2 game against a passive
  local Zerg peer. Game `01a0c39f-bc04-76fa-957d-cc1f811dfe25` exercised
  Terran buildings, SCV production, completed marines, scouting, and two kills;
  the victory was confirmed in the game UI. All 43 synchronization probes from
  frame 0 through frame 10080 were identical. The probes at frames 10320 and
  10560 diverged only after the terminal peer departure, when the surviving
  process was running locally, so they are not evidence of an in-match netcode
  divergence.

These results establish source compatibility for pinned ZZZKBot against x86 and
x64 SC:R, and for pinned UAlbertaBot against x64 SC:R, using Win32 clients
with BWAPI protocol version 10003. They do not
establish compatibility for arbitrary native bot DLLs, other BWAPI protocol
families, or the full public API. After the latest adapter fixes, all 17 bridge
tests pass on both x86 and x64, clippy passes for both targets, formatting passes, and both
`build.bat` outputs are fresh and match their built DLL hashes.

The full-game runs preceded the final review corrections to producer-only rally
fields, race disclosure within the discovery snapshot, disconnected-player status,
and terminal metadata on native-loop exit. Those corrections passed the final
x86/x64 tests, lint, and builds; another full game was not run after them.

ZZZKBot is a better first real bot than an artificial worker-rush example. Its
normal strategy is a small Zerg rush bot, its project has no BWTA or BWEM
dependency, and it exposes the conventional
[`gameInit` and `newAIModule` factories](https://github.com/chriscoxe/ZZZKBot/blob/7183e37b6b416ea53c1040c83e639a3a3c395eed/ZZZKBot/Source/Dll.cpp).
The bot itself must play Zerg. Its worker-rush code detects and defends against
an enemy worker rush; choosing Protoss does not select a simpler ZZZK strategy.

## Compatibility model

"BWAPI-compatible" is not a single binary interface:

1. A native `AIModule` DLL is loaded into the game process. It has low call
   overhead and the broadest feature support, but must match the game's bitness,
   C++ ABI, BWAPI headers, and MSVC runtime. BWAPI's
   [FAQ](https://github.com/bwapi/bwapi/wiki/FAQ) explicitly distinguishes this
   from client programs and warns that BWAPI is not thread-safe.
2. A C++ external client links `BWAPIClient` and exchanges fixed-layout shared
   memory with the server. It avoids loading third-party C++ into the game
   process, but the client/server protocol structures still have to match the
   exact BWAPI family. BWAPI 4.4's release notes removed prebuilt libraries
   because compiler changes can break compatibility and added client-bot timing
   enforcement; see [BWAPI releases](https://github.com/bwapi/bwapi/releases/tag/v4.4.0)
   and the [change log](https://github.com/bwapi/bwapi/wiki/Changes).
3. Java and proxy clients add another native or protocol adapter. JVM bitness,
   native libraries, working directory, and process lifecycle become part of
   the contract.

The tournament ecosystem confirms that these modes coexist. The
[Starcraft AI Tournament Manager](https://github.com/davechurchill/StarcraftAITournamentManager)
supports DLL bots and proxy/client bots with per-bot `AI`, `read`, and `write`
trees. The current
[SSCAIT tournament manager](https://github.com/certicky/sscait-tournamentmanager)
classifies bots as external executables, AI modules, Java Mirror clients, or
Java JNI clients and documents the x86 runtime/JVM and working-directory needs.
The [BWAPI Tournament Module](https://github.com/chriscoxe/bwapi-tm) retains
separate exact interfaces for BWAPI 3.7.4, 3.7.5, 4.1.2, 4.2.0, and 4.4.0.

SCHNAIL is useful as evidence of which bots people actually run, but it is a
closed distribution rather than an implementation authority. Its public site
is [schnail.com](https://schnail.com/); individual upstream bot repositories and
tournament packages are the reproducible sources for compatibility work.

## Candidate matrix

| Project                                                                                                                     | Runtime and BWAPI family                                                                                                                            | Terrain and operational dependencies                                                                                                                                                                                                             | ShieldBattery implication                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ZZZKBot](https://github.com/chriscoxe/ZZZKBot)                                                                             | Upstream VS project is a native 32-bit DLL built for BWAPI 4.2; current source builds against the pinned BWAPI 4.4 public API in the external host. | No BWTA/BWEM dependency. Uses `bwapi-data/read` and `write` for opponent learning and map hash as map identity.                                                                                                                                  | **Verified first target.** The unchanged source build won complete x86 and x64 SC:R matches and wrote learning data. Binary-only releases still require an exact 4.2/native compatibility route. |
| [BWAPI ExampleAIClient](https://github.com/bwapi/bwapi/tree/7687da8abc4726f8366401f11ab648d421385793/bwapi/ExampleAIClient) | Canonical 4.4 C++ external client.                                                                                                                  | No terrain library or persistent state.                                                                                                                                                                                                          | Keep as a protocol regression fixture and fallback smoke test; it is not a representative competitive bot.                                                                                       |
| [UAlbertaBot at `558899d`](https://github.com/davechurchill/ualbertabot/tree/558899d8793456f4a6ec4196efbb5235552e24db)      | BWAPI 4.4 external executable built with VS2019.                                                                                                    | Includes BOSS and SparCraft; replaced BWTA with its own `BaseLocationManager`; requires `UAlbertaBot_Config.txt` in its working directory plus `bwapi-data/read` and `write`. Upstream notes it only handles the first game after process start. | **Verified second target.** Its unchanged source and configuration won an x64 netcode v2 match. Host/process supervision must accommodate its single-game lifecycle.                             |
| [CheeseBot](https://github.com/elliottbarnes/cheese-bot)                                                                    | BWAPI 4.4 external executable, VS2019.                                                                                                              | Narrow Protoss cannon-rush behavior; README limits it to a standard melee game with one opponent.                                                                                                                                                | Good second small behavior test, especially for Protoss power, construction, placement, and fog semantics.                                                                                       |
| [PurpleWave](https://github.com/dgant/PurpleWave)                                                                           | Scala/JVM client through JBWAPI.                                                                                                                    | Java/Maven runtime plus the per-bot `AI/read/write` working directory.                                                                                                                                                                           | Good JVM-family test after native 4.4 C++ clients work; process and runtime packaging are as important as the API surface.                                                                       |
| [JBWAPI](https://github.com/JavaBWAPI/JBWAPI)                                                                               | Pure-Java implementation of the BWAPI 4.4 client protocol for JVM languages.                                                                        | Supports 32- and 64-bit JVMs; includes a pure-Java BWEM port and a BWTA-like facade whose region semantics differ from BWTA.                                                                                                                     | Prefer this direct 4.4 protocol family before JNI variants. Validate its structure sizes and terrain expectations independently from the C++ client.                                             |
| [BWAPI4J](https://github.com/OpenBW/BWAPI4J)                                                                                | Java wrapper with native bridge; upstream targets BWAPI 4.4 and both original Brood War and OpenBW.                                                 | Requires native binaries and JVM bitness matching the selected backend (32-bit for original BW, 64-bit for OpenBW).                                                                                                                              | A distinct JNI/native bridge family; it does not become compatible merely because stock 4.4 C++ clients are compatible.                                                                          |
| [Stardust](https://github.com/bmnielsen/Stardust)                                                                           | Modern C++/CMake BWAPI bot.                                                                                                                         | Uses BWEM and a modified FAP combat simulator; substantially broader API use.                                                                                                                                                                    | Valuable later coverage for modern source builds, terrain analysis, detailed combat state, and pathing. Too large for the first integration proof.                                               |
| [Locutus](https://github.com/bmnielsen/Locutus)                                                                             | C++ BWAPI 4.4-era bot.                                                                                                                              | Carries a stripped BWTA that only loads precomputed cache files and fails when the cache is absent.                                                                                                                                              | Useful terrain-cache compatibility gate. The launcher must stage map-keyed cache data before startup.                                                                                            |
| [BWEM-community](https://github.com/N00byEdge/BWEM-community)                                                               | Header-oriented C++ terrain analysis used by many bots.                                                                                             | Development/tests require original MPQ data; runtime analysis depends on correct map tiles, walkability, neutrals, resources, and map identity.                                                                                                  | Treat terrain inputs as part of the compatibility API. A bot connecting successfully says little about BWEM correctness.                                                                         |
| [DropLauncher](https://github.com/adakitesystems/DropLauncher)                                                              | Launcher for native module and client bots across BWAPI 3.7.4 through 4.2.                                                                          | Stages `bwapi-data`; BWTA/BWTA2 caches can take minutes to generate and live in version-specific cache directories.                                                                                                                              | Useful reference for packaging old bots. It demonstrates why bot archive layout and persistent files cannot be reduced to an executable path.                                                    |

## ZZZK build and host

The reproducible target is defined in `tools/bwapi/CMakeLists.txt`. It rejects
unpinned checkouts, requires Win32 MSVC Release with `/MD`, compiles ZZZK's
`Dll.cpp` and `ZZZKBotAIModule.cpp` unchanged, and links them into
`ZZZKBotClient.exe` with the stock BWAPI 4.4 client transport. The build is:

```powershell
git clone https://github.com/bwapi/bwapi .claude-scratch/bwapi-research
git -C .claude-scratch/bwapi-research checkout 7687da8abc4726f8366401f11ab648d421385793
git clone https://github.com/chriscoxe/ZZZKBot .claude-scratch/ZZZKBot
git -C .claude-scratch/ZZZKBot checkout 7183e37b6b416ea53c1040c83e639a3a3c395eed
cmake -S tools/bwapi -B .claude-scratch/bwapi-bot-build -A Win32
cmake --build .claude-scratch/bwapi-bot-build --config Release --target ZZZKBotClient --parallel
```

The output is `.claude-scratch/bwapi-bot-build/bin/ZZZKBotClient.exe`. The host
mirrors BWAPI's
[`GameEvents.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/GameEvents.cpp)
callback dispatch, installs `BroodwarPtr` through `gameInit`, supports reconnect,
and emits bounded start/end and 240-frame telemetry. ZZZK's bot behavior remains
upstream behavior.

The tagged BWAPI 4.4 `CMake/BWAPI` target names a removed `CommandTemp.h`, so the
tooling builds the public BWAPI library sources directly and uses upstream
`CMake/Client` unchanged. This is a source-build repair, not a custom transport.

Terrain support did not require new binary analysis. The pinned
`samase_scarf::Analysis` already exposed the four required globals. The game
crate added only thin `scr-analysis` wrappers for `map_tile_flags`,
`tileset_indexed_map_tiles`, `tileset_cv5`, and `minitile_data`; samase_scarf
itself was not modified.

## Adapter coverage and gaps

The ShieldBattery adapter should be evaluated against the behavior BWAPI exposes,
not only whether a client connects. The most relevant upstream references are
[`UnitUpdate.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/UnitUpdate.cpp),
[`PlayerImpl.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/PlayerImpl.cpp),
[`GameImpl.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPIClient/Source/GameImpl.cpp),
and the server-side
[`Server.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/Server.cpp).

| Area                                   | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                | Remaining compatibility work                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport and bitness                  | Win32 protocol-10003 clients completed matches against both x86 and x64 SC:R. The x64 UAlbertaBot run had 43 identical probes through frame 10080, and the x64 ZZZK run had 18 through frame 4080; both diverged only after terminal peer departure/local-only execution. All 17 bridge tests pass on both architectures, and both DLL builds are fresh.                                                        | Stress reconnect, timeout, multiple game instances, process cleanup, and table-name isolation.                                                                                                                               |
| Initial state and event order          | `MatchStart` precedes discovery events; self player, race, start, units, and resources reached both bots. Inactive slots are excluded from enemy selection. The x64 ZZZK run verified that a Random opponent remained Unknown (race 8) at frame 1759 and was revealed as Protoss in the same exchange that first observed one of its units.                                                                     | Initial connection is asynchronous and may first publish a frame later than zero. Verify late connection, reconnect, every initial event, and no spurious `UnitComplete` callbacks.                                          |
| Commands                               | ZZZK exercised gather, build, morph, move, and attack behavior; UAlbertaBot exercised Terran building, training, rally, scouting, and combat.                                                                                                                                                                                                                                                                   | Command coverage and validation remain partial. Complete the unit-command matrix, latency/error semantics, queues, cancellation, research/upgrades, spells, loaded units, add-ons, and failure reporting.                    |
| Unit query index                       | Spatial queries and tile/rectangle indexes support the searches used by both verified bots.                                                                                                                                                                                                                                                                                                                     | Query semantics remain partial. Exercise filters under fog, lifted/burrowed units, morphs, destruction, ownership changes, and capacity limits.                                                                              |
| Zerg state                             | Larva association, egg build type, resources, supply, upgrades, and morph/construction/order flags supported complete ZZZK games on both architectures. The x64 victory also exercised Extractor construction and the corrected unit type 149/building classification.                                                                                                                                          | Broaden coverage to cocoons, simultaneous morph queues, cancellation, consumed workers, and edge-case incomplete units.                                                                                                      |
| Movement, production, and combat flags | The adapter provides corrected Zerg order classifications, attack state, Protoss power, and producer-only unit/position rally state. These fields supported the two verified scenarios.                                                                                                                                                                                                                         | Validate acceleration/braking/stuck, Terran add-ons/lift, Protoss production and power loss, spells/status effects, exact velocity/angle semantics, and targets under fog.                                                   |
| Fog, players, and events               | Show/hide/discover/evade, create/complete/morph/renegade, and accessible destroy paths exist. Inactive players are no longer exposed as enemies, and random race disclosure waits for observation.                                                                                                                                                                                                              | Event semantics remain partial. Verify enemy and neutral destruction, ownership changes, player-left, nukes, save events, reconnect, and terminal ordering with bots that consume every callback.                            |
| Map metadata and terrain               | Map hash, random seed, starts, regions, tiles, minitile walkability, buildability, height, creep, resources, and power/rally inputs were sufficient for both bots.                                                                                                                                                                                                                                              | Validate terrain and cache identity on a fixed map corpus, including split regions, doodads, dynamic blockers, fogged creep, and BWEM/BWTA consumers.                                                                        |
| Generic game commands                  | Unit commands are transported; local client-info storage works inside BWAPI's client implementation.                                                                                                                                                                                                                                                                                                            | The generic game-command path is incomplete. `LeaveGame`, drawing, local speed, and frame-skip commands are unsupported, as are broader text/flag/optimization semantics. No bot UI is required for the validated scenarios. |
| Match completion                       | Native terminal states 1 through 3 stop queued bot commands. State 3 is exposed as victory, while state 1 (Disconnected) and state 2 are exposed as defeat. The first following client acknowledgement publishes `MatchFrame` plus `MatchEnd` while `isInGame` remains true; the next acknowledgement transitions the client to menu state. The x64 ZZZK run verified `onEnd` while the result dialog was open. | The native End Mission UI action remains manual because `LeaveGame` is unsupported. Verify terminal timeout/disconnect behavior and automate the native UI exit separately.                                                  |
| Persistence and process environment    | ZZZK wrote an 804-byte learning file on x86 and a 517-byte learning file on x64; the latter recorded Protoss race discovery and the winning `onEnd` frame. UAlbertaBot ran with its stock relative-path configuration.                                                                                                                                                                                          | Formalize per-bot `bwapi-data/AI`, `read`, and writable `write` staging, working directories, disk bounds, and helper-process supervision.                                                                                   |
| Build mode                             | The bridge and adapter are currently development-only.                                                                                                                                                                                                                                                                                                                                                          | Decide how the feature is enabled, supervised, and sandboxed in production builds. Third-party bot executables are arbitrary code.                                                                                           |

## Verified second target: UAlbertaBot

Pin [UAlbertaBot `558899d`](https://github.com/davechurchill/ualbertabot/tree/558899d8793456f4a6ec4196efbb5235552e24db)
and build its existing `UAlbertaBot/VisualStudio/UAlbertaBot.sln` as Release
Win32 against the same pinned BWAPI 4.4 libraries. Its project already produces
an external executable and includes the BOSS and SparCraft projects, so it does
not need the ZZZK source-to-host adapter. The reproducible build recipe is:

```powershell
cmake --build .claude-scratch/bwapi-bot-build --config Release --target BWAPI-Static BWAPIClient --parallel
cmake -P tools/bwapi/ualbertabot.cmake
```

The script verifies both source revisions, exports UAlbertaBot into an isolated
build tree, stages the BWAPI 4.4 SDK, and invokes the upstream solution with the
installed VS 2022 toolset. The verified build completed with zero warnings and
zero errors and produced a Win32 executable without changing bot source or
configuration.

Stage the unmodified
[`UAlbertaBot_Config.txt`](https://github.com/davechurchill/ualbertabot/blob/558899d8793456f4a6ec4196efbb5235552e24db/UAlbertaBot/bin/UAlbertaBot_Config.txt)
beside the executable and launch from that directory. The config's relative
`bwapi-data/read` and `write` paths still need corresponding directories. Start
with a Terran local player: its default `Terran_MarineRush` crosses a new race
boundary with SCV training and persistent-building construction before adding
Protoss power-field semantics.

The x64 netcode v2 victory described above establishes this as the broader
second compatibility gate. Its map initialization scans
walkability/buildability, static minerals and geysers, start locations, and base
connectivity over the whole map. Its production, worker, scouting, information,
and combat managers also rely on create/complete/morph/destroy events, fogged
enemy state, buildability, training queues, and unit searches. Drawing, local
speed, frame skip, and user-input commands are unsupported but did not block the
verified scenario. The config-file failure is currently reported mainly through
drawing calls, so the launcher should check the file before starting the bot.
Run one process per game, matching the upstream lifecycle limitation.

The ABI verifier in `tools/bwapi/verify-abi.ps1` compiles the C++ header fixture
and Rust wire fixture for x86 and x64, then compares all four outputs against
protocol version 10003. The four-way verification and an independent rerun both pass for the pinned sources.
Run it from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File tools/bwapi/verify-abi.ps1 -BwapiRoot .claude-scratch/bwapi-research
```

## Recommended expansion order

1. Keep the 17-test x86/x64 suite, both clippy targets, formatting, and both
   `build.bat` outputs as the baseline, then repeat the recorded winning
   scenarios with automated artifact capture.
2. Keep the independently passing four-way `verify-abi.ps1` comparison as a
   required protocol-10003 layout gate.
3. Test initial attachment after frame zero, disconnect, reconnect, terminal
   acknowledgement timeouts, slow clients, and skipped snapshots.
4. Implement BWAPI `LeaveGame` by adding samase_scarf analysis for SC:R's native
   `request_game_loop_exit` function, then exposing it through `scr-analysis`.
   Binary Ninja identified it at `0x1403072f0` in x64 12310g and `0x006ce580`
   in x86 12409; these are research anchors, not addresses to embed in the bridge.
   The function records the next ScMain state (Victory 7 or Defeat 8) and clears
   the continue-game flag. Sending command `0x57` or only clearing that flag
   does not perform the complete native UI transition.
5. Expand unit commands, queries, and event semantics, then keep ExampleAIClient,
   ZZZKBot, and UAlbertaBot as progressively broader regression fixtures.
6. Run CheeseBot to add Protoss construction and power-loss coverage, then add
   JBWAPI/PurpleWave to establish the pure-Java client family.
7. Validate BWEM and precomputed BWTA-cache bots on a fixed map corpus, and treat
   BWAPI4J/OpenBW as separate backend families.
8. Add versioned protocol frontends for old clients and a separately reviewed
   surrogate for binary-only native x86 DLLs. The current source-build path does
   not load arbitrary bot DLLs into SC:R.

OpenBW is relevant as a future headless/reference engine, but it is not a shortcut
for SC:R compatibility. The [OpenBW engine](https://github.com/OpenBW/openbw)
points BWAPI users to its separate
[OpenBW BWAPI fork](https://github.com/OpenBW/bwapi); that backend has its own
integration boundary and version history. ShieldBattery should keep one stable
internal state/event/command model and place these exact BWAPI-family adapters at
the edge.

The long-tail operational hazards are exact struct layout and enum values,
MSVC runtime and x86 ABI, current-directory assumptions, terrain cache keys,
single-game bot processes, child executables, JVM selection, persistent read/write
files, and bots that assume one opponent. Each imported bot and its assets also
need license review and process isolation before public distribution.
