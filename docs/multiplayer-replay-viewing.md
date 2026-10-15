# Multiplayer replay viewing

## Goal

A user can select a local `.rep` file or a ShieldBattery-hosted replay, create a replay lobby,
invite others, and watch it together. The host controls playback for everyone. Each viewer keeps
their own camera, vision, and observer UI. Viewers can chat in-game. The follower's replay play,
pause, and speed button positions are empty, as in Battle.net's Watch with Others.

## Lobby model

Replay viewing uses the existing lobby service, routes, invitations, membership, and host
transfer. The create form offers **Select replay** below **Select map**. A replay lobby carries a
replay source in place of a map. Its room shows one viewer list, replay metadata, a **Start
watching** action, and loading progress. Map settings, teams, races, and observer slot controls do
not apply. A replay run creates no game record or results. Replay chat appears only in the native
game text log and uses green text for the sender's own messages.

An existing gathering lobby starts in game mode. Its host can choose a replay in Game setup to
switch to replay mode, or choose a map in Replay setup to switch back. The lobby ID, visibility,
invitation link, chat, and members persist through either change. The public lobby preview may show
the map, replay players, and current members. A replay tied to a ShieldBattery game uses that game's
library map image when available. Uploaded replays are matched against library maps by their
embedded scenario and use the library image when it matches. Other replays use a thumbnail rendered
from the embedded map; this rendering needs the same `SB_SPRITE_DATA` assets as map image generation.

The first release allows joining while the lobby gathers. The host can start without viewers
marking ready. The countdown locks the viewing group.
Each viewer starts downloading the selected replay while the lobby gathers, verifies its SHA-256
hash, and sees download progress or a full ready bar. Starting playback uses the cached file,
launches it locally, and holds at frame zero. The server starts playback when every viewer reports
ready. A failed or timed-out load cancels the run. Closing a replay reports that viewer finished;
the lobby regroups after all viewers have closed it.

Game setup has an **Up next** queue with **Add map** and **Add replay**. The host can arrange maps
and replays in one order. After a game or replay ends, the lobby advances to the next queued source
while keeping its ID, visibility, invites, and members. Queued local replays are staged on save and
remain accessible to lobby members when their turn comes. Replay rows use the map image with a play
icon overlay and show only the map name. Members can request extracted map previews for queued
replays when no matching library image is available.

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
lobby or its queue. The viewer sees byte progress from selection or joining; cached replays show a
full ready bar.

For a stored ShieldBattery game replay, the replay's embedded slot IDs identify accounts only when
they match participants in the game record. An uploaded local replay gets the same attribution only
if its bytes match a replay stored for that game and the selecting user can access it. Player names
then link to profiles. Ranked games show each player's division and pregame MMR from the rating
change recorded for that match. Players still in placements have an unrated icon and no MMR value.

## Playback protocol

The Electron app launches the normal replay player with a session marker. The injected DLL pauses
on the first logic frame and reports that it has loaded. The lobby start event releases all viewers.
The host's native replay commands are reported through the app to the lobby service, which broadcasts
playback state. Followers discard direct timeline commands, and their pause and speed button
positions are empty. Session commands stay local to replay playback and do not enter the recorded
replay stream. A host transfer pauses playback and assigns control to the new host. Messages typed
in the game's chat box use a separate replay chat event. They appear only in the viewers' native
game text logs, with the sender's own line green.

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
Host transfer paused playback and transferred the replay controls. In-game chat stayed in the native
game text log. Closing each replay returned the viewers to the gathering room.

Two development clients switched a public lobby from map to replay and back while keeping the same
ID and members. A fresh replay download showed viewer progress from 0% through 97%, and both
clients reached playback. The upload endpoint rejected arbitrary bytes named `.rep` with
`InvalidReplay`. Service tests cover member downloads in both public and unlisted lobbies, and
reject nonmember downloads and thumbnail requests. An authenticated download matched the expected
size and SHA-256 hash; a deliberately incorrect hash made the viewer reject the file and cancel the
run. The embedded map parses correctly, but the development server lacks `SB_SPRITE_DATA`, so JPEG
rendering still needs verification in an environment with those assets.

Exact scenario matching was checked with a Bottleneck replay and installed library map, which
produced identical SHA-256 hashes. A different installed map did not match.

The development clients use separate replay caches when launched with different `SB_SESSION`
values. In a two-client run, the host started a replay with an unready viewer, and both clients
downloaded independent copies with identical size and SHA-256 hash. A native screenshot showed the
sender's line in green; logs showed the other viewer received the same line without the self color
flag. Neither lobby transcript contained the in-game line. The replay ended normally, returning
both clients to the gathering room.

On the mixed-queue branch, two Electron clients showed a ready download bar before **Start
watching**. The host switched the same lobby from replay to map mode; Game setup displayed **Add
map** and **Add replay** together. The host saved a replay followed by a map through the client
action, reopened Game setup, added another local replay with **Add replay**, and saved all three
entries. Both clients showed the updated queue. A service test exercised game → replay → game queue
advancement and authenticated viewer download of the queued replay.
