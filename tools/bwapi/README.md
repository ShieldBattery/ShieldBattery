# BWAPI development bridge

This is an experimental BWAPI 4.4 external-client bridge for the ShieldBattery debug DLL.
It controls the local human player slot through ordinary synchronized game commands.
It is disabled by default and is compiled out of release DLLs. It is not a production bot
integration or a claim of full BWAPI compatibility.

## Verified scenarios

The initial verified scenarios used two pinned, unchanged-source Win32 clients
with BWAPI protocol version 10003:

- ZZZKBot won a complete x86 SC:R game against the built-in Terran computer.
- ZZZKBot won a complete x64 netcode v2 game against a passive Random peer,
  including race discovery, Extractor construction, synchronized combat, and
  `onEnd` while the victory dialog remained open.
- UAlbertaBot won a complete x64 netcode v2 game against a passive local Zerg
  peer with its stock configuration.

A fresh game after all adapter review fixes also verified ZZZKBot winning on
x86 against an x64 peer, with matching active-match sync probes and an automatic
winning end callback.

The [compatibility research report](../../docs/bwapi-compatibility-research.md)
records the game IDs, sync-probe boundaries, behavior exercised, learning-file
evidence, and post-terminal limitations.

For that initial checkpoint, all 17 bridge tests passed on x86 and x64, clippy
passes for both targets, formatting passes, and both `game\build.bat` outputs are fresh and
match their built DLL hashes. These are scenario results, not full API
conformance.

## OpprimoBot catalog checkpoint (2026-09-23)

[OpprimoBot sb.1](https://github.com/ShieldBattery/robotics-facility/releases/tag/opprimobot-sb-1)
is available in signed staging catalog revision 10, initially as Terran with
Bio and Defensive tags. Install it through the bot library; source builds,
patches, notices, and the full admission record live in robotics-facility.

The bridge supports Terran add-ons, Siege/Unsiege, Stim, Medic Healing, Repair,
Wraith cloak, Scanner Sweep, EMP, Defensive Matrix, and Yamato command records.
Construction snapshots preserve SCV/building and incomplete add-on relationships.
Visible but undetected units use BWAPI's partial clearance and field redaction.

The packaged executable completed combat games against ZZZKBot on x86 and x64
SC:R, with 22 and 26 matching common sync probes respectively, zero rejected
Opprimo commands, and clean natural-loss shutdown. Concurrent Terran probes also
exercised gas, add-ons, siege tanks, medics, and deliberate quit. All 34 BWAPI
regression tests pass on both architectures. These tests do not establish every
late-game spell, map, race, or multiplayer format; human difficulty is uncalibrated.

## Build the existing test bot

Install Visual Studio 2022 with C++ x86/x64 tools and CMake. From the repository root:

```powershell
git clone https://github.com/bwapi/bwapi.git .claude-scratch/bwapi-research
git -C .claude-scratch/bwapi-research checkout 7687da8abc4726f8366401f11ab648d421385793
git clone https://github.com/chriscoxe/ZZZKBot.git .claude-scratch/ZZZKBot
git -C .claude-scratch/ZZZKBot checkout 7183e37b6b416ea53c1040c83e639a3a3c395eed
cmake -S tools/bwapi -B .claude-scratch/bwapi-bot-build -A Win32
cmake --build .claude-scratch/bwapi-bot-build --config Release --target ZZZKBotClient --parallel
```

If the checkouts already exist, use them without cloning again. CMake verifies the pinned
revisions and accepts `BWAPI_SOURCE_DIR` and `ZZZKBOT_SOURCE_DIR` overrides. The bot source
is compiled unchanged; `host.cpp` delivers AIModule callbacks in an external process. CMake copies
the pinned BWAPI 4.4 `Client.cpp` into its build directory and changes only discovery: an unset
`SB_BWAPI_INSTANCE` keeps the stock global table, while a set token selects
`Local\\bwapi_shared_memory_game_list_<token>`. The upstream checkout is never modified. This
builds from source, not from an arbitrary precompiled bot DLL.
BWAPI and ZZZKBot carry LGPLv3 licenses in their upstream repositories.

## Build UAlbertaBot

UAlbertaBot is the second unchanged-source client. It already has a BWAPI 4.4
external-client entry point and exercises substantially more of the API than
ZZZKBot. Clone its pinned revision after building the Win32 BWAPI libraries
above:

```powershell
git clone https://github.com/davechurchill/ualbertabot.git .claude-scratch/ualbertabot-research
git -C .claude-scratch/ualbertabot-research checkout 558899d8793456f4a6ec4196efbb5235552e24db
cmake --build .claude-scratch/bwapi-bot-build --config Release --target BWAPI-Static BWAPIClient --parallel
cmake -P tools/bwapi/ualbertabot.cmake
```

The script verifies both upstream revisions, exports the pinned UAlbertaBot
tree into an isolated build directory, stages the same BWAPI 4.4 headers and
the generated token-aware `BWAPIClient.lib` used by ZZZKBot, and builds the upstream
Visual Studio solution as
Release Win32 with the installed VS 2022 toolset. It does not patch bot source
or configuration. The runnable tree is
`.claude-scratch/ualbertabot-build/bin`; launch from that directory so the
unmodified `UAlbertaBot_Config.txt` and its `bwapi-data` paths resolve.

Select Terran for the local player. The stock configuration chooses
`Terran_MarineRush`. UAlbertaBot only handles the first game after each process
start, so start a fresh process for every match.

## Local human-versus-bot play

Use the desktop [local launch API](../../docs/local-bots-launch-api.md). It starts
one visible player and one or more hidden bot clients, assigns isolated BWAPI
instances, and owns cleanup. Supply cached map metadata, a built external bot
executable, and a separate working profile for each simultaneous bot. No server
lobby or relay is required.

## Manual single-bot bridge test

1. Start the normal local dev services, including the renderer server. See
   [dev-env](../../.claude/skills/dev-env/SKILL.md).
2. Build the DLL with `game\build.bat` (64-bit) or `game\build.bat x86` (32-bit).
3. Launch each bot game with a unique `-sb-bwapi=<token>` argument and start its bot with the
   matching `SB_BWAPI_INSTANCE=<token>` environment variable. The token selects only that game's
   discovery table; the PID-specific shared-memory and pipe names remain BWAPI 4.4-compatible.
   `SB_BWAPI=1` remains available only for non-local legacy test launches.
4. Start `.claude-scratch/bwapi-bot-build/bin/ZZZKBotClient.exe` in a dedicated working directory.
   It retries until its selected game server is available. Use one host process per bot game.
5. Create a plain melee lobby. Select **Zerg** for the local player and add an opponent.
   ZZZKBot assumes it is playing Zerg. Start the match; the bot takes over the local player's
   units. Use the legacy unit limit while testing BWAPI compatibility.
6. Inspect the host's stdout and the session's game DLL log for `BWAPI:` messages. They report
   connection, frame progress, resources, and accepted/rejected commands. Stop the bot host
   after testing; it otherwise waits for another game.

The bridge does not pause a multiplayer simulation while the bot computes. A slow client
receives the next available snapshot when it acknowledges the previous one, so snapshots can
skip frames. An external client that attaches during startup can receive its first match
snapshot after frame zero. Commands are validated against current ownership, visibility, and
native unit identity before submission. This protects normal game progression from a
stalled/disconnected bot; it also differs from the stock BWAPI server's synchronous per-frame
behavior.

## Hidden, low-resource game clients

Launch configs can opt into `presentation: 'background'` to use a hidden 640x480
SC:R client with private canned settings, SD asset loading, muted audio, and no
ShieldBattery overlay. See [background SC:R clients](../../docs/background-scr-clients.md)
for the developer launch controls, measured savings, and remaining renderer and
multi-client lifecycle work. This mode still runs native graphics initialization.

## Compatibility boundaries

The supported target is the pinned BWAPI 4.4 client protocol version 10003 and the source
builds described above. This does not provide binary compatibility for arbitrary native
`AIModule` DLLs. Other BWAPI releases, C++ ABIs, terrain-library expectations, and
sophisticated command, query, and event semantics require separate validation. OpenBW's
implementation is useful as an engine-adapter reference; replacing SC:R with OpenBW is not
necessary for this bridge.

Unit commands and queries cover the verified scenarios but remain partial. Generic game
commands such as `LeaveGame`, drawing, local speed, and frame skip are unsupported. Native
terminal states 1 through 3 ignore queued bot commands; state 3 is victory, while state 1
(Disconnected) and state 2 are defeat. The first following client acknowledgement receives
`MatchFrame` plus `MatchEnd` with `isInGame` still true, and the next
acknowledgement receives menu state. The x64 ZZZK victory verified that `onEnd` runs
while the result dialog is open. The native End Mission UI action remains manual because
`LeaveGame` is unsupported.

The adapter reads map flags, indexed tiles, CV5 data, and minitile data through four thin
`scr-analysis` wrappers over APIs already present in the pinned samase_scarf revision;
samase_scarf itself was not changed. Verify the C++ and Rust wire layouts for x86 and x64
against the pinned headers with:

```powershell
powershell -ExecutionPolicy Bypass -File tools/bwapi/verify-abi.ps1 -BwapiRoot .claude-scratch/bwapi-research
```

The four-way verification and an independent rerun both pass for the pinned sources.

The shared interface still has BWAPI 1.16-era limits (256-square maps, 1700-unit spatial
index, 10000 unit identities per game). Extended SC:R limits need an explicit policy.
The adapter provides a partial API; unsupported commands and query fields must be considered
when choosing another bot. See the [research report](../../docs/bwapi-compatibility-research.md)
for the project comparison, compatibility gaps, and follow-up work.
