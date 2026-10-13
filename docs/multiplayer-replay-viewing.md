# Multiplayer replay viewing

## Goal

A user can choose either a local `.rep` file or a replay stored by ShieldBattery, open a replay
room, invite others, and start watching together. Every viewer can use their own observer UI. The
room host controls playback speed, pause, and seeking for everyone. Viewers can chat during the
session. This follows Battle.net's [Watch with Others](https://news.blizzard.com/en-gb/article/10054757/new-replay-and-resume-features-coming-in-heart-of-the-swarm)
behavior without including its separate Take Command feature.

## Runtime model

Each client runs the existing local replay player on the same verified replay bytes. A separate
server room coordinates membership and playback state. Replay viewing does not create a game record,
use GameLoader, or establish a netcode v2 game session: those paths require a playable map, player
slots, results, and live turns, while replay commands come from the `.rep` file.

The server owns a playback epoch, target frame, paused state, speed, and controller user ID. The
host's controls update that state and are sent to the other viewers. A viewer reports its loaded
state and current frame; the room begins playback only after everyone admitted to the start has
loaded the same replay. Viewer camera, player vision, and other observer UI state stay local.

The first release admits viewers while the room is gathering or loading. Joining a running replay
requires seeking and catch-up behavior and can be added after the initial synchronized path is
verified. If the host leaves, playback pauses until the room selects a new controller or closes.

## Replay sources and access

The public source selector is a discriminated union:

```ts
type ReplaySessionSource =
  | { kind: 'game'; gameId: string }
  | { kind: 'upload'; sourceId: string }
```

For a ShieldBattery game, the server resolves the best available replay. Creating or joining a
room checks `canUserAccessReplay` for that viewer. A room invitation does not grant access to an
unlisted game's replay.

For a local file, the client uploads the `.rep` through an authenticated, size-limited staging
endpoint. The server parses it, computes its SHA-256 hash, stores it privately, and returns an
opaque, expiring source ID owned by the uploader. The room gives authorized members a short-lived
download URL. No local filesystem path or client-supplied hash is distributed to members. Staged
files need expiry and cleanup that preserve replay files referenced by actual games.

Every participant downloads the source before launch and checks its hash using the existing replay
cache. Each client then passes its own local path to `ReplayMapInfo`. The URL stays out of public
room summaries and is sent only to authorized members.

## Room and playback protocol

The replay room has its own service, API, and socket namespace. It can reuse lobby UI patterns but
not the game loader. Its lifecycle is `gathering → loading → viewing → ended`, with membership,
ready state, invitations, chat, disconnect handling, and a host-controlled start. Room events carry
a monotonically increasing revision so a reconnect can discard stale control messages and request
the current state. A playback epoch changes on seek or controller change. Within an epoch, reports
include the replay frame so drift can be measured and corrected without altering recorded commands.

The app forwards room control messages to the local DLL. The DLL reports host replay controls
originating in SC:R; followers do not apply direct timeline controls. Injected speed and seek
commands must remain local to playback and must never enter the recorded replay command stream.
Replay session load/status messages go to the replay room service, not the normal game results or
game loader endpoints.

## In-game presentation

Each viewer sees the normal replay player. Only the controller gets the play/pause and speed
buttons; for every other viewer those button slots are empty, as in Battle.net's Watch with Others.
This rule belongs to the session, not to the current replay UI's layout, so it must carry over to
any replay interface that replaces it. Session chat appears in-game, as chat does in a normal game.

## Implementation checkpoints

1. Add source types and authenticated source staging/resolution, including hash verification,
   access checks, expiry, and cleanup tests.
2. Add room membership, invitations, readiness, source handoff, lifecycle, and chat. Test access
   to listed, unlisted, and uploaded sources and the all-viewers-ready start barrier.
3. Launch the same verified replay on every client and report loaded/ended status to the room.
   Expose room creation from both the replay library and ShieldBattery game replays.
4. Synchronize host pause/speed, then seeking. Validate native command forwarding, drift recovery,
   host departure, and reconnect in two real Electron clients. Build the DLL for x64 and x86.

The runtime command injection and seek completion behavior need a focused native spike before the
fourth checkpoint. In particular, a backward seek restarts SC:R's local replay loop, so the room
must wait for the DLL's resulting frame acknowledgement before resuming followers.
