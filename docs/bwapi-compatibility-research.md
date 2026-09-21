# BWAPI bot compatibility research

This note records the compatibility boundaries for running existing BWAPI bots
against ShieldBattery's StarCraft: Remastered bridge. It uses upstream project
documentation and source as the authority. The implementation status here is a
development snapshot, not a promise that every API call or bot is supported.

## Current result

The first integration target is
[ZZZKBot at `7183e37`](https://github.com/chriscoxe/ZZZKBot/tree/7183e37b6b416ea53c1040c83e639a3a3c395eed),
compiled without changes to its bot sources into a 32-bit external-client host.
The host uses the stock BWAPI 4.4 client transport and public API implementation
at [`7687da8`](https://github.com/bwapi/bwapi/tree/7687da8abc4726f8366401f11ab648d421385793).
This moves the C++ bot across the process boundary instead of loading its native
32-bit DLL into 64-bit StarCraft: Remastered.

A development run has established the following narrow end-to-end result:

- a 32-bit `ZZZKBotClient.exe` connected to 64-bit StarCraft: Remastered;
- `MatchStart` reported a Zerg self player, its start tile, nine initial units,
  and resources;
- by frame 240 the bot had issued 15 accepted unit commands and no rejected
  commands, and mining was progressing;
- after correcting the native `DroneLand` construction-state mapping, a fresh
  x64 run spent the pool minerals and showed the spawning pool under construction
  by frame 960.

This is provisional early-game evidence. Pool completion, larva morphing,
combat, match end, reconnect, and the learning-file round trip still need
full-game validation.

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

| Project | Runtime and BWAPI family | Terrain and operational dependencies | ShieldBattery implication |
| --- | --- | --- | --- |
| [ZZZKBot](https://github.com/chriscoxe/ZZZKBot) | Upstream VS project is a native 32-bit DLL built for BWAPI 4.2; current source builds against the pinned BWAPI 4.4 public API in the external host. | No BWTA/BWEM dependency. Uses `bwapi-data/read` and `write` for opponent learning and map hash as map identity. | **First target.** Small real competitive bot; source factory boundary makes source-to-sidecar conversion direct. Binary-only releases would still require an exact 4.2/native compatibility route. |
| [BWAPI ExampleAIClient](https://github.com/bwapi/bwapi/tree/7687da8abc4726f8366401f11ab648d421385793/bwapi/ExampleAIClient) | Canonical 4.4 C++ external client. | No terrain library or persistent state. | Keep as a protocol regression fixture and fallback smoke test; it is not a representative competitive bot. |
| [UAlbertaBot at `558899d`](https://github.com/davechurchill/ualbertabot/tree/558899d8793456f4a6ec4196efbb5235552e24db) | BWAPI 4.4 external executable built with VS2019. | Includes BOSS and SparCraft; replaced BWTA with its own `BaseLocationManager`; requires `UAlbertaBot_Config.txt` in its working directory plus `bwapi-data/read` and `write`. Upstream notes it only handles the first game after process start. | **Second target.** It exercises a much wider API without a terrain-cache dependency. Host/process supervision must accommodate its single-game lifecycle. |
| [CheeseBot](https://github.com/elliottbarnes/cheese-bot) | BWAPI 4.4 external executable, VS2019. | Narrow Protoss cannon-rush behavior; README limits it to a standard melee game with one opponent. | Good second small behavior test, especially for Protoss power, construction, placement, and fog semantics. |
| [PurpleWave](https://github.com/dgant/PurpleWave) | Scala/JVM client through JBWAPI. | Java/Maven runtime plus the per-bot `AI/read/write` working directory. | Good JVM-family test after native 4.4 C++ clients work; process and runtime packaging are as important as the API surface. |
| [JBWAPI](https://github.com/JavaBWAPI/JBWAPI) | Pure-Java implementation of the BWAPI 4.4 client protocol for JVM languages. | Supports 32- and 64-bit JVMs; includes a pure-Java BWEM port and a BWTA-like facade whose region semantics differ from BWTA. | Prefer this direct 4.4 protocol family before JNI variants. Validate its structure sizes and terrain expectations independently from the C++ client. |
| [BWAPI4J](https://github.com/OpenBW/BWAPI4J) | Java wrapper with native bridge; upstream targets BWAPI 4.4 and both original Brood War and OpenBW. | Requires native binaries and JVM bitness matching the selected backend (32-bit for original BW, 64-bit for OpenBW). | A distinct JNI/native bridge family; it does not become compatible merely because stock 4.4 C++ clients are compatible. |
| [Stardust](https://github.com/bmnielsen/Stardust) | Modern C++/CMake BWAPI bot. | Uses BWEM and a modified FAP combat simulator; substantially broader API use. | Valuable later coverage for modern source builds, terrain analysis, detailed combat state, and pathing. Too large for the first integration proof. |
| [Locutus](https://github.com/bmnielsen/Locutus) | C++ BWAPI 4.4-era bot. | Carries a stripped BWTA that only loads precomputed cache files and fails when the cache is absent. | Useful terrain-cache compatibility gate. The launcher must stage map-keyed cache data before startup. |
| [BWEM-community](https://github.com/N00byEdge/BWEM-community) | Header-oriented C++ terrain analysis used by many bots. | Development/tests require original MPQ data; runtime analysis depends on correct map tiles, walkability, neutrals, resources, and map identity. | Treat terrain inputs as part of the compatibility API. A bot connecting successfully says little about BWEM correctness. |
| [DropLauncher](https://github.com/adakitesystems/DropLauncher) | Launcher for native module and client bots across BWAPI 3.7.4 through 4.2. | Stages `bwapi-data`; BWTA/BWTA2 caches can take minutes to generate and live in version-specific cache directories. | Useful reference for packaging old bots. It demonstrates why bot archive layout and persistent files cannot be reduced to an executable path. |

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

## Adapter coverage and gaps

The ShieldBattery adapter should be evaluated against the behavior BWAPI exposes,
not only whether a client connects. The most relevant upstream references are
[`UnitUpdate.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/UnitUpdate.cpp),
[`PlayerImpl.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/PlayerImpl.cpp),
[`GameImpl.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPIClient/Source/GameImpl.cpp),
and the server-side
[`Server.cpp`](https://github.com/bwapi/bwapi/blob/7687da8abc4726f8366401f11ab648d421385793/bwapi/BWAPI/Source/BWAPI/Server.cpp).

| Area | Current evidence | Remaining compatibility work |
| --- | --- | --- |
| Transport and bitness | A Win32 4.4 client connected to x64 SC:R and exchanged snapshots and commands. | Stress reconnect, timeout, multiple game instances, process cleanup, and table-name isolation. |
| Initial state and event order | `MatchStart` now precedes discovery events; self player, race, start, units, and resources arrived. | Verify all initial player/unit events and no spurious `UnitComplete` callbacks. |
| Commands | Mining commands were accepted. Native encoding covers core unit commands. | Complete ZZZK's pool build, morph/train, rally/move/attack sequence, command latency, and failure reporting. |
| Unit query index | Spatial queries and tile/rectangle indexes were added for BWAPI `getClosestUnit`, `getBestUnit`, and area queries. | Exercise filters under fog, lifted/burrowed units, morphs, destruction, and changing ownership. |
| Zerg state | Larva-to-hatchery association, egg build type, resources, supply, upgrades, and relevant morph/construction/order flags are populated. | Validate larvae disappearing/reappearing, egg/cocoon transitions, incomplete units, and simultaneous morph queues in a full match. |
| Movement/combat flags | Zerg-normalized orders, attack animation/start/cooldown, idle, morphing, and construction classifications were corrected against BWAPI semantics. In particular, native `DroneLand` order 70 normalizes to BWAPI `PlaceBuilding` order 30 and must count as constructing; Zerg morphing uses normalized orders 42, 43, and 45, not `ZergBirth` 41. | Revalidate these fixes in a fresh process, then broaden beyond Zerg: acceleration/braking/stuck, Protoss power, Terran add-ons/lift, spell and status effects, exact velocity/angle semantics. |
| Fog and events | Show/hide/discover/evade and local destroy paths exist. | Add/verify `UnitCreate` for newly created units, enemy/neutral destruction semantics, renegade/player-left events, nukes, and save events. ZZZK's live unit callbacks are mostly empty, so this is broader-bot risk. |
| Map metadata | Tile, walkability, height, creep, resources, and start positions are available enough for initial ZZZK behavior. | Supply stable BWAPI-compatible map hash and random seed. ZZZK uses map hash for learning identity and map-specific creep workarounds; terrain libraries also key caches by map. |
| Generic game commands | Unit commands are transported; local client-info storage works inside BWAPI's client implementation. | Define support for text/print, game speed/frame skip, command optimization, user input, flags, and drawing. No UI is required, but bounded `Printf` diagnostics are useful. |
| Persistence and process environment | Not yet validated end to end. | Stage per-bot `bwapi-data/AI`, `read`, and writable `write` directories; preserve working directory; bound disk use; test learning files and helper processes. |
| Build mode | The bridge and adapter are currently development-only. | Decide how the feature is enabled, supervised, and sandboxed in production builds. Third-party bot executables are arbitrary code. |

## Proposed second target: UAlbertaBot

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

This is deliberately a broader compatibility gate. Its map initialization scans
walkability/buildability, static minerals and geysers, start locations, and base
connectivity over the whole map. Its production, worker, scouting, information,
and combat managers also rely on create/complete/morph/destroy events, fogged
enemy state, buildability, training queues, and unit searches. Drawing, local
speed, frame skip, and user-input flags may remain harmless no-ops because no UI
is required, but the config-file failure is currently reported mainly through
drawing calls, so the launcher should check the file before starting the bot.
Run one process per game, matching the upstream lifecycle limitation.

## Recommended expansion order

1. Finish and record one complete unmodified ZZZK Zerg match, including a pool,
   zergling attack, match end, reconnect, and learning-file behavior.
2. Keep the official ExampleAIClient as a deterministic transport regression
   fixture.
3. Run UAlbertaBot and CheeseBot as stock BWAPI 4.4 external executables. Together
   they broaden API coverage and add Protoss construction/power behavior.
4. Add JBWAPI/PurpleWave packaging to establish the pure-Java client family.
5. Add BWAPI4J/OpenBW variants as separate backends rather than assuming their
   native bridges match stock BWAPIClient.
6. Validate BWEM and precomputed BWTA-cache bots on a fixed map corpus.
7. Add versioned protocol/ABI frontends for old clients and binary-only native
   modules. A 32-bit surrogate is required for native x86 DLLs when SC:R is x64.

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
