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

- Steady state: up to **2 frames** of remote lateness are hidden by rollback (R = 2), with a third
  as insurance against small delays. At R = 3 corrections are barely visible (zergling chase:
  median 7 px, max 16 px); from R = 4 they show, and at R = 5 fast units visibly teleport (median
  12 px, max 27 px). (The target was 3 until the 2026-10-04 staging tests, where a client sitting
  at 3 spent much of its time at 4.)
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
at `S(F) = start + F × 42 ms`. **Every player's turn for frame F must reach the relay by S(F).**
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
  steady-state rollback: all of the player's RTT becomes delay) to 4 frames, default 2.
- **Rollback limit** (`R_max`): how large a burst is rolled back before the game pauses instead.
  A few values up to 8, default 8, never below the target. A target and limit of 0 is lockstep for
  that player.

Both only change the player's own experience, so neither needs to match across the game. The
tenant sets the defaults and the allowed range. Built: the target, as the System settings'
Rollback balance slider. Not built yet: the limit, which every player runs at the default.

### Relay: deadlines instead of a depth

- **Session clock:** the authority relay anchors it when the lockstep start ends, every home relay
  keeps a copy, and it stops while the whole session is stalled. See
  [The session clock and lead report](#the-session-clock-and-lead-report).
- **Lead report:** for each player, their home relay measures how early or late each of their
  turns arrived against its deadline, and reports a smoothed value back to that player on the
  control stream. This is send-phase alignment's measurement at whole-frame scale. It is
  relay-authored: the arrival time is the relay's own observation, and the only client input is
  the turn's seq, which the relay already tracks per slot.
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
rollback come from their own link and their own setting. At the default target of 2, a player
within about 2 frames (~85 ms) of RTT to their relay plays with no added input delay: their own
commands take effect on the next frame, like single player, and other players' commands show up as
small corrections.

A side effect worth noting: a client that predicts instead of stalling keeps producing turns on
schedule, so the depth-one micro-stall ring that send-phase alignment exists to fix mostly
disappears in rollback games.

## The session clock and lead report

Status: built. The relay side is rally-point2 `148af6d` (review fixes `0daef64` and `f20f526`),
the client side ShieldBattery `0e51b1a02` (`rollback/pacing.rs`); results in the client plan's
"Before shipping". It replaced each client's self-anchored schedule and gives the lead it adapts a
shared reference. Two additions over the design below: the client's slew moves the game loop's
own step timing as well as the schedule (moving only the schedule just makes the game skip or
repeat a frame once the slew crosses one), and a phase lock nudges the loop's ticks back to the
middle of their steps by up to 1 ms a tick.

### Why

Today each client anchors its own schedule on its own clock when the lockstep start ends, and keeps
it on wall time from then on. The local test pass (client plan) showed both ways that goes wrong:

- **A session-wide wait doesn't stop anyone's schedule.** While survivors waited 54 s on a dropped
  player, every schedule kept running, and on resume every survivor sprinted at ~2.6× speed for
  ~25 s to get back on it.
- **Anchors differ by however late each client's start was.** The far player's lateness then shows
  up as everyone else's rollback: a Korea client against three on US relays ran almost no rollback
  at minimal input delay while the others rolled back over its late turns.

### What rp2 has to build on

- **Arrival stamps.** The send-phase controller (`consensus/phase`) stamps every turn at the client
  edge before validation (`routing/slot_link/inbound.rs`) and smooths `arrival − (epoch + seq ×
  41,666 µs)` per slot. It only keeps that residual modulo one turn, anchors `epoch` on the first
  arrival, and compares a relay's own slots with each other, so its 41,666 µs turn (24 a second)
  never mattered. An absolute clock does: the game steps every 42 ms at Fastest, and a clock
  running at 41,666 µs would drift a third of a millisecond a step against every client.
- **Seq is the step.** A turn's seq is its step, and a game pause keeps taking turns, so seq keeps
  ticking at the step rate through a pause. A clock in seq needs no pause handling.
- **No shared timebase.** Relays measure each other's RTT over the mesh (`mesh/links.rs`), not
  clock offsets. `SessionStart` carries no timestamp; each relay latches its own `started_at`.
- **No session-stall signal.** The silent-slot watch is a 10 s eviction check, not something
  pacing can follow.

### The clock

`S(n)` is when step `n`'s turns are due at the relay.

- **Anchor.** The authority fixes it when the lockstep start ends: `S(K)` is the instant step `K`
  becomes confirmable there (it holds every required slot's first `K` turns), with `K` the lockstep
  start's length (24, made a shared constant). During the lockstep start every client waits for
  every turn, so that instant is when the slowest player's start arrived, and nobody is asked to be
  earlier than the session has shown it can be. Then `S(n) = S(K) + (n − K) × 42 ms + P`, where
  `P` is the time the clock has spent stopped (below).
- **Copies on other relays.** The authority sends the anchor over the mesh (a new
  `MeshControlFrame` arm carrying the step and `P`). A peer relay anchors its copy at the frame's
  receipt minus half the mesh RTT it already measures, so copies differ by the mesh path's
  asymmetry and jitter: a few milliseconds. Players homed off the authority's relay come out up to
  about a one-way hop early, since the anchor was taken after their turns crossed the mesh. Changes
  to `P` follow the same path, and the anchor is re-sent to a relay that joins or a session that
  re-homes.
- **Stopping.** The clock may not run more than `STALL_SLACK` steps past the newest step the
  authority can confirm. Whenever wall time would put it further ahead, `P` grows by the excess.
  That one rule covers a drop wait, a hung client and a total outage: the clock stops 12 steps
  past the last confirmable one and resumes from there when turns do. `STALL_SLACK` is the
  prediction limit plus a margin (8 + 4 = 12 steps, 500 ms), because past the limit every player is
  stalled anyway. A player whose own turns run more than 12 steps late still measures 12 late (`P`
  only takes up the time beyond the slack), so they are still told to add delay, and once they
  have, the clock stops slowing to their pace.

### Measurement and report

- **Measured at the home relay.** For each turn a home slot sends, the first arrival of its seq
  `n` gives `e(n) = arrival(n) − S(n)`, in signed microseconds. Every first arrival counts,
  including turns that arrive together in a catch-up burst (which the phase controller skips): a
  turn that arrives in a burst arrived late. The relay stamps the arrival itself, and the only
  client input is the seq.
- **Window.** The last 24 steps (one second): the median and the 90th percentile of `e`.
- **Report.** A new `ControlFrame` arm on the slot's own control stream (tag 17), every 12 steps
  (0.5 s) once the clock has an anchor: `LeadReport { through_step, median_us, p90_us, samples,
  pause_us }`, where `pause_us` is the clock's `P` so far. It is re-sent at connect, as the phase
  directive is, and only in rollback sessions. Older clients skip the unknown arm.
- **A stop starts every window over.** A turn measured around a stop may have been read against
  the clock from before it (on the authority, a turn that arrived before the one that moved the
  clock; on another relay, any turn that arrived before the authority's frame did) and would count
  as late by the whole stop. So when `P` grows, every window is cleared, and the report sent with
  the stop carries `samples: 0` and only `pause_us`. A client-edge turn is measured after it is
  forwarded, so on the authority the turn that resumes the clock is measured against it.
- **Nothing per player crosses the mesh.** Each home relay reports only its own slots; only the
  anchor and `P` travel between relays.
- **Shared constants.** `rally_point_proto::rollback` holds the lockstep start's length (24 steps)
  and the step length (42 ms), which the client and the relays must agree on.

### Client

The report replaces `Schedule` and `lead_adjustment`. The catch-up (up to two extra steps a tick)
and hold-back mechanics stay, steering toward the new schedule.

- **Deadline estimate.** The client keeps `A`, its estimate in local time of when turn `n` has to
  leave to make `S(n)`: `send_by(n) = A + n × 42 ms`. Each report asks for `A` to move earlier
  by `p90 + margin` (or later, when negative). It needs no estimate of the upload leg, since `e` is
  measured against when the client actually sent. A change in `pause_us` moves `A` by exactly that
  much, at once, which is what keeps a session-wide wait from turning into a sprint.
- **Slewed, not stepped.** A correction smaller than a frame is spread out at up to 1 ms per frame
  (a 2.4% change in game speed, too small to see), the way GGPO-style time sync stretches frames
  instead of skipping them. Only a correction of a frame or more uses catch-up or hold-back, and
  one report moves `A` by at most a frame, so a single bad report can't yank the schedule. Since
  the report is in microseconds, this also aligns each player's send phase within a frame, against
  the shared clock instead of against the other players on the same relay.
- **Schedule.** The client steps frame `k` when it would send turn `k + pipe`: at
  `send_by(k + pipe)`.
- **Split.** The pipe adapts on the rollback the client measures, as the lead does today: once the
  rollback has stayed above the target for a 2 s window the pipe grows by the excess, and once it
  has stayed below, the pipe shrinks by the shortfall, within 1 to 14 turns. A deeper pipe steps
  later against the clock, which means less rollback. So input delay plus rollback comes to about
  the player's own RTT to their relay plus the margin, and only that player pays it.
- **Before the first report** (about a second after the lockstep start), the client keeps today's
  local anchor.

### Interactions

- **Send-phase alignment: off in rollback sessions.** It delays a client's sends by part of a turn
  to align the phases of a relay's slots against lockstep's micro-stalls, and it would fight the
  report, which sets each client's send timing outright. The slewed deadline estimate does its
  sub-frame job instead.
- **Buffer law: stopped in rollback sessions after the start.** The buffer no longer sets anyone's
  pipe; only the initial depth matters, for the lockstep start. The relay sends the start's
  directive and then neither decides nor stamps any more, which also saves it the work.
- **`/netstat`** shows lockstep's view (the buffer, gaps, stalls). What a rollback game should show
  per player (lead error, pipe, rollback seen per opponent) needs its own design pass, which can
  follow the clock.
- **Deadline enforcement** builds on the same `S(n)`, with a grace period past the deadline.
- **Leaves and drops** are unaffected. A dropped slot's missing turns are what stop the clock.

### Decisions (Travis, 2026-10-03)

1. `STALL_SLACK` is 12 steps (limit + 4). Lowered to 6, where clients stall, once stops were kept
   by step (see "Next: stopping the clock as it happens").
2. Each player aims at their 90th percentile: about one turn in ten arrives late and is rolled back
   over by the others within their targets, and most turns carry no command anyway.
3. The buffer law stops after the start in rollback sessions (above).
4. `/netstat` for rollback gets its own design pass later (above).
5. Send-phase alignment is off in rollback sessions; the slewed deadline estimate takes over its
   sub-frame alignment.

### Verification

- **rp2 unit tests:** the anchor, the stopping rule (a drop wait grows `P` by the wait minus the
  slack), the report statistics, and a peer relay's anchor adoption with the RTT correction.
- **DLL unit tests:** the deadline estimate's corrections, the `pause_us` jump, and the pipe
  adaptation.
- **Loopback** with `SB_ROLLBACK_LIVE_DELAY` holding the two sides back 4 and 10 frames: each
  side's pipe follows its own hold. The 4-frame side settled 2 frames too deep under the
  self-anchored schedule.
- **The local test pass on staging again:** after a drop wait, survivors catch up about nothing
  when turns resume; the Korea client carries its own lateness with a deeper pipe, and the US
  clients' rollback falls back to the target.

### Next: stopping the clock as it happens

Status: built, not yet live-tested. rp2 `4297a42` (stops by step, final deadlines, full-state
frames with a heartbeat) and `92911d2` (`STALL_SLACK_STEPS` 6), on the local branch `clock-stops`;
the client side is `Pacing::on_report` keeping its trust across a change in `pause_us`, plus the
`SB_ROLLBACK_SEND_DELAY` knob for the local test. Two departures from the design below, both
simplifications:

- **The frame carries the clock's limit rather than its position and a stop in progress.** The
  clock only ever stops at its limit (`confirmable − 1 + STALL_SLACK`), and the limit only grows,
  so every step up to it already has a final deadline, stopped there or not. A relay measures a
  turn once a frame's limit reaches it, and a turn past the limit waits in its slot's queue. That
  makes the stop timer unnecessary: the authority's limit moves on the turn path, a stop in
  progress is just "the limit's deadline has passed", and the only timer left is the 250 ms
  heartbeat.
- **A promoted authority takes the clock over from the newest copy.** Its own copy can trail
  what the former authority made final elsewhere (a further limit, a finished stop), and so can
  its own confirmed turns; nothing local bounds how far, so a stop decided from its own copy could
  move deadlines other relays hold as final. So it asks every relay for its copy, adopts the
  newest, and holds back the clock's advances until all have answered (or 500 ms pass), then
  replays them. The "What isn't guaranteed" case below shrinks to a relay that doesn't answer in
  time, or a frame that reached no surviving relay.
- **The fold horizon is `LEAD_SEEN_SEQS + STALL_SLACK` behind the limit**, since a player the
  session waits on can be up to the slack behind it and is measured up to 128 behind their newest.

One consequence of stops by step worth knowing: a stop moves only the steps after it, so the
player whose turns caused it reads their real lateness for the turns at or before the stop. In
steady state that is the slack (about 5 steps); after a one-off multi-second outage of that
player's uplink it is one window with a few multi-second readings, which the client's cap turns
into a single 2-step correction that the next reports undo.

**What goes wrong with the stop as built.** The authority only finds out the clock stopped in
hindsight: when confirmable next advances, it adds however long the clock had run past
`STALL_SLACK` to `P`, all at once. Every turn measured before that moment was read against a clock
that hadn't stopped, so two resets exist to throw those readings away: each relay clears every lead
window when `P` grows, and the client trusts no report about turns sent before the change
(`trust_from` in `pacing.rs`). Together they break the promise in "Stopping" above. A player whose
turns run persistently more than the slack late grows `P` a little on nearly every confirmable
advance, so his window keeps being cleared and his client keeps distrusting reports; if `P` grows
more than about once a second he never gets a report his pacing acts on, never corrects, and the
session runs stop-start at his pace. That exists today past 500 ms of lateness.

It also keeps `STALL_SLACK` high. Clients stall once confirmable is about the prediction limit
less their steady rollback behind (8 − 2 = 6 steps), but the clock only stops at 12, so a shared
stall of 6-12 steps leaves the clock running: every stalled client undoes its hold afterwards and
sprints to catch up (about 21 times per client in staging game `01a10902`). Lowering the slack as
built would spring the trap above at 250 ms of lateness instead of 500.

**The design.**

- **Stops by step, not by time.** A stop is `(k, Pₖ)`: the clock stopped at step position `k` and
  stood still for `Pₖ`. Step `n` is due at `S(K) + (n − K) × 42 ms + Σ Pₖ` over the stops with
  `k < n`. Which turns a stop moves is then fixed by the stop itself, whatever order a relay learns
  things in.
- **The authority stops the clock when it stops.** A timer stops the clock the moment it reaches
  confirmable + `STALL_SLACK`, and the next confirmable advance ends the stop. While a stop runs,
  the steps past `k` have no deadline yet.
- **Frames carry the whole state.** The authority's `SessionClock` frame carries its clock's
  position (the step due now), the stops, and the stop in progress if any. It goes out on every
  change and every ~250 ms while the clock runs. Position only grows and stops are only added, so a
  relay adopts a newer frame whole and ignores an older one: duplicates, frames delayed across a
  reconnect and the re-sends after a join or an authority change are all harmless. The mesh control
  stream already delivers in order on a connection, and the re-sends cover a replaced connection.
- **Old stops fold into a base.** A relay never measures a turn more than `LEAD_SEEN_SEQS` (128)
  behind the newest it has seen, so stops before `b` = newest − 128 only matter as a sum: the frame
  carries `(b, P_before_b)` and the stops at or past `b`, and the authority folds stops into the base
  as `b` passes them. Folding is exact for every turn that can still be measured, and the list is
  bounded by the 128-step horizon (at most one stop a step, in practice a handful; staging game
  `01a10902` had about 20 over its worst 170 s).
- **A turn is measured once its deadline is final.** A relay finalizes `e(n)` only once it holds an
  authority frame whose position has passed `n` with no stop in progress before it; until then the
  arrival waits. On the authority that's immediate; elsewhere it's at most a mesh hop plus a
  heartbeat (~300 ms), under the 0.5 s report interval. No measurement is ever read against a
  clock that later changes, so neither reset is needed: windows aren't cleared on a stop, and the
  client keeps trusting reports across a change in `pause_us` (a stop moves its deadlines and its
  own sends alike, so its lateness reads the same on either side of it). A stop still sends every
  home slot a report at once, so clients apply `pause_us` without waiting.
- **Then lower `STALL_SLACK` to where clients stall** (6 steps). With the late player's lateness
  measured through stops he gets steady reports of about `STALL_SLACK × 42 ms` late, corrects 2
  steps a report, and the stops end; and a shared stall over 6 steps stops the clock, so the stalled
  clients just wait, as lockstep would, rather than sprint afterwards.

**What isn't guaranteed.** An authority that fails with a stop in flight leaves the new authority
continuing from its own copy, which may lack that stop or its final length. Clients homed on relays
that had it then differ by at most that one stop until lead reports absorb it, a couple of reports
later, the same way an anchor error is absorbed today. Stops only ever move timing, never a
decision.

**Cost.** rp2: the clock and its frame (`consensus/clock.rs`, `maker/clock.rs`), the stop timer, a
queue of arrivals waiting for a final deadline in `consensus/lead.rs`, and no window restarts. The
mesh frame changes shape, so every relay deploys together. DLL: `Pacing::on_report` stops resetting
its trust on a change in `pause_us`; the hold and pause handling stay.

**Verification.** rp2 unit tests: the frame folding and adoption out of order; a peer measuring a
turn that arrived before it heard of a stop; a slot persistently late past the slack keeps getting
reports with samples and its lateness stays at the slack. Loopback with one client's own sends held
past the slack (a new debug knob: `SB_ROLLBACK_LIVE_DELAY` holds the turns a client receives, not
the ones it sends): its pacing corrects and the stops end within a few seconds. The local test pass's drop wait: survivors still catch up about nothing, and a stall
between 6 and 12 steps now shows a stop instead of each client undoing a hold.

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
  deadline (below), in 1v1 too. The named player's home relay evicts them and finalizes their
  drop, which usually scores as a loss. With no majority (a 1v1 disagreement, an even split) it
  names nobody at fault but evicts every player, since nothing can reconcile their games, and the
  game is voided. An evicted client's notice says a desync was detected.
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
   within ~2 frames of RTT to their relay plays with none at the default target.
5. **Steady versus burst:** the relay reports lead error and the client classifies it, since the
   split between delay and rollback is the client's decision. The steady estimate's window and
   percentile, and the sustain window before adding delay, are to be tuned in live tests.
6. **Deadline enforcement:** without it, a modified client that ignores its lead report pushes
   rollback onto other players (bounded by their limits). The strong fix: the relay replaces a turn
   that misses its deadline by more than a grace period with an empty turn, forwards the empty turn
   to every player including the sender, and the sender rolls back its own commands. Missing the
   deadline then only ever hurts the player who missed it. Hardening for later, not needed for the
   first live tests.
7. **Multi-relay sessions:** every home relay measures against its copy of the one session clock,
   anchored from the authority's with half the mesh RTT (see the session clock section). A turn
   crossing the mesh reaches the far relay's players one mesh hop later; that hop counts as
   download lateness for the receiving players.

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
3. rp2: session mode flag and step-keyed hash comparator with relay-set deadlines (done); the
   session clock and per-player lead reports (designed above, next, and needed before rollback
   ships).
4. Presentation: sound hook, chat on arrival (not started; announcements are deduplicated across
   re-simulations already).
