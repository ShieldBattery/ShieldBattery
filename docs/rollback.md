# Rollback netcode

How live games roll back: what each part (game DLL, rally-point2 relays, the server) does, why it
works that way, where the code is, and how to test and debug it. The module docs in
`game/src/rollback/`, `game/src/rollback_live.rs` and `game/src/netcode_v2/` cover the mechanics in
more detail; this document is the map and the reasoning that spans components.

At Fastest one step is one frame, about 42 ms, so this document counts both in steps.

## What players get

In lockstep, the latency buffer absorbs every player's lateness, sized to the worst path in the
game, so the slowest link sets everyone's input delay. In a rollback game each player's input delay
and rollback come from their own link:

- A client simulates ahead of turns it hasn't received, standing in an empty turn for each missing
  one, and rolls back and re-simulates when a real turn turns out to have commands.
- Steady lateness up to the player's **rollback target** (default 2 frames) is hidden by rollback;
  lateness beyond that becomes **input delay**. Short bursts are rolled back up to the **prediction
  limit** (8) before the game stalls.
- A player within about 2 frames (~85 ms) of RTT to their relay plays with no added input delay.
- Corrections are drawn as snaps. At a 2-3 frame rollback they are barely visible; from 4 they
  show, and at 5 fast units visibly jump. Smoothing corrections was tried and read worse than a
  snap (a unit already facing and animating its new state while sliding, or visibly speeding up).

## The model

**A step's turns are the turn index.** Every step consumes exactly one turn from every slot still
in the game, so a slot's k-th in-game turn runs on step k on every client. How far ahead a client
sends its own turn is its business alone, so depths need no agreement and can differ per player.
A paused game keeps taking turns without advancing frames, so the whole rollback timeline
(snapshots, rollback targets, the schedule) is counted in turns, never in frames.

**One deadline per turn.** The relays keep a session clock: turn n is due at the relay at
`S(n) = anchor + n × 42 ms + time the clock has stood still`. Every player's turn must reach the
relay by its deadline. With `u` and `d` a player's upload and download legs:

```
deadline:       D + X >= u        (D input delay, X how far the player runs ahead of the clock)
rollback seen:  R = d + X
so:             D + R >= u + d    (the player's own RTT to their relay)
```

A player's RTT is theirs to split between delay and rollback, and nothing they choose changes what
anyone else sees. Running behind the clock gains nothing: the deadline still makes that player send
early, which only turns their cost into delay.

## The client

### The engine (`game/src/rollback/`)

- **Snapshots are a fixed list of memory ranges** (`ranges.rs`, `snapshot.rs`). BW allocates
  nothing during play: its object pools are sized at map init and never move, so a snapshot is a
  memcpy of `(address, length)` ranges resolved once per game, plus the per-player trigger lists,
  which are copied and relinked. Copies run on helper threads (`copier.rs`).
- **A sparse ring** (`tick.rs`): a snapshot every 3 frames, enough slots that one always sits at or
  before the confirmed frame. A tick whose predictions all held restores nothing; on a
  misprediction it restores the newest snapshot at or before the bad step and re-simulates to the
  present. A step costs about 0.25-0.45 ms; a tick rolling back 2 frames costs under a millisecond,
  deep rollbacks a few.
- **Once per frame, not once per simulation.** Frames are shown and heard as they are first
  simulated, so anything that must happen once per frame is matched against what earlier
  simulations of the same frames already did: sounds (`sounds.rs`), text lines and game messages
  (`announcements.rs`), observer UI notifications (`observer_ui.rs`), and UI writes such as the
  order marker and a target's selection blink, which are logged and made again in re-simulation
  (`ui_writes.rs`). An announcement from a prediction that didn't happen can't be taken back.
- **Viewer-local state stays out of the snapshot**: the camera, the Shift+F2-F4 screen positions,
  and the local selection. Selection visuals are taken off around every snapshot and restore and
  put straight back; a restore deselects units whose slot the restore changed, and puts back a unit
  a mispredicted step had removed from the selection (`selection.rs`).
- **The state hash** (`state_hash.rs`) is a pointer-free 64-bit hash of units, bullets, economy,
  supply, research and the RNG, identical across processes and architectures for the same state.

### Driving it in a live game (`game/src/rollback_live.rs`, `game/src/netcode_v2/`)

- **The input table** (`netcode_v2/input_table.rs`) keeps every slot's turns by step. A step whose
  remote turn is missing runs with an empty turn; a turn arriving for a step that already ran asks
  for a rollback only if it differs from that.
- **The network step runs inside the simulation step.** `step_game_logic` calls BW's network step,
  which runs our IN hook, dispatches commands, and flushes local turns through the OUT hook. So in a
  re-simulated step the send side does nothing, and the IN hook's per-tick work (game start signal,
  chat, skins, pumps, self-close) runs once per tick rather than once per simulated step.
- **The replay recorder** is a growable buffer that a restore must never touch: it stays out of the
  snapshot, and only a step's confirmed simulation records, so a replay holds exactly the confirmed
  commands at their frames.
- **Leaves are a fence.** A leave can't be undone (BW's departure handling touches state outside
  the snapshot), so it applies only at its own step and only once every earlier turn is known, and
  the step after it is snapshotted as a barrier no rollback crosses. Rollback sessions always use
  finalized drops, which carry the step the leave belongs to.
- **Game end waits for confirmation.** The result check timer is in the snapshot; the victory and
  defeat dialogs a step asks for open only once that frame is confirmed, and the result report reads
  the newest confirmed frame's outcome.
- **Native sync (0x37) is off.** It hashes state at send time (a predicted frame on a client
  running ahead) and drops a player whose turn lacks one, and re-simulation can change the inputs it
  captures. In a rollback game the DLL strips 0x37 both ways and stands a no-op in for each turn's
  sync command; the relays compare state hashes instead (below).
- **Stalls.** Past the prediction limit the client stalls inside BW's own wait for turns, as
  lockstep does. A client stalled on turns its relay already holds is waiting on its own downlink:
  each relay stamps every packet with how many of every slot's turns it holds
  (`turns_complete`), and such a client keeps sending its own turns on schedule (up to 48) so its
  starved downlink doesn't stall everyone else. A stamp that hasn't changed for ~500 ms counts as
  the session waiting, which sends a silent link to the ordinary drop path.

### Pacing (`game/src/rollback/pacing.rs`)

The first 24 steps run in lockstep with the relay's buffer, which lines the clients' game loops up.
From then on the client paces against the session clock through its home relay's lead reports:

- It keeps the time it means turn 0 to have left by; turn n leaves n steps later, and frame k is
  stepped when turn `k + pipe` is sent.
- Each report moves that schedule earlier by the 90th percentile of its turns' lateness plus a 3 ms
  margin, so about one turn in ten arrives late and is rolled back over by the others. Whole steps
  apply at once (up to two extra steps a tick, or a step put off); the rest is slewed at up to 1 ms
  a tick in the game loop's own timing. One report moves the schedule by at most a step, except
  until a full window has corrected it: the player at the far end of the lockstep start's slowest
  round comes out of it behind the clock, and the clock stops for everyone until that is corrected.
- A stop of the session clock moves the schedule by exactly the stopped time, so nobody sprints to
  make up time the session never ran. A stall at the client's own limit holds the schedule
  provisionally, and the first report on turns sent after it undoes only as much of the hold as it
  measures late.
- A phase nudge keeps the game loop's ticks centered in their steps, since a tick near a step's edge
  flips between stepping an extra frame and putting one off.
- **The split** between delay and rollback: the lead (how far the client runs ahead of the
  schedule) follows the rollback it measures over 2 s windows, one sample each time the newest
  fully known step advances: the most rollback any tick ran with since the last one, so an outage
  counts once and turns arriving several at a time count by the tick just before each batch. It
  drops when the window's median exceeds the target (or its
  90th percentile exceeds the target plus one frame), at most 2 frames a window, and rises when even
  the 90th percentile is short, by the shortfall, taking effect a frame every six ticks. The
  rollback measured is signed: turns already in for frames the client hasn't reached are headroom,
  which is the only way a target of 0 sees delay it doesn't need. A rise still being taken up
  counts as already in effect, so the next window doesn't make it again. The pipe (`buffer - lead`)
  is capped at 14 turns, lockstep's deepest buffer, so rollback never costs more delay than
  lockstep could.

Send-phase alignment and the lockstep buffer law are off in rollback sessions after the start: the
lead report sets each client's send timing outright, and the buffer only matters for the lockstep
start.

## The relays (rally-point2)

- **The session clock.** The relay that starts the session anchors it at the instant the lockstep
  start's last step becomes confirmable there, so nobody is asked to be earlier than the session has
  shown it can be. The clock may not run more than `STALL_SLACK_STEPS` (6, where clients stall: the
  limit less the steady rollback) past the newest confirmable step; when it would, it stands still.
  One rule covers drop waits, hung clients and outages.
- **Stops are kept by step**, so which turns a stop moves is fixed by the stop itself whatever order
  a relay learns of it, and a relay measures a turn only once its deadline is final. A player whose
  turns run persistently late still reads their real lateness and corrects.
- **Copies merge.** Every relay in the session heartbeats its copy of the clock (~250 ms) and merges
  every copy it receives by taking the later deadline per step, never moving a deadline it already
  holds as final. The merge is order-free, so an authority handoff needs no protocol: a new
  authority decides from its own copy and learns any stop it missed from the next heartbeat. The
  cost is an occasional needless stop around a handoff, which every client takes together.
- **Lead reports.** Each home relay measures each of its slots' turns against their deadlines
  (relay-stamped arrival, the only client input being the seq) and sends the slot the median and
  90th percentile over the last 24 steps, every 12 steps, with the clock's stopped time so far.
- **Congestion control** has a 128 KiB window floor on every link: random loss on a lossy link read
  as congestion would otherwise throttle the turn stream below its rate.
- **Hash comparison.** Clients hash every 8th step from step 8 once it is confirmed and send the
  hash on their next turn (`Payload.state_hash`); relays keep reports on the mesh and strip them
  from what clients receive. The authority judges a step once every required slot reported, or 5 s
  after the step became confirmable. It names a diverged minority, and any slot that kept sending
  turns (96 past the step) without its report, so withholding hashes isn't a way to hide. The named
  slot's home relay closes its link (`DESYNC_EVICTED`), refuses redials and finalizes its drop. With
  no majority (a 1v1 disagreement, an even split) nobody is at fault, every player is evicted, and
  the server voids the game. A client whose link ends this way shows a terminal notice ("Game
  desync detected", or "Disconnected from the game" otherwise) with a Leave button.

Observers roll back like players, and every client needs their turns, but the relays' confirmable
step (which drives the clock and the hash deadlines) leaves them out.

## Who gets rollback

The server decides for the whole session, never per player, so no player or modified client can opt
out. With `SB_RP2_ROLLBACK=true` it asks for rollback on every game it loads
(`server/lib/netcode-v2/`), except UMS games on EUD maps, whose triggers can write memory the
snapshot doesn't cover (`canRollBack` in `server/lib/games/game-loader.ts`). The coordinator grants
it only on relays advertising `rollback_v1`, keeps re-homes on them, and forces finalized drops on.
The granted mode rides the player's netcode v2 setup to the DLL (`arm_for_session`).

- A DLL missing any analysis only rollback needs refuses the session rather than running it as
  lockstep (`rollback_live::supported`).
- A DLL that predates rollback ignores the flag, runs lockstep with native sync on, and drops the
  rollback players at the first sync check (~1 s in). There is no guard against this, since clients
  always update; it only happens with a stale client pointed at a server running rollback.

## Settings and UI

- **Rollback balance** (System settings, 0-4, default 2) is the player's rollback target. The DLL
  reads it from the local settings the app sends. The prediction limit is 8 for everyone.
- **The network quality chip** (`overlay-ui/src/net_quality.rs`) replaces SC:R's turn rate text in
  rollback games, under the same conditions (ShowTurnRate on, multiplayer, not a replay). D is the
  pipe minus one (0 means no added delay); R is a high percentile over the last few seconds of how
  far the shown frame is past the newest fully known step. The bars take the worse of D (0-1, 2-3, 4-6, 7+) and
  R (0-1, 2-3, 4-5, 6+).

## Observability

- **DLL log:** every 720 ticks a `Live rollback over 720 ticks` summary: predicted steps, rollbacks
  and their depth, lead and pipe, catch-ups and hold-backs, schedule corrections, the session
  clock's stopped time, lead report figures, tick and frame costs. "Ticks at the limit" counts the
  game loop's polls while stalled (about every 3 ms), and the first summary includes the end of the
  lockstep start; the session clock's stopped time is the better measure of stalls.
- **Flight recordings** (`/internal/games/<id>/artifacts`): the relays' `session_clock_anchored` and
  `session_clock_stopped` events, per-slot lateness and link samples, and each client's game-long
  rollback stats (histograms of rollback and pipe, rollbacks, mispredictions, catch-ups, holds,
  lead reports, worst ticks), which clients send every 30 s and before leaving. A slot reporting no
  rollback stats in a rollback session is not running rollback.
- **Server:** clients post the same stats at game end to `POST /games/:gameId/rollback-stats`,
  stored in `game_rollback_stats` for queries across games.

## Testing and debugging

Debug DLLs read these from the environment (release DLLs run the defaults):

| Variable                                 | Effect                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `SB_ROLLBACK_PREDICT=<limit>`            | prediction limit (0 predicts nothing, like lockstep)               |
| `SB_ROLLBACK_TARGET=<frames>`            | rollback target, overriding the setting                            |
| `SB_ROLLBACK_MIN_BUFFER=<turns>`         | act as if the relay asked for at least this buffer                 |
| `SB_ROLLBACK_SHADOW=<depth>`             | also roll back at least this far every tick, to exercise re-sim    |
| `SB_ROLLBACK_LIVE_DELAY=<storm>:<n>,...` | hold received turns of those slots back n frames (a slow downlink) |
| `SB_ROLLBACK_SEND_DELAY=<n>[@<frame>]`   | hold own sends back n frames from a frame (240 if unset)           |
| `SB_ROLLBACK_MONKEY=<apm>`               | random selects and right clicks, for unattended games              |
| `SB_ROLLBACK_WITHHOLD_HASHES_FROM=<n>`   | stop sending hash reports from step n, to exercise the verdict     |
| `SB_ROLLBACK_SNAPSHOT_SPACING=<frames>`  | snapshot spacing                                                   |

Two dev clients on one machine always get a buffer of 1 from the relay, and turns never arrive
late on loopback, so a local game rolls back only with `LIVE_DELAY`, `SEND_DELAY` or
`MIN_BUFFER`. The knobs add delay the relay can't see when it sizes the start's buffer, so they
show start stalls real sessions don't.

Replay-driven tools, each documented at the top of its module:

- **The harness** (`rollback_harness.rs`, `SB_ROLLBACK_HARNESS*`, `SB_ROLLBACK_DELAY`) plays a
  replay with forced rollback and compares every confirmed frame against plain playback.
  `SB_ROLLBACK_AUDIT_FRAME` and `SB_ROLLBACK_DUMP_FRAME` find state a re-simulation doesn't
  reproduce (memory outside the snapshot); `SB_ROLLBACK_EXTRA_RANGES` tries adding ranges.
- **The probe** (`rollback_probe.rs`, `SB_ROLLBACK_PROBE*`) logs per-frame state hashes to CSV for
  comparing clients or runs.
- **The soak** (`rollback_soak.rs`, `SB_ROLLBACK_SOAK*`) runs production replays unattended under
  randomized settings; the `rollback-soak` skill has the method.
- **The bench** (`rollback_bench.rs`, `SB_ROLLBACK_BENCH`, built with `cargo build --profile
bench-dll`) times restores, snapshots and steps at fixed depths and can sample a profile. Machine
  state drifts by 15% or more over hours, so compare a change only against an interleaved baseline.

## Known gaps

- **Deadline enforcement.** A turn that misses its deadline is still waited for (by the clock up to
  the slack, by other clients up to their limits). Enforcement would have the relay substitute an
  empty turn past a grace period, so a late or modified client only hurts itself. The tradeoff: the
  late player's units sit idle and their client snaps forward, where a stall costs everyone a
  little and the late player nothing. A per-player stall budget (stall within it, enforce past it)
  is one middle ground. A local hitch (exclusive fullscreen losing focus to a screenshot overlay
  costs ~0.4 s) is the common case it would cover.
- **Observer departures** wait for the same 45 s drop unlock as players', freezing the players
  though an observer can't affect the game.
- **The sound hook.** Sounds' audibility is decided by BW's camera and fog gating at simulation
  time, so a re-simulation with the camera elsewhere can gain or lose a sound. Gating should move to
  playback.
- **Settings and tuning:** the prediction limit is fixed at 8 for everyone (the rollback target
  has its setting, Rollback balance; the limit has none). The lead windows and margins are tuned on
  a handful of staging games.
- **`/netstat`** shows lockstep's view; a rollback view (lead error, pipe, rollback per opponent)
  hasn't been designed.
- **The native 0x37 path** can go once every game rolls back.
- **Performance ideas measured but not shipped:** applying late selection-only turns on arrival
  instead of rolling back (31-42% fewer rollbacks, needs a design for replay recording and
  re-application); leaving never-used pool entries out of snapshots with page watching (~17%,
  fragile); skipping redundant minimap terrain redraws in re-simulated steps (~73 µs a step); fast
  sprite position getters (~10% a re-simulated step, bypasses an anti-tamper check); copying the
  last snapshot while the frame draws (forward ticks −36%, unvalidated with selections). Dead
  ends: comparing before copying, non-temporal or AVX copies, wider or adaptive snapshot spacing.
