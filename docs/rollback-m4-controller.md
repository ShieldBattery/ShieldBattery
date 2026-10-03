# Rollback in live games (M4): who decides the window, and how sync checks survive it

Status: design agreed. The client core, rollback sessions and confirmed-hash reports are built
(see [rollback-m4-client-plan.md](rollback-m4-client-plan.md) for what was built, what's left
before shipping, and what follows). Not built yet: the relay's session clock and lead reports,
the player settings, and the sound hook; open questions 5-7 are for tuning and hardening.
Background: the replay harness (`game/src/rollback_harness.rs`) proves the snapshot and
re-simulation engine; a feel test on a high-APM 1v1 TvZ set the policy this document turns into
mechanisms.

At Fastest, one turn is one frame (about 42 ms), so this document counts both in frames.

## The policy being implemented

- Steady state: up to **3 frames** of remote lateness are hidden by rollback (R = 3). At R = 3
  corrections are barely visible (zergling chase: median 7 px, max 16 px); at R = 5 fast units
  visibly teleport (median 12 px, max 27 px).
- Sustained lateness beyond that is covered by **input delay** (D).
- Short bursts (loss, jitter) are covered by **rollback first**, up to a limit (**R_max = 8** by
  default), and become delay only if they persist.
- **Each player pays for their own connection.** A player with a slow or lossy link gets more
  delay and more rollback; the players they are playing against do not.

## The model: one deadline, and each player's lead

A turn's index is the frame it executes on: every step consumes exactly one turn from every slot,
so a slot's k-th turn runs on frame k on every client. A client's depth only decides how far ahead
of that frame it sends its own turn. Nothing about it needs agreement, and each player can use a
different depth (prod already does this briefly: when two relays seeded different depths at session
start, players ran at different depths for the first ~10 frames without desyncing).

That makes the relay's job a deadline rather than a depth. The session has a clock: frame F is due
at `S(F) = start + F × 41.7 ms`. **Every player's turn for frame F must reach the relay by S(F).**
A turn that makes the deadline reaches every other player after that player's own download leg, so
what each player sees depends only on their own connection.

Each player meets the deadline with some mix of two things:

- **Input delay D:** the player's commands go into a turn D frames after they are issued, so the
  turn goes out D frames earlier relative to the frame it runs on.
- **Running ahead X:** the player simulates frames X frames before the session clock (X can be
  negative, running behind). Their turns go out earlier, and everyone else's turns reach them later
  relative to their own frames, which is more rollback for them.

With `u` and `d` a player's upload and download legs to their relay, in frames:

```
deadline:        D + X >= u
rollback seen:   R = d + X
so:              D + R >= u + d     (their own RTT to the relay)
```

A player's RTT is theirs alone to spend, split between delay and rollback however they like.
`X = u, D = 0` is zero input delay with all of the RTT as rollback; `X = -d, D = u + d` is no
rollback at all, which is lockstep. Nothing one player chooses changes what anyone else sees.
Running behind gains nothing either, because the deadline still makes that player send early: it
just turns their cost into delay.

### Client: choosing the split

The client picks X and D from two lateness estimates:

- **Download lateness:** how late other players' turns reach it relative to the session clock,
  measured locally from arrival times.
- **Lead error:** how early or late its own turns reached the relay against the deadline. Only the
  relay can see this, so the relay reports it per player (below).

Each estimate has a steady level (a trailing median or high percentile over a few seconds) and
bursts above it. Download lateness is taken over the latest opponent: the rollback a client runs
is `present - confirmed`, which the latest slot sets. When every opponent makes the deadline, they
all arrive after the same download leg, so this is the same for all of them; it differs per
opponent only for one homed on another relay (one mesh hop later) or one missing its deadlines. The client sets `X = R_target - steady download lateness` and adds delay so its
steady lead error is zero with a small margin, raising D only after an increase has held for a
sustain window (2 s to start) and lowering it when the estimate has settled back. Bursts are not
chased: download bursts are rolled back up to the player's limit, and a short upload burst means a
few of this player's turns miss the deadline, which other players roll back over.

**Prediction cap:** the DLL steps the simulation whenever the game loop schedules a frame, even if
some remote inputs are missing, as long as `present - confirmed <= R_max`. Past that it stalls, as
lockstep does today. A stall is mostly the stalling player's own cost: while stalled its turns go
out late, other players roll back over them up to their own limits, and its lead error rises until
it adds delay.

**Catch-up:** a client that falls behind the session clock (a hitch, or a stall at its cap) steps
frames back to back until it is back on its target X, rather than asking anyone to wait for it.

### Player settings (advanced)

Two options, both only exposed under advanced settings:

- **Rollback target** (the `R_target` above, steady-state rollback): a few values from 0 (no
  steady-state rollback: all of the player's RTT becomes delay) to 4 frames, default 3.
- **Rollback limit** (`R_max`): how large a burst is rolled back before the game pauses instead.
  A few values up to 8, default 8, never below the target. A target and limit of 0 is lockstep for
  that player.

Both only change the player's own experience, so neither needs to match across the game. The
tenant sets the defaults and the allowed range. Not built yet: every player runs the defaults.

### Relay: deadlines instead of a depth

- **Session clock:** the authority relay fixes `start` at session start and each home relay
  measures against it.
- **Lead report:** for each player, the relay measures how early or late each of their turns
  arrived against its deadline, and reports a smoothed value back to that player (on the turns it
  forwards to them, or the control stream). This is send-phase alignment's measurement at whole-
  frame scale. It is relay-authored: the arrival time is the relay's own observation, and the only
  client input is the frame index, which the relay already tracks per slot.
- **Nothing else to size:** the lockstep law's loss, burst, jitter and delivery-lag terms existed
  so that no turn is ever late. Under rollback that margin becomes the client's own safety margin
  on its lead, chosen by how many late turns it is willing to push onto other players' rollback.
- **Ceiling:** `GAME_SYNC_SAFE_BUFFER_MAX` (14) exists only because of native 0x37's 16-slot ring.
  With native sync replaced (below) it is no longer a correctness cliff for rollback games, but
  rollback clients keep it as a cap on their pipe, so rollback never costs more input delay than
  lockstep could.

### What players get

Today the depth absorbs all lateness for everyone, sized to the worst pairwise path, so a slow
player's link sets the input delay of the whole game. In a rollback game each player's delay and
rollback come from their own link and their own setting. At the default target of 3, a player
within about 3 frames (~125 ms) of RTT to their relay plays with no added input delay: their own
commands take effect on the next frame, like single player, and other players' commands show up as
small corrections.

A side effect worth noting: a client that predicts instead of stalling keeps producing turns on
schedule, so the depth-one micro-stall ring that send-phase alignment exists to fix mostly
disappears in rollback games.

## Sync checks: replacing 0x37

Native 0x37 cannot work under rollback: it hashes the frame about to run at send time (a
predicted frame on a client running ahead), and the receiver checks it against its own ring slot
immediately, which may itself still be predicted in a 3+ player game. The relay's current
comparator already works around 0x37's quirks (reconstructing native generation ordinals, legacy vs
enhanced ordering, per-origin failure latches). Rollback games replace all of it.

Built in client slice 5 and rp2 `e4320e2`. Reports are keyed by step (the turn index) rather than
frame, since a paused game takes turns without advancing frames: step `n` is the state once every
slot's first `n` turns have run.

- **What is hashed:** a confirmed step (all inputs up to it applied, so every honest client has
  identical state). A 64-bit hash of units, bullets, economy, supply, research and the RNG, with no
  pointer values and no viewer-local state (`rollback_probe::state_hash`, verified across processes
  and against plain playback).
- **What is sent:** every 8th step from 8, once confirmed, as a field on the client's next turn
  (`Payload.state_hash`), not in the game's command stream. Relays keep reports on the mesh and
  strip them from what they forward to clients.
- **What the relay does:** the authority compares reports by step. A verdict names the player at
  fault whenever it can: a diverged minority when the rest agree, or a player who misses a report
  deadline (below), in 1v1 too. The named player's home relay evicts them and finalizes their drop, which usually scores as a
  loss. With no majority (a 1v1 disagreement, an even split) it names nobody and the game is
  voided.
- **Liveness:** the relay knows, from the inputs it forwarded, the step at which each checkpoint
  became confirmable, so it sets the report deadline itself: confirmable + 5 s. A player still
  sending turns (96 past the step) without the report is named, so withholding hashes is not a way
  to dodge detection. A player whose turns stopped is left to the leave machinery. No
  client-asserted step feeds the deadline.
- **Native sync off:** in a rollback game the DLL strips 0x37 in both directions and stands a no-op
  command in for each turn's sync, so BW's one-sync-per-turn rule never drops anyone and nothing is
  verified natively. The tenant sets the mode for the whole session, so every client switches at
  once.
- **Replays:** unaffected. Replays contain no 0x37, and playback skips sync verification.

## Mode negotiation

The tenant decides, never a player: players and modified clients must not be able to opt out. The
ShieldBattery server asks for rollback on every game it loads (`SessionRequest.rollback`), except
UMS games on EUD maps, whose triggers can write memory the snapshot doesn't cover. The coordinator
grants it only on relays advertising `rollback_v1`, keeps re-homes on them, and forces finalized
drops on; the relay applies the new comparator for that session only. A client that can't roll back
refuses the session rather than running it as lockstep. Lockstep games are untouched.
Observers never issue commands. They can run with rollback like players, or with plain lockstep plus
a larger local buffer; either way they are not required to report hashes, as today.

## Presentation (client only, no consensus)

- **Correction smoothing: tried and dropped.** A render-only prototype, since removed, replaced
  SC:R's sprite position accessors while the game layer drew, to draw a corrected unit part of the
  way back towards its previous position and ease it in. Both
  variants read worse than a snap in the feel test. The slow ease showed the unit already facing
  and animating its new state while sliding; the 2-frame ease makes units visibly speed up for a
  moment. Blending facing or animation would need display-only iscript state. At R = 3 the snaps
  are small enough to leave alone.
- **Sounds (not built yet):** record requests above BW's camera and fog gating (two wrappers above
  `play_sound`) so re-simulation doesn't gain or lose sounds as the camera moves; decide audibility
  when playing.
- **Announcements:** text lines, game messages and observer UI notifications go out when their
  frame is first simulated, like sounds. A re-simulation matches what it announces against what
  earlier simulations of the same frames announced (by kind and arguments, not exact frame, so an
  event a late command moved by a frame isn't repeated) and only lets new ones through. An
  announcement from a prediction that didn't happen can't be taken back; the engine counts those.
  Holding announcements until a frame is confirmed doesn't work with a snapshot ring: a frame whose
  prediction held is never simulated again, so it would never announce anything.

## Open questions

1. ~~`R_max = 8`: fixed, or a tenant bound like the depth bounds?~~ **Decided:** a per-player
   setting (see Player settings) with a tenant default and range, plus an env override in debug
   builds. Any R is safe for correctness, since confirmed frames don't depend on it. Under the
   deadline model a low limit mostly costs the player who chose it: a stall at the cap makes that
   player's turns late, which other players roll back over up to their own limits, and the relay's
   lead report then pushes the stalled player to add delay. Clients never report their limit to the
   relay; nothing on the relay depends on it.
2. **What triggers a raise (answered by prod data, 453 games):** today's raises mostly answer tiny
   or passing events, not sustained lateness. The median loss-driven raise follows 1 lost packet
   out of ~2,600, and 43% of path-driven raises come from a path less than 5 ms past a turn
   boundary. Any raise then holds for at least ~22 s (the lowering side keeps a 525-frame trailing
   max). A 2 s sustain window on the current target would avoid only a few of these, because the
   target already smooths its inputs over several seconds. What removes them is a raise-side margin
   (a loss-risk floor, and a path margin past the boundary like the 5.2 ms one lowering uses). The
   lockstep law is left as is: its caution is the right trade when a late turn stalls. Rollback
   games replace the law with per-player deadlines, where occasional loss and jitter cost a
   correction rather than a raise (see the model above). Report:
   `.claude-scratch/flight-analysis/report.md`.
3. **Hash cadence and deadline:**
   - A hash every 8 confirmed frames (~1/3 s). Per-frame reports add nothing, because a divergence
     persists and shows at the next checkpoint.
   - Carried as an envelope field on the turns the client already sends, the way `buffer_directive`
     rides turns, so there is no extra traffic and reports stay in order with the input stream.
   - Deadline: 5 s after the relay could first confirm the frame. A player who is still connected
     and producing turns but misses it gets a failure verdict, not just a lost vote, so withholding
     no longer silently shrinks coverage. Disconnects stay with the leave machinery.
4. **Zero added input delay:** in rp2 terms the effective input delay is depth + 1 turns. Rollback
   allows the true minimum: local commands execute on the next simulated frame (single-player
   responsiveness), and remote commands roll in whenever they arrive. Under the deadline model a
   player adds delay only for the part of their own RTT beyond their rollback target, so a player
   within ~3 frames of RTT to their relay plays with none at the default target.
5. **Steady versus burst:** the relay reports lead error and the client classifies it, since the
   split between delay and rollback is the client's decision. The steady estimate's window and
   percentile, and the sustain window before adding delay, are to be tuned in live tests.
6. **Deadline enforcement:** without it, a modified client that ignores its lead report pushes
   rollback onto other players (bounded by their limits). The strong fix: the relay replaces a turn
   that misses its deadline by more than a grace period with an empty turn, forwards the empty turn
   to every player including the sender, and the sender rolls back its own commands. Missing the
   deadline then only ever hurts the player who missed it. Hardening for later, not needed for the
   first live tests.
7. **Multi-relay sessions:** every home relay measures against the one session clock, which needs
   the relays' clock offsets (the mesh already measures RTT between them). A turn crossing the mesh
   reaches the far relay's players one mesh hop later; that hop counts as download lateness for the
   receiving players.

## Where the client cuts in (netcode v2 seams)

In netcode v2, one turn is one frame, and the lockstep "wait for every player" barrier is our own
code, not BW's. The per-frame network step runs inside `step_game_logic` (call at 0x140319c1c in
12310g x64), so every step the rollback engine runs, re-simulated or not, already passes through
our receive hook for exactly the frame being stepped.

- **Receive (`netcode_v2_receive_turns` / `TurnState::receive_turns`):** today it blocks the frame
  until every slot's turn is queued. In rollback mode it serves the frame being stepped from a
  per-frame input table (each slot's received commands, or an empty prediction) and never blocks,
  unless the client is more than `R_max` frames past its confirmed frame.
- **Dispatch (`fill_turn_dispatch`):** stays the single place command bytes reach BW
  (`player_turns[]` and the flags), whatever the source.
- **Send (`netcode_v2_send_turn` / `submit_local_turn`):** keeps the wire submission, but local
  commands go straight into the input table for the frame they will run on. The pipe
  (`latency_turns` / `outstanding_turns`) becomes the player's own delay D, chosen by the client
  (see Client: choosing the split), often the minimum.
- **Input table:** the per-slot FIFOs become frame-indexed, so a remote turn that arrives for an
  already-predicted frame lands in its slot, and the next tick re-simulates from the confirmed
  frame with it.
- **Counters keyed by frame:** the leave tracker's consumed-turn count and the sync-generation
  stamping assume one turn per frame per slot. Re-simulation calls the receive hook several times
  for the same frame, so both must count by frame number, not by call.
- **Native sync bookkeeping:** `ProcessGameCommands` notes a turn missing its 0x37 and drops the
  player for it. In rollback mode the no-op command standing in for each turn's sync keeps that
  from firing.
- **Snapshot engine:** the harness's range-list snapshot, restore, re-step loop moves out of the
  debug-only harness into a release module driven by the input table, with the harness kept as its
  replay-driven test rig.

## Build order

1. Harness: the state hash as a fingerprint column (done; verified across processes and against
   plain playback).
2. Client M4 core: drive the engine from the netcode v2 dispatch seam with the prediction cap,
   stalling beyond `R_max`; confirmed-hash reports; native sync off in rollback mode (done).
3. rp2: session mode flag and step-keyed hash comparator with relay-set deadlines (done); session
   clock and per-player lead reports in place of the buffer law (next, after rollback ships).
4. Presentation: sound hook, chat on arrival (not started; announcements are deduplicated across
   re-simulations already).
