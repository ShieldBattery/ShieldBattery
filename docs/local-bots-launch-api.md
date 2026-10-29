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

Each bot may supply an optional `replayName` alongside its in-game `name`, using
that same 1-24 printable-ASCII limit. Omit it to keep the in-game name in the
replay. The practice library provides real catalog/local-build names separately
from concealed display names, deduplicating each set against the human and other
bots. No renderer-side replay rewrite is needed.

The game DLL maps replay names by the session user ID to the randomized game
player slot. While saving, it temporarily substitutes names in the replay header
and restores them afterward. Live player names remain concealed, including for
saves made before the match ends. This covers SC:R's LastReplay/autosave writer
and leaves hidden clients' replay suppression intact.

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

## Desktop bot library and practice UI

The app owns a bot library in `app/bots/` and the renderer's Practice tab (`/play/practice`,
`client/practice/`) drives it over the typed IPC channels in `common/ipc.ts` (`botLibrary*`,
`practice*`, `mapStoreCheckMaps`). Shared types live in `common/bots/`: catalog and package
descriptors mirror the robotics-facility metadata schema, `bot-view.ts` derives per-bot readiness,
and `practice-logic.ts` holds pool readiness, the random draw, and rating-based recommendations.

Everything is stored under `<userData>/bots/` (`bots-<SB_SESSION>/` for a namespaced dev
instance): `library.json` (installed releases, local builds,
per-bot Java overrides), `catalog.json` (the last catalog served for the configured URL, kept
as the signed document so its signature is checked again on every load),
`packages/<botId>/<releaseId>/` (immutable extracted packages), `profiles/<key>/work[-N]/`
(writable working copies that hold learning data), `downloads/` (in-progress archives), and
`practice.json` (setup, presets, cached ladder pool, known maps, and the history of practice
games, including the real identity behind a concealed opponent and the saved replay path).

Catalog URL: `SB_BOT_CATALOG_URL`, else the staging CDN for development builds and the production
CDN otherwise. Installing downloads to a scratch file, checks size and SHA-256, extracts through
entry-name and size guards, verifies the archive's `package.json` against the catalog's
descriptor and manifest hash, then promotes the directory atomically. A failure keeps whatever was
installed before.

`practiceGameStart` accepts library bot keys rather than paths: the main process resolves the
executable (or `java.exe` plus `-jar`), arguments, and working copy, leases the bots while the
session runs, and delegates to the launch API above. A concealed practice opponent is given the
in-game name `Practice bot`; the practice history keeps the drawn bot's identity for the result
screen. The saved replay itself receives the real names through `replayName`.
