# BWAPI development bridge

This is an experimental BWAPI 4.4 external-client bridge for the ShieldBattery debug DLL.
It controls the local human player slot through ordinary synchronized game commands.
It is disabled by default and is compiled out of release DLLs. It is not a production bot
integration or a claim of full BWAPI compatibility.

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
and BWAPI client are compiled unchanged; `host.cpp` delivers AIModule callbacks in an
external process. This builds from source, not from an arbitrary precompiled bot DLL.
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
libraries used by ZZZKBot, and builds the upstream Visual Studio solution as
Release Win32 with the installed VS 2022 toolset. It does not patch bot source
or configuration. The runnable tree is
`.claude-scratch/ualbertabot-build/bin`; launch from that directory so the
unmodified `UAlbertaBot_Config.txt` and its `bwapi-data` paths resolve.

Select Terran for the local player. The stock configuration chooses
`Terran_MarineRush`. UAlbertaBot only handles the first game after each process
start, so start a fresh process for every match.

## Launch

1. Start the normal local dev services, including the renderer server. See
   [dev-env](../../.claude/skills/dev-env/SKILL.md).
2. Build the DLL with `game\build.bat` (64-bit) or `game\build.bat x86` (32-bit).
3. Set `SB_BWAPI=1` in the environment of a **new** Electron process. Existing processes do not
   inherit environment changes. Use a local test session and the debug DLL.
4. Start `.claude-scratch/bwapi-bot-build/bin/ZZZKBotClient.exe` in a dedicated working directory.
   It retries until the game server is available. Keep only one unconnected BWAPI-enabled game
   while using the stock client's automatic discovery.
5. Create a plain melee lobby. Select **Zerg** for the local player and add an opponent.
   ZZZKBot assumes it is playing Zerg. Start the match; the bot takes over the local player's
   units. Use the legacy unit limit while testing BWAPI compatibility.
6. Inspect the host's stdout and the session's game DLL log for `BWAPI:` messages. They report
   connection, frame progress, resources, and accepted/rejected commands. Stop the bot host
   after testing; it otherwise waits for another game.

The bridge does not pause a multiplayer simulation while the bot computes. A slow client
receives the next available snapshot when it acknowledges the previous one. Commands are
validated against current ownership, visibility, and native unit identity before submission.
This protects normal game progression from a stalled/disconnected bot; it also differs from
the stock BWAPI server's synchronous per-frame behavior.

## Compatibility boundaries

The first target is the pinned ZZZKBot source build and BWAPI client protocol version 10003.
Other BWAPI releases, C++ DLL ABIs, terrain-library expectations, and sophisticated combat
semantics require separate validation. OpenBW's implementation is useful as an engine-adapter
reference; replacing SC:R with OpenBW is not necessary for this bridge.

The shared interface still has BWAPI 1.16-era limits (256-square maps, 1700-unit spatial
index, 10000 unit identities per game). Extended SC:R limits need an explicit policy.
The adapter provides a partial API; unsupported commands and query fields must be considered
when choosing another bot. See the [research report](../../docs/bwapi-compatibility-research.md)
for the project comparison, compatibility gaps, and follow-up work.
