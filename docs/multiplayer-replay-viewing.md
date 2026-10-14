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

The first release allows joining while the lobby gathers. The countdown locks the viewing group.
Each viewer downloads the same replay, verifies its SHA-256 hash, launches it locally, and holds at
frame zero. The server starts playback when every viewer reports ready. A failed or timed-out load
cancels the run. Closing a replay reports that viewer finished; the lobby regroups after all viewers
have closed it.

## Replay sources and access

The source selector is a discriminated union:

```ts
type ReplaySessionSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'upload'; sourceId: string }
```

For a ShieldBattery game, the server resolves a stored replay. Joining checks each viewer's own
access; a lobby invitation cannot grant access to an unlisted game's replay. A local file is staged
through an authenticated, size-limited upload. The server parses it, hashes it, stores it privately,
and returns an opaque expiring source ID. The lobby issues short-lived downloads to its members.
Local paths and download URLs stay out of public lobby summaries. Retention cleanup preserves
staged files still referenced by a lobby.

## Playback protocol

The Electron app launches the normal replay player with a session marker. The injected DLL pauses
on the first logic frame and reports readiness. The lobby start event releases all viewers. The
host's native replay commands are reported through the app to the lobby service, which broadcasts
playback state. Followers discard direct timeline commands. Session commands stay local to replay
playback and do not enter the recorded replay stream. A host transfer pauses playback and assigns
control to the new host.

Direct seeking is blocked for now so one viewer cannot diverge from the others. Seeking needs a
coordinated epoch: pause all viewers, send a target frame, wait for frame
acknowledgements after each client's seek (including backward seeks that restart replay logic),
then resume. Periodic frame reports should detect drift and correct it without changing recorded
commands. Reconnect must restore the current playback state and epoch. Camera and vision changes
remain local.

## Remaining implementation checkpoints

1. Verify pause and speed propagation in two real Electron clients, including host transfer and
   follower input rejection.
2. Add seek dispatch, per-viewer frame acknowledgement, drift correction, and reconnect recovery.
3. Hide follower timeline buttons while keeping their positions empty. Route session chat through
   the in-game chat UI and the lobby chat channel.
4. Translate new UI strings and verify local and hosted sources, access control, load failure,
   replay closure, and both x64 and x86 DLLs before review.
