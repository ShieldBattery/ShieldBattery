# Local bot game launch API

The desktop main process owns local practice sessions. The UI supplies an installed
map and bot selection; it does not create a server lobby, generate relay keys, or
launch processes itself. One session contains one visible human client and one to
seven hidden SC:R clients, each paired with an external BWAPI bot.

This implementation requires a development DLL because the BWAPI bridge remains
experimental and compiled out of release builds. Catalog downloads, installation,
rating recommendations, presets, and the user-facing screens are separate work.

## Renderer contract

Use `TypedIpcRenderer` from `common/ipc.ts`:

- `localGameStart(request: LocalGameRequest): Promise<LocalGameStatus>` starts loading
  and returns the session and game-instance IDs. Rejection means validation or launch
  failed; later failures arrive through the status event.
- `localGameStatus` reports `launching`, `playing`, `stopping`, `finished`, or `error`.
  The error field contains a displayable diagnostic. Subscribe before starting.
- `localGameGetStatus()` retrieves the current/latest session snapshot.
- `localGameStop()` cancels loading or stops the match and waits for owned processes
  to exit. Leaving the visible game also cleans up its bots automatically.

Types live in `common/games/local-game.ts`. No SB account or user ID is required.
The native game receives session-scoped player identities, which must never be
interpreted as real SB accounts. Local game status is explicitly excluded from
server reporting and local results do not affect ladder ratings.

```ts
const status = await ipcRenderer.invoke('localGameStart', {
  map: downloadedMap,
  player: { name: 'Player', race: 'p' },
  bots: [
    {
      id: 'zzzkbot',
      name: 'ZZZKBot',
      race: 'z',
      executable: 'C:\\Bots\\ZZZKBotClient.exe',
      workingDirectory: 'C:\\BotProfiles\\practice\\zzzkbot',
    },
  ],
})
```

The developer console exposes equivalent helpers through `window.__sbDebugGame`:
`startLocal(request)`, `localStatus()`, `stopLocal()`, and `queryGameState(gameId)`.
The latter can query either the visible or hidden client using the returned IDs.

## Inputs and restrictions

`map` is cached `MapInfoJson`. Its file must already exist in the app's map store
and pass its content-hash check. Launch never downloads a missing map. Supported
modes are melee and free-for-all, with legacy unit limits, non-EUD maps up to
256x256, and enough start locations for all participants.

The human may select any race, including Random. Each bot must have a concrete
supported race selected by the caller. The launch API cannot infer supported races
from arbitrary executable files; the catalog/UI must use reviewed bot metadata.
Names currently accept 1–24 printable ASCII characters.

Bot executables and working directories must be absolute existing paths. Optional
`args` are individual arguments passed without a shell. Launching a bot executes
native code as the current user; this is not a sandbox. Only launch packages the
user has installed or explicitly chosen to trust.

Each bot's working directory is its writable profile, including any required
configuration and initial data. The launcher neither deletes nor migrates these
files. Give concurrently launched instances separate profiles if their storage
format does not support concurrent writers. Logs go under
`<userData>/logs/local-games/<sessionId>/`.

## Bot connection and lifecycle

Build the external client using `tools/bwapi/CMakeLists.txt`. Its generated BWAPI
client source supports `SB_BWAPI_INSTANCE`; the supervisor sets a unique token for
each bot and passes the same token to its SC:R bridge. Arbitrary stock BWAPI
executables that only scan the global discovery table cannot attach to these
isolated sessions. The existing ZZZKBot source itself remains unchanged. See the
BWAPI tools README for build instructions and modified-library provenance.

Turn/lobby/skin/chat traffic and game-to-app control both use Windows named pipes.
They need no TCP/UDP endpoint, relay, server credentials, or internet connection.
The app UI may maintain its ordinary service connections independently of the game.
SC:R also creates internal loopback sockets for native services. Its telemetry DNS
lookups are suppressed; see [native network research](scr-native-network-research.md).
This does not constitute a general network sandbox.

The visible client retains normal replay saving. Hidden clients suppress replay
saves and LastReplay replacement. Local games do not upload replays or results.
Bot windows stay hidden; native rendering remains capped at 30 FPS for sync safety.

The supervisor cancels the whole session on a bot/client failure. It does not yet
replace a failed bot or let a partial session continue. Bot subprocess monitors
terminate their bot when app IPC closes; local SC:R clients likewise exit on losing
their app control pipe. Startup has a timeout and cleanup is idempotent. The current external-process
monitor owns the directly spawned executable only. Bots that start detached child
processes need additional process-tree ownership before they can be supported with
the same cleanup guarantee.

Anonymized opponent names and replay identity metadata have not been implemented
by this launch API. Supply real bot names for now; the UI should not advertise
anonymity until replay attribution is wired up.

## Verification, 2026-09-21

- A logged-out desktop session started a visible x64 human versus hidden ZZZKBot
  using cached Fighting Spirit, without a server lobby, account, or relay.
  Native exit reported a normal finish and removed the associated bot processes.
- A 32-bit session ran one visible player and two hidden ZZZKBots, each with its own
  bridge token and working directory. All three sync probes agreed through frame
  1,680; both bots issued accepted commands. Terminating the owning Electron app
  removed all three SC:R clients, both external bots, and both monitor processes.
- The live x64 hidden client, including the BWAPI bridge and capped native rendering,
  measured 4.42% of one CPU core over 30 seconds (323 MiB working set, 402 MiB private).
  This excludes the external bot and does not predict expensive bots or late games.

These are targeted smoke tests, not broad bot compatibility certification. Complete
physical offline operation of the renderer/app shell and installed-bot management
remain separate from this cached-map, named-pipe launch path.
