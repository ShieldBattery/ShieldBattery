# Multiplayer replay viewing

## Goal

A user can select a local `.rep` file or a ShieldBattery-hosted replay, create a replay lobby,
invite others, and watch it together. The host controls playback for everyone. Each viewer keeps
their own camera, vision, and observer UI. Viewers can chat in-game. The follower's replay play,
pause, and speed button positions are empty, as in Battle.net's Watch with Others.

## Lobby model

Replay viewing uses the existing lobby service, routes, chat, invitations, membership, and host
transfer. The create form offers **Select replay** below **Select map**. A replay lobby carries a
replay source in place of a map. Its room shows one viewer list, replay metadata, a **Start
watching** action, and loading progress. Map settings, teams, races, and observer slot controls do
not apply. A replay run creates no game record or results.

An existing gathering lobby starts in game mode. Its host can choose a replay in Game setup to
switch to replay mode, or choose a map in Replay setup to switch back. The lobby ID, visibility,
invitation link, chat, and members persist through either change. The public lobby preview may show
the map, replay players, and current members. A replay tied to a ShieldBattery game uses that game's
library map image when available. Other replays use a thumbnail rendered from the embedded map;
this rendering needs the same `SB_SPRITE_DATA` assets as map image generation.

The first release allows joining while the lobby gathers. The countdown locks the viewing group.
Each viewer downloads the same replay, verifies its SHA-256 hash, launches it locally, and holds at
frame zero. The server starts playback when every viewer reports ready. A failed or timed-out load
cancels the run. Closing a replay reports that viewer finished; the lobby regroups after all viewers
have closed it.

## Replay sources and access

The source selector is a discriminated union:

```ts
type ReplaySessionSource = { kind: 'game'; gameId: string } | { kind: 'upload'; sourceId: string }
```

For a ShieldBattery game, the server resolves a stored replay and checks the host's access when
selecting it. Membership in the resulting lobby grants session access to its bytes, including when
the source game is unlisted and the replay lobby is public. A local file is staged
through an authenticated, size-limited upload. The server parses it, hashes it, stores it privately,
and returns an opaque expiring source ID. The lobby issues short-lived downloads to its members.
Nonmembers cannot request the download or an embedded map thumbnail. Local paths and download URLs
stay out of public lobby summaries. Retention cleanup preserves staged files still referenced by a
lobby. The viewer sees byte progress while downloading; cached replays skip the download.

## Playback protocol

The Electron app launches the normal replay player with a session marker. The injected DLL pauses
on the first logic frame and reports readiness. The lobby start event releases all viewers. The
host's native replay commands are reported through the app to the lobby service, which broadcasts
playback state. Followers discard direct timeline commands, and their pause and speed button
positions are empty. Session commands stay local to replay playback and do not enter the recorded
replay stream. A host transfer pauses playback and assigns control to the new host. Messages typed
in the game's chat box use the lobby chat channel; lobby messages appear in the game's text log.

Seeking uses a coordinated epoch: the host's native seek request pauses all viewers, sends a
target frame, and waits for each game to acknowledge the frame after its local seek. Backward
seeks use the same barrier. The lobby then restores the speed and pause state from before the
seek. A reconnect receives the current target and epoch in the lobby initialization event.
The DLL retries its frame acknowledgment while a seek remains active. Periodic frame reports from
every viewer let the server detect drift and correct it with the same coordinated seek barrier.
Camera and vision changes remain local.

## Verification

Two real Electron clients have watched local and ShieldBattery game replays together using x64 and
x86 DLLs. Both acknowledged forward and backward seeks at the same frame. A viewer reconnected
during a seek and received the active seek state; repeated acknowledgments held the barrier until
both viewers were ready. A deliberately divergent frame report caused a coordinated correction.
Host transfer paused playback and transferred the replay controls. In-game chat reached the lobby
through the native text box, and lobby chat appeared in the game. Closing each replay returned the
viewers to the gathering room.

Two development clients switched a public lobby from map to replay and back while keeping the same
ID and members. A fresh replay download showed viewer progress from 0% through 97%, and both
clients reached playback. The upload endpoint rejected arbitrary bytes named `.rep` with
`InvalidReplay`. Service tests cover member downloads in both public and unlisted lobbies, and
reject nonmember downloads and thumbnail requests. An authenticated download matched the expected
size and SHA-256 hash; a deliberately incorrect hash made the viewer reject the file and cancel the
run. The embedded map parses correctly, but the development server lacks `SB_SPRITE_DATA`, so JPEG
rendering still needs verification in an environment with those assets.
