# Rollback M4 client core: implementation plan

Build step 2 of [rollback-m4-controller.md](rollback-m4-controller.md): run live netcode v2 games
with prediction and rollback in the game DLL. Slice 5 also covers the rp2 side of the session mode
and the hash comparator; the relay's session clock comes after.

**Status:** slices 1–5 are built and verified, and release DLLs run rollback sessions. What's left
before shipping is in [Before shipping](#before-shipping), and what follows it in
[After shipping](#after-shipping).

## What the code tells us

- **A turn's index is its frame.** Every step consumes exactly one turn from every required slot
  (`TurnState::receive_turns`), so a slot's k-th in-game turn executes on frame k on every client.
  The pipe depth (`latency_turns`) only decides how far ahead of that frame a client sends its own
  turn. The frame-indexed input table therefore needs no wire change: a remote turn's frame is its
  arrival count for that slot, and a local turn's frame is its submit count.
- **The whole network step runs inside the simulation step.** `step_game_logic` calls
  `step_network`, which calls the IN hook (`netcode_v2_receive_turns`), dispatches commands, and
  runs the PIPE flush, which submits local turns through the OUT hook. Every re-simulated step
  therefore also runs the send side and everything else the IN hook does.
- **The IN hook mixes per-frame and per-tick work.** Per frame: serve that frame's inputs, apply
  leaves due at that frame, apply buffer directives. Per tick (must not repeat when a frame is
  re-simulated): signalling game start, chat injection, skins, connectivity and region pumps, debug
  commands, self-close, and ending the session on a requested exit.
- **The harness keeps a single snapshot** exactly R frames behind and re-simulates R + 1 frames
  every tick. The snapshot is 152 ranges, 5.2 MB, about 0.5 ms to copy.
- **The replay recorder is live state the harness never exercised.** In a live game `ReplayData`
  is the recorder: a growable buffer (`data_start`, `data_length`, `data_capacity`) appended to at
  the end of command processing. The harness snapshots the whole struct because in playback it is
  the read cursor. In a live game, restoring it after the buffer has grown would put back a freed
  pointer, and predicted frames would record predicted commands.
- **Native 0x37 still works while nothing is predicted.** The sync ring is in the snapshot, and a
  re-simulation with every input known reproduces the same state. That makes 0x37 a free
  cross-client check for the stage that re-simulates without predicting (slice 3).

## Decisions

### 1. Tick structure

- **(a) Harness structure:** one confirmed snapshot. Every tick restores it, steps forward over the
  frames that are now confirmed, snapshots, and re-simulates up to the present. Cost per tick: about
  1 ms of copying plus (gap + 1) steps, every tick, whether or not anything was mispredicted.
- **(b) Snapshot ring:** snapshot every frame into a ring of `R_max + 1`. Step forward normally,
  and roll back only when an arriving turn contradicts its prediction: restore that frame's snapshot
  and re-simulate to the present, snapshotting each frame again. Cost per tick: about 0.5 ms plus
  one step when the predictions held, and about the same as (a) plus the snapshots when they didn't.

Either fits the budget. A step costs about 0.25–0.45 ms. The harness's R sweep on a 3v3 measured
ticks at 2.7 ms average (4.8 ms p99) at R = 3 and 3.9 ms (6.1 ms p99) at R = 8, against a 41.7 ms
frame budget; the heaviest genuine ticks were 10–13 ms. The worst tick costs about the same either
way, so (b) is about the average: no restore and no re-simulation on the frames whose predictions
held, which is most of them, since 300 APM is about 5 commands a second against 24 turns.

**Decided: (b), sparse.** Snapshot every S frames into `ceil(R_max / S) + 1` slots, so one snapshot
always sits at or before the confirmed frame (any later frame could still prove mispredicted). On a
misprediction at frame F, restore the newest snapshot at or before F, drop the ones after it, and
re-simulate to the present, snapshotting on schedule along the way. Start at S = 3 (4 slots, about
21 MB, about 0.17 ms of copying per frame, at most 2 extra steps per rollback), with S as a debug
knob to compare against S = 2 (5 slots, about 26 MB).

### 2. Time sync

**Decided: the deadline model** in the design doc. Every player's turn for frame F must reach the
relay by the session clock's time for F. Each client meets that with its own mix of input delay and
running ahead, and catches up by stepping frames back to back when it falls behind, so nobody waits
for a slow player and a slow player can't push their lateness onto anyone else. The client needs
the relay's lead report for the real thing; until rp2 has it, slice 4 approximates the session
clock locally (below).

## Slices

Each slice builds and passes clippy and fmt on both architectures, and leaves lockstep games
unchanged.

### Slice 1: extract the engine (no behavior change)

Move out of `rollback_harness.rs` into a `rollback` module that is compiled into release:

- range analysis and the snapshot layout (`analyze_ranges`, `Harness::build`, `TriggerLists`);
- snapshot and restore;
- the guards re-simulation needs regardless of source: clearing and rebuilding selection visuals,
  suppressing the observer UI in predicted steps, and the sound ledger;
- the step-pacing fix-up (`probe_next_game_step_tick`).

The harness stays debug-only and becomes a driver over the module: replay input gating, CSV rows,
audits, dumps, correction metrics.

**Verify:** a harness run on the TvZ replay produces a CSV identical to one from the parent commit,
at R = 3 with and without a delayed player.

### Slice 2: sparse snapshot ring and variable gap

The harness keeps one snapshot exactly R frames behind and re-simulates every tick. Replace that
with the sparse ring from decision 1: each tick steps the present forward one frame, and rolls back
only when a command arrives for a frame that was simulated without it. The confirmed frame then
advances as far as every slot's turns allow (zero, one or several frames per tick), so the gap
varies. Have the harness drive it with delays that change mid-replay.

**Verify:** 0 confirmed diffs on the TvZ and 3v3 replays with delays that vary between 0 and 5, at
S = 1, 2 and 3, plus tick timings against the current CSVs.

### Slice 3: shadow rollback in live games

This slice restructures the live seams without predicting anything yet. In a live game, behind a
debug env flag, every tick rolls back K frames and re-simulates them with inputs that are all
already known.

- **Input table:** `inbound_queues` become per-slot frame-indexed rings (turn index = frame). The
  local echo writes its own slot the same way. `consumed_turns` becomes "the last frame dispatched
  for this slot", and the leave tracker and sync-generation stamping read frames instead of
  counting calls.
- **IN hook split:** the per-tick work runs once per tick, before the steps. The per-frame work
  serves inputs for `game_frame_count` from the table.
- **Send side in re-simulated steps:** the PIPE and OUT hooks do nothing when a frame is being
  re-simulated. BW's pending local command buffer is untouched, so commands issued during the tick
  go out with the present frame's turn.
- **Recorder:** `ReplayData` comes out of the live snapshot, and recording is enabled only on a
  frame's final simulation (the confirmed step). The replay then contains exactly the confirmed
  commands at their confirmed frames.
- **Audit:** run `SB_ROLLBACK_AUDIT_FRAME` in a live game to find live-only state outside the
  snapshot (net player flags, Storm state, anything local command issue writes).

**Verify:** two loopback clients, one in shadow mode and one plain, play a full game. Native 0x37
keeps passing (no drop, no desync), both clients log matching `state_hash` rows every 8 frames, and
the replay each saves parses and plays back to the same final state.

### Slice 4: prediction and the delay/rollback split

Built and tested live in four commits (two clients on the staging relay, driven by the monkey):

1. **Prediction core** (`netcode_v2/input_table.rs`). An input table keyed by turn index replaces
   the lockstep FIFOs and the shadow mode's dispatch history. A step whose remote turn is missing
   runs with an empty turn, which is what an idle turn holds once 0x37 is stripped; a turn of a
   single no-op counts as the same, since the command hook stands one in for a turn without a sync
   command. A turn that arrives for a step that already ran asks for a rollback only if it differs
   from that. The turn index is `game_frame_count - 1` at the IN hook. It is not the frame count:
   a paused game keeps taking turns without advancing frames, so live rollback counts its whole
   timeline (snapshots, rollback targets, the schedule) in turns, which the snapshot rewinds along
   with the simulation. A pause of about 120 turns in a predicting game kept both clients
   identical. Stalls (and the stall overlay and `/netstat` attribution) happen only
   past the limit, inside BW's own wait for turns.
2. **Leaves as a fence.** A leave is applied only by its own step (`final_turn_count`), and only
   once every earlier step's turns are known, since a leave can't be undone. Steps that ran before
   the leave arrived ran without it, and the fence rolls back to the leave's step once it can apply.
   A step that has never run takes its leaves only if it can run once they apply, so a stalled
   attempt can't lose one to a later restore.
3. **Game end.** `trigger_result_check_timer` is in the snapshot, and the victory and defeat dialog
   openers (samase `open_defeat_mission_dialog` / `open_victory_mission_dialog`) are hooked: inside
   a tick a step only notes the request against its frame, every simulation of the frame replaces
   it, and the driver opens the dialog once the frame is confirmed. The dialog is what reports the
   result and, on a victory, ends the session; the report reads victory states, alliances and drop
   flags recorded for the newest confirmed frame, since the simulation has run on past it.
4. **Lead and catch-up.** The client runs `lead` frames ahead of the lockstep schedule (behind it
   when negative) and keeps `buffer − lead` of its own turns in flight. Its turns then leave
   exactly when lockstep's would whatever the lead, so no other player sees a difference: the lead
   only trades the client's own input delay against the rollback it runs. It starts at
   `min(R_target, buffer − 1)` and follows the rollback the client measures (how far each step is
   past the newest fully known step) over 2 s windows: the lead drops once a window's median is
   past the target, or its 90th percentile past the target plus one frame of insurance, by the
   larger excess but at most two frames a window (a window spent at the prediction limit while
   one peer's link fades for a couple of seconds would otherwise add as much input delay as the
   limit allows, just as the fade ends); and it rises once even the 90th percentile is short of the target, by the
   shortfall.
   The lead can go negative only until the pipe reaches 14 turns (`GAME_SYNC_SAFE_BUFFER_MAX`,
   lockstep's deepest buffer), so rollback never costs more input delay than lockstep could. The
   lead is only sampled on ticks where the newest fully known step advanced, so a total stall
   doesn't walk it down. The first 24 steps run in lockstep with the whole buffer, which lines the clients' game loops up (seed turns arrive before a peer's loop is
   running, so a lockstep first step alone doesn't); each client then anchors its own schedule,
   steps up to two extra frames a tick when it is behind it, and puts its next step off by a frame
   when it is ahead. A drop in the lead takes effect at once, but a rise only a frame every six
   ticks, since each frame of lead takes a turn out of the pipe that the game makes up with an
   extra step; the lead first taking effect when the lockstep start ends sprinted the game at
   three times speed while it was applied at once.

Debug knobs (`rollback_live.rs`): `SB_ROLLBACK_PREDICT=<limit>`, `SB_ROLLBACK_TARGET=<frames>`
(default 3), `SB_ROLLBACK_SHADOW=<depth>` (forced re-simulation on top),
`SB_ROLLBACK_LIVE_DELAY=<storm>:<frames>` (hold a slot's turns back locally, like extra latency on
its link), `SB_ROLLBACK_MIN_BUFFER=<turns>` (act as if the relay asked for a deeper buffer, which it
doesn't for two clients on one machine) and `SB_ROLLBACK_MONKEY=<apm>` (random selects and right
clicks so two clients can play unattended). A plain client in the same game needs
`SB_ROLLBACK_NATIVE_SYNC_OFF=1`.

**Verified** (every run compared both clients' `state_hash` by frame): 22,489 frames identical with
turns held back 4 and 10 frames on the two sides (the 10-frame side past its limit of 8, so it
stalled and caught up); 3,752 frames with lead 3 over a pipe of 1 and 4-frame holds both ways, with
steady pacing (no catch-ups or hold-backs after the start); a 64-bit client against a 32-bit one;
a mid-game drop applied through the fence (an 11-frame rollback) ending in a victory dialog opened
for a confirmed frame and a clean result report, on both architectures; and the winner's uploaded
replay played back to the same state hash as the live game on every one of its 2,083 frames. Tick
cost stayed around 0.5 ms.

**Left open by slice 4:**

- ~~Unfinalized drops carry no turn count, so the leave goes to the first step this client has no
  turn for, which clients can disagree on.~~ Closed by slice 5: rollback sessions force finalized
  drops.
- Each client anchors its schedule on its own clock when the lockstep start ends, so the anchors
  differ by however late each client's start was, and part of one player's slow link can end up
  as another player's input delay. With 4- and 10-frame holds the game ran at full speed with ~3-4
  frames of rollback on both sides, but the 4-frame side settled at a pipe of 7, about 2 frames
  more than its own link explains. Still open: the relay's lead report (after shipping) is what
  makes the split per player.
- Accepted: a stall at the limit happens inside BW's wait for turns. Commands issued during it go
  out with the next turn as in lockstep, but their order marker and target blink aren't logged
  for re-simulation, so a later rollback past the click can erase them. Chat that arrives during
  it waits for the step.

### Network quality chip (independent of the slices)

Rollback games show a network quality chip in place of SC:R's `Lat: 208ms` turn rate text: four
bars rating the connection, with the input delay and the rollback as numbers in fixed slots. It is
the Option A chip from the ingame UI design, drawn with the egui overlay
(`overlay-ui/src/net_quality.rs`; `overlay_preview` renders it on its own). Lockstep games keep
SC:R's text.

- **Visibility:** the chip shows exactly when SC:R would draw its own text, which it does only with
  the ShowTurnRate setting on, in multiplayer games that aren't replays. The `NetFormatTurnRate`
  hook blanks the native string and stamps the time; the chip draws while the hook fired within
  the last 250 ms. It sits at the top left and moves up to stay clear of the FPS line, which SC:R
  draws one small-font line below its turn rate text.
- **D** is the pipe depth minus one: the turns of input delay beyond the unavoidable one, so 0
  means none added.
- **R** is the peak over a rolling 3 s of how far the shown frame is past the newest fully known
  step. A peak holds still through jitter but still shows a burst, and it keeps its last value
  while the simulation is stalled.
- **Bars** take the worse of two ratings: D 0–1, 2–3, 4–6, 7+ and R 0–1, 2–3, 4–5, 6+ give 4, 3, 2
  and 1 bars.

In a US West against Korea game on staging relays with no debug knobs, it read D 0–1 and R
averaging 1.4–1.9. Games run with `SB_ROLLBACK_MIN_BUFFER` or `SB_ROLLBACK_LIVE_DELAY` read higher
by design and don't compare to real games.

### Slice 5: confirmed-hash reports and rollback sessions (with rp2 build step 3)

Done 2026-09-27 (rally-point2 `e4320e2` on main; ShieldBattery `69b874d88`, `21e238534`). Verified
on a loopback coordinator and relay: a 1v1 where one client withheld its reports from step 1200
had that client named at step 1200, evicted, and dropped at a finalized turn count. The other
client got the victory, and the server scored it as a win and a loss with a desync event naming the
evicted player.

**Steps, not frames.** Every hash and deadline is keyed by step (the turn index, also the payload
`seq`). Step `n` is the state once every slot's first `n` turns have run, so the relay knows it is
confirmable once it has forwarded `n` turns of every slot. A paused game takes turns without
advancing frames.

- **Session mode.** The server sets `SB_RP2_ROLLBACK=true` for every game it loads (never per
  player). `SessionRequest.rollback` asks; the coordinator grants it only on relays advertising
  `rollback_v1`, keeps re-homes on them, and forces `finalized_drops` on. The granted
  `SessionResponse.rollback` rides the player's setup to the DLL, which arms rollback from it (the
  env knobs now only tune a rollback game). A DLL that can't roll back (one missing an analysis
  only rollback needs) refuses the session instead of running it as lockstep. Debug DLLs now always
  resolve the snapshot ranges at launch, since the mode is only known once the session is set up.
- **Reports** (`rollback/hash_reports.rs`). Every 8th position from 8 is hashed as it is
  simulated; a re-simulation replaces the hash, and once the position is confirmed its report goes
  out on the next local turn (`Payload.state_hash`). Relays keep reports on the mesh and strip them
  from everything sent to clients. `SB_ROLLBACK_WITHHOLD_HASHES_FROM=<position>` stops reporting,
  to exercise the missing verdict.
- **Comparator** (rp2 `consensus/sync/hashes.rs`). The authority judges a step once every required
  slot has reported, or 5 s after it became confirmable. Native sync is ignored in rollback
  sessions. A verdict names the minority when the rest agree, and any slot that kept sending turns
  (96 past the step) without its report. A slot whose turns stopped is left to the leave machinery.
  With no majority it names nobody and goes dormant, and every player is evicted (below).
- **Eviction** (rp2 `routing/state_hash.rs`, mesh `EvictSlot`). The authority tells the named
  slot's home relay, which closes the link (`DESYNC_EVICTED`), refuses redials, and finalizes the
  drop without waiting for a survivor's drop request. Survivors apply a finalized leave, so the
  evicted player is disconnected, which usually scores as a loss.
- **Server policy.** The desync webhook's `missing` slots count as at fault like `diverged`; a
  no-majority event still voids the game.

Built since:

- A client whose link can't come back shows a terminal notice ("Game desync detected" after a
  desync eviction, "Disconnected from the game" otherwise) with a Leave button, which ends the game
  the way the menu's End Game does.
- The pipe is capped at `GAME_SYNC_SAFE_BUFFER_MAX` (14) turns, lockstep's ceiling, however far
  behind the schedule the lead goes, so rollback never costs more input delay than lockstep could.
- Release DLLs run rollback sessions. They carry the engine, the live driver and the hooks with
  the defaults (prediction limit 8, target 2, a snapshot every 3 frames), and none of the debug
  knobs, the replay harness, the probe or the monkey. Every analysis only rollback needs is
  optional, and a DLL missing any of them refuses rollback sessions rather than failing to start.
  Verified on staging relays with a Korea client against a US West one, in both pairings of a
  release DLL on one architecture against a debug DLL on the other: steady rollbacks on the
  release side and no hash verdicts.
- UMS games on EUD maps run lockstep: EUD triggers can write memory the snapshot doesn't cover.
  Melee games on EUD maps still roll back.
- The network quality chip (above) replaced the debug latency text.

## Before shipping

Target: the release after 11.4.0. There is no rollout gating and no guard against old clients,
since clients always update: rollback goes to the staging region first, then to everyone.
Coordinators and relays already run rp2 main `2a07bae`.

- ~~**Eviction should end the session.**~~ Done (rp2 `c755785`, pinned): the client driver ends on
  a `DESYNC_EVICTED` or `LOBBY_VIOLATION` close instead of re-dialing. A desync eviction shows
  "Game desync detected" with an explanation and the Leave button; any other end shows
  "Disconnected from the game". The client can't tell a minority eviction from a no-majority one
  (both are `DESYNC_EVICTED`), so the explanation can't say whether the game counts.
- ~~**A no-majority verdict leaves the game running.**~~ Done in rp2 `4a2038a`: the verdict still
  names nobody at fault (so the server voids the game), but every player is evicted, so nobody
  plays on in a game that no longer agrees. **Needs the relay deployed from `4a2038a` or later.**
- **Staging-region tests.** Real cross-region games on the staging region with release builds.
  Watch stalls: a 40 s cross-relay game on release x64 had 3 (the longest 339 ms).
- ~~**rally-point-client pin.**~~ Done: the DLL pins rp2 `c755785`, the deployed `2a07bae` plus
  the client-only eviction change.
- ~~**The relay's lead report.**~~ Done: rally-point2 `148af6d` (with review fixes `0daef64` and
  `f20f526`) and ShieldBattery `0e51b1a02`. The relay keeps the session clock (step F due at
  `start + F × 42 ms`), measures how early or late each player's turns reach it against that, and
  sends each player its own lateness; the client paces its game from the reports
  (`rollback/pacing.rs`) instead of anchoring its own schedule. Design:
  [The session clock and lead report](rollback-m4-controller.md#the-session-clock-and-lead-report).
  The same 2v2 as the local test pass below (us-west ×2, Korea, us-east), rerun with it:

  |                                          | Self-anchored schedule              | Session clock                          |
  | ---------------------------------------- | ----------------------------------- | -------------------------------------- |
  | Frames caught up after a ~55 s drop wait | 1,063–1,241 (~2.6× speed for ~25 s) | 1–6                                    |
  | Korea client's rollback                  | ~0; its lateness on everyone else   | 3.0 frames, its target, on a pipe of 2 |
  | Korea client's catch-ups and hold-backs  | ~200 each per 30 s                  | 0 once settled                         |
  | Each client's p90 lateness at the relay  | (not measured)                      | −1 to −6 ms, about the 3 ms margin     |

  Every relay adopted the same stop (57.9 s for a 58 s wait). Within a minute of the start, each
  client's corrections settle to millisecond trims that net to almost nothing, with no catch-ups
  or hold-backs; a phase lock keeps the game loop's ticks centred in their steps, which a stall or
  the loop's own drift had left near a step's edge (a client flipping between two frames).
  What the local test pass found without it:
  - **The clock must stop when the session does.** A drop wait stalls every client, but each
    one's schedule kept running: after a 54 s wait for a dropped player, all three survivors ran
    at ~2.6× speed for ~25 s (1,063–1,241 frames caught up in 30 s), and the lead adapter drove
    one client to lead −4 over a pipe of 11 (~460 ms of input delay) while it caught up. Only a
    client behind on its own should catch up; a session-wide wait has to re-anchor the clock.
  - **The far player's lateness lands on everyone else.** With a Korea client against three on
    US relays, the Korea client settled at lead 5 over a pipe of 1 and ran almost no rollback,
    while every other client rolled back over its late turns (29–60 rollbacks per 30 s against
    its 0). In one game it also alternated catching up and holding back (~200 of each per 30 s),
    which is uneven pacing on screen.

- **Staging-region tests.** Real cross-region games on the staging region with release builds.
  Watch stalls: a 40 s cross-relay game on release x64 had 3 (the longest 339 ms).

### Local test pass (2026-10-03)

Four dev clients (one 32-bit) on the staging coordinator and relays, spread over us-west, kr and
us-east so sessions spanned three relays, with `SB_ROLLBACK_MONKEY=120` on every client:

- **2v2, cross-relay:** all four armed rollback, rolled back steadily (22–40 rollbacks per 30 s,
  at most 7 frames deep, ~0.2 ms of steps per tick, 0.5 ms on 32-bit) with no hash verdicts.
- **Desync in a team game:** `forceDesync` on one player; the relay named it the diverged
  minority and evicted it within 0.4 s, its driver ended without a redial, its notice showed, the
  server recorded it at fault, and the other three played on.
- **Computers and observers:** two humans against two computers with two observers, ~2 minutes
  without a verdict. Observers roll back like players.
- **No majority:** `forceDesync` on one of the two humans; both were evicted with the desync
  notice, the server recorded `no_majority` with nobody at fault, and the observers watched the
  computers win.
- **Drop across relays:** killed one player's process mid-game; the relay confirmed the link
  death in ~3 s, the Drop button unlocked at 45 s, and the drop became a finalized leave every
  survivor applied within ~70 ms through the fence (a 9-frame rollback). Then the sprint above.

Smaller things found on the way:

- The summary's step time counts a stall at the limit as one long step ("worst 54454.5 ms"), and
  its "ahead … at most 9" exceeds the limit of 8, probably the off-by-one fixed in the readout.
- The chip showed a 3 s peak of rollback, so it sat at 5 while the average was 3. It now shows
  the 90th percentile of the same window's ticks, which ignores lateness under ~300 ms.

### Staging test pass (2026-10-04)

Three or four players on staging relays (one far player ~160 ms from their relay), six rollback
games. Fixed afterwards:

- **Crash: a selection holding a freed unit** (three crashes: a right click or targeted order
  played the response of a selected unit with a null sprite). The game only deselects a dying unit
  whose sprite shows it selected, and the tick took the selection visuals (and that flag) off for
  every snapshot and restore and only put them back once its steps were done, so a selected unit
  dying in any such tick stayed selected. The visuals now go straight back after each snapshot and
  restore. And since the local selection stays out of the snapshot, a tick that restores also
  deselects every unit whose slot's generation, owner or sprite the restore changed, through the
  game's own `select_units`.
- **Crash: building placement overlays.** Placing a refinery links images from two static pools
  outside the snapshot into every geyser's sprite; a restore brought back geyser image lists
  pointing at freed pool entries, and the next step ran a free entry's iscript. They now come off
  around every snapshot and restore, with the selection visuals, and go straight back.
- A unit a prediction killed (or moved to another owner, or loaded) goes back into the local
  selection when a rollback undoes that: each unit a step takes out of the selection is noted, and
  a restore to before that step puts it back where it was, unless the player has replaced the
  selection since. And a control group recalled while a prediction had one of its units dead
  selected the others, while the recall command, run again by the rollback, selects the whole
  group in the simulation: once a rollback has run the player's newest selection command again,
  a local selection the simulation's holds more than takes on the simulation's.
- From review: right-click feedback replays only onto the sprite it was made on; a leave waits for
  the staying slots' turns at its own step; going local-only applies a leave the input table
  hadn't; a late remote turn's actions count towards APM once.
- Chat during a stall waiting for a player is shown at once, and goes into the replay when the
  stalled step runs.
- The Shift+F2 to F4 screen positions stay out of the snapshot, like the camera.
- **Controller:** the default target is 2, leaving a frame of insurance before corrections show;
  the lead now follows the window's median and 90th percentile rather than its lowest and highest
  tick (a far client sat at an average of exactly 3, often 4, for whole games without adding
  delay); and a rise in the lead takes effect a frame at a time, so the lead taking effect when the
  lockstep start ends no longer sprints the game at three times speed.

Rollback games are now auditable after the fact. Each client keeps game-long counts (rollback and
pipe histograms, rollbacks and re-simulated frames, stalls at the limit, catch-up and hold-back,
lead reports, worst and slow ticks) and sends them to its home relay every 30 s and before its
leave, where they land in the flight recording's sample rows along with the relay's own lateness
figures per slot and the session clock's anchor and stops (rally-point2 `1d47ed1`, `75b6198`); and once at
game end to the server's `POST /games/:gameId/rollback-stats`, which keeps them in
`game_rollback_stats` for queries across games.

Still open from it: frame rate dips (the logged tick cost is about 1 ms, with 4-5 ms spikes on deep
rollbacks, which doesn't explain large drops; whole-tick timing needs logging first), and one
stretch of the camera snapping back repeatedly (nothing found; a tick that moves the camera now
logs a warning).

### A lossy downlink (staging, 2026-10-04)

A 30-minute, 7-player game (`01a10902`) where one player's downlink lost 8-15% of its packets for
about three minutes, with bufferbloat spikes (round trips to 430 ms) before that. The session
clock stopped for 13 s in all, and everyone saw stutters and, afterwards, input delay up to 10
frames. What made one player's link everyone's problem, and what changed:

- **A stalled client stopped sending.** BW only flushes a client's turns after a step runs, so a
  client stalled at its prediction limit sent nothing, and the player whose downlink starved him
  (740-1,050 ticks at the limit per 30 s, against 60-630 for the others) stalled the session in
  turn. Now each relay stamps every packet to its own client with how many of every in-game slot's
  turns it holds (rp2 `turns_complete`). A client stalled on a turn the relay already has is
  waiting on its own downlink: it keeps sending its turns on schedule from the IN hook's stall
  branch (at most 48 past its pipe, its own input delay for that long), doesn't hold its
  schedule, and catches its simulation up afterwards. A stall on a turn the relay lacks is the
  session waiting, and holds as before; so is one whose stamp has stood still for 12 steps (while
  the session plays on, it changes with nearly every step's turns), since a downlink gone silent
  leaves its last stamp ahead forever, and that player has to stall the session into the ordinary
  drop path. A drop still being held keeps the stamp back (every client needs that player's turns
  until the leave is decided), and the newest stamp starts over with each connection. The PIPE flush also sends every turn the schedule has due,
  so turns stay on time while a simulation catches up.
- **The congestion controller throttled the lossy downlink.** Cubic read random loss as
  congestion (60-117 events per 10 s) and parked the window below the turn stream: the relay
  squeezed the same ~140 turns a second into 80-160 packets instead of ~230. Every link's window
  now has a 128 KiB floor (rp2 `75401eb`, `14c5380`).
- **The lead dropped by its whole excess in one window.** A window of ticks at the prediction
  limit took the lead from 5 to -1 at once, input delay that arrived as the fade ended and drained
  2 frames a window. A window now moves it down by 2 at most.

- **A shared stall shorter than the slack left the clock running.** With `STALL_SLACK_STEPS` at
  12, a stall of 6-12 steps didn't stop the clock, so every client stalled with it caught up
  afterwards (each innocent client undid about 21 holds in this game). Lowering the slack to where
  clients stall (6) needed the stop to leave a late player's own lateness measured first, or a
  player running persistently past it would never get a usable report. The relays now keep stops
  by step and measure each turn only once its deadline is final, and the slack is 6: see
  [Next: stopping the clock as it happens](rollback-m4-controller.md#next-stopping-the-clock-as-it-happens)
  (rp2 `4297a42`, `92911d2`). The client keeps trusting reports across a stop.

Also open: **stalls right after the lockstep start.** Each client anchors its schedule where its
own lockstep start ends, and the relay anchors the session clock where the start became
confirmable, so a client whose start ran late comes out of it needing a large correction, which
the pacing applies at 2 steps a report (about 4 steps a second). Until it lands, that client's
turns reach the relay late and everyone else stalls on them. The staging game above had 193 ticks
at the limit in its first summary and none once settled; a local 1v1 with one client's peer turns
held 12 frames (`SB_ROLLBACK_LIVE_DELAY=0:12`) had the far client correct by 324 ms and the other
stall 81 ticks in its first 30 s, then never again. The first report already measures the whole
offset, so either applying the first trusted report's correction whole rather than 2 steps at a
time, or having the relay hand each client the clock's anchor to start its schedule from, would
take most of it away.

The same local test showed the send-while-stalled path working: the client holding its peer's
turns sent 52 turns while stalled as its lead walked down to -9, the session clock never stopped,
and once settled the other client ran a pipe of 1 with no rollback.

## After shipping

In rough order:

- Deadline enforcement, and clock offsets for sessions spanning several relays (controller doc,
  open questions 6 and 7). Enforcement could delay a late player's stream by a frame rather than
  drop their turn, so a bad connection costs that player input delay, not commands.
- Tuning the steady and burst windows that choose between delay and rollback, from live games.
- A player setting for the rollback limit; every player runs the default of 8. The target is the
  System settings' Rollback balance slider (0 to 4, default 2), which the DLL reads from the local
  settings the app sends it.
- The sound hook, so a sound's audibility is decided when it plays rather than at each simulation.
- Removing the native 0x37 path once every game rolls back.

### Performance

The engine's cost is measured with the replay bench (`SB_ROLLBACK_BENCH`, see the docs at the top
of `game/src/rollback_bench.rs`; build it with `cargo build --profile bench-dll`). It rolls back
fixed depths at checkpoints of a replay, one tick per game loop tick so the game renders between
them, times restores, snapshots and steps in game-thread CPU time, checks every re-simulation
against the first simulation, and can sample a profile (`profile=1`). Machine state drifts by 15%
or more over hours, so compare a change only against a baseline run interleaved with it.

The 2026-10-04 pass (parallel snapshot copies on two helper threads, pathing and the sprite draw
buffers out of the snapshot, no snapshots a tick drops anyway, a selection-visual clear that only
visits sprites that can carry one) cut a rolling-back tick by 34–49% on x64 (depth 8 to 1), 26–40%
on x86, and 39–55% with the game thread on an efficiency core, and forward ticks by 22–35%. A
rolling-back tick at depth 2 went from 1.3 ms to 0.74 ms on the bench machine.

Prototypes kept on local branches for later, roughly by value:

- **Late selection-only turns** (`perf/late-selection-turns`). 40–60% of non-empty turns only
  change the issuing player's selection and hotkey groups, which nothing else in the step reads,
  so a late one can be applied on arrival instead of rolling back when every unit and group it
  touches provably read the same since its frame. 31–42% fewer rollbacks in the harness with no
  divergence; applying them unconditionally does diverge. Needs a design pass: the input table
  applying turns late, re-application after restores, EUD exclusion, and the replay recorder
  splicing the command into its original frame.
- **Untouched pool entries** (`perf/range-diet-page-watch`). Pool entries a game never used still
  hold their init bytes; leaving them out of snapshots and watching their pages for writes cuts
  another ~17% (snapshots to about 1 MB). Page-protects SC:R's heap and data and puts a vectored
  exception handler first; needs a live smoke test on both architectures, and the AI region step
  costs a 0.3–0.7 ms fault spike every ~60 frames.
- **Minimap terrain skip** (`perf/minimap-terrain-skip`). Every turn redraws the whole minimap
  inside the step (terrain ~73 µs); a terrain redraw that a later step of the same tick redraws
  again can be skipped, saving about 73 µs per re-simulated frame live. The unit markers feed the
  sync ring and must still run. Needs samase analyses for `redraw_and_invalidate_minimap` and
  `redraw_minimap_terrain`; the prototype hooks hardcoded x64 addresses.
- **Fast sprite position getters** (`perf/fast-position-getters`). SC:R's obfuscated
  `sprite_position_x/y` reduce to `low16(field ^ K)`; replacing them cuts about 10% off a
  re-simulated step and speeds up ordinary play too. Needs a samase analysis for the getters, and
  the replacements no longer run the key helper's return-address check, an anti-tamper behaviour.
- **Background snapshot copy** (`perf/background-snapshot-copy`). Copies the snapshot of the frame
  a tick ends on while the game draws it, stripping selection visuals from the copy instead of the
  live sprites: forward ticks −36%. Never validated with selections on; the bench's selection knob
  crashed the renderer even on the baseline engine.
- **Write watch** (`perf/write-watch`). Re-reserves the pools' allocations as write-watched memory
  in place: −10 to −18%, but too fragile to ship, and the page watch above gets more.
- Bench additions not merged: live-like ticks that advance and confirm a frame each tick
  (`perf/bench-live-ticks`), memory-bandwidth pressure threads and a first-step/later-step split
  (`perf/bench-memory-pressure`), unit selection and between-tick frame profiling
  (`perf/bench-select-and-frame-profiling`).

Measured dead ends: comparing and copying only differing lines (it reads both sides, which loses
to `rep movsb` writing whole lines without reading them), non-temporal or AVX copies on one
thread, wider or adaptive snapshot spacing, and skipping SC:R's per-image integrity-check gate. A
re-simulated step costs about twice a hot one because rendering runs between ticks, not because of
the snapshot copies.

## Risks

- **Live-only state outside the snapshot.** The harness only proved replay playback. The slice 3
  audit exists to find what else live games write.
- **Local command issue during re-simulation.** Clicks go into BW's pending command buffer outside
  the step. That buffer must not be flushed or cleared by re-simulated steps, which slice 3 checks
  directly.
- **Sounds and camera.** The ledger removes duplicates, but camera-gated sounds can still differ
  between simulations until the sound hook (build step 4) moves the gating to presentation.
- **Render-side animation.** In shadow mode some HD lighting animations (SCV engine glow) visibly
  restart every tick. Either renderer-owned state sits in the snapshot's memory and is rewound by
  each restore, or re-simulated steps re-trigger renderer notifications (frame or animation
  changes) that restart it. Needs RE; the fix is to leave that state out of restores or keep
  re-simulated steps from notifying the renderer.
- **Right-click feedback.** Covered: the order marker and a target's selection-circle blink are
  UI writes into snapshotted sprites, logged per frame and made again during re-simulation, and the
  marker's draw flag is snapshotted with its sprite. A tick's final frame is snapshotted at the
  start of the next tick, since stripping selection circles to take it right after its step hid
  them on the frame shown.
- **Computer players.** Covered: the AI region cursor and the target-ignore counters were
  missing from the snapshot, and restoring a trigger list that a defeat had freed left the saved
  copy's links pointing at freed nodes. A replay with two computer players now matches plain
  playback under forced rollback.
- **Game end in live games.** Covered in slice 4: the result check timer is snapshotted, the
  victory and defeat dialogs open only for confirmed frames, and the result report reads the
  newest confirmed frame's outcome.
