# Rollback M4 client core: implementation plan

Build step 2 of [rollback-m4-controller.md](rollback-m4-controller.md): run live netcode v2 games
with prediction and rollback in the game DLL. rp2 changes (mode flag, hash comparator, law) come
after this and are only referenced here.

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
   past the newest fully known step): once that has stayed above the target for a whole 2 s window
   the lead drops by the excess, and once it has stayed below it the lead rises by the shortfall,
   down to 24 frames behind at most. The first 24 steps run in lockstep with the
   whole buffer, which lines the clients' game loops up (seed turns arrive before a peer's loop is
   running, so a lockstep first step alone doesn't); each client then anchors its own schedule,
   steps up to two extra frames a tick when it is behind it, and puts its next step off by a frame
   when it is ahead.

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

**Open:**
- Unfinalized drops carry no turn count, so the leave goes to the first step this client has no
  turn for, which clients can disagree on. Rollback sessions should require finalized drops.
- Each client anchors its schedule on its own clock when the lockstep start ends, so the anchors
  differ by however late each client's start was, and part of one player's slow link can end up
  as another player's input delay. With 4- and 10-frame holds the game ran at full speed with ~3-4
  frames of rollback on both sides, but the 4-frame side settled at a pipe of 7, about 2 frames
  more than its own link explains. The deadline model's session clock (the relay's lead report,
  rp2 step) is what makes the split per player.
- A stall at the limit happens inside BW's wait for turns, so clicks made during it aren't logged
  for re-simulation, and chat that arrives during it waits for the step.
### Latency readout (independent of the slices)

Replace the `Lat: 208ms` text with a fighting-game style readout: `1D 3R`, the input delay and the
rollback this player is running with, in frames. It goes where SC:R's latency text is today (the
top left of the game screen). Draw it with the egui overlay system (`bw_scr/draw_overlay`, the
same machinery as `/netstat`) instead of formatting SC:R's own text through the
`NetFormatTurnRate` hook, so its look is ours.

- **Visibility:** the readout must show and hide exactly when SC:R would show its own latency text,
  and SC:R's text must not draw. Needs RE: the callers of `net_format_turn_rate` and the option or
  state that gates the display.
- **Values:** D is the pipe depth in force (`latency_turns`). R is the steady rollback, a smoothed
  `present − confirmed` rounded to a whole frame, so a burst doesn't make the number flicker. It is
  set by the latest opponent; per-opponent lateness belongs in `/netstat`.
- **Lockstep games:** the readout works today with R = 0 (`5D 0R`), so it can ship to master on
  its own, before any rollback work lands.
- **Interim (debug builds):** in a game that rolls back, the `NetFormatTurnRate` hook already puts
  `{pipe depth}D {smoothed rollback}R` into SC:R's own latency text, which is enough to read the
  split while feel-testing. SC:R draws that text only when the ShowTurnRate setting is on, in
  multiplayer games that aren't replays, at a fixed (10, 10) in renderer output pixels with
  `fonts[0]`; the egui readout can blank the native string in the same hook and treat the hook
  firing as its per-frame visibility signal.

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
  env knobs now only tune a rollback game). A DLL that can't roll back (release builds, or missing
  analysis) refuses the session instead of running it as lockstep. Debug DLLs now always resolve
  the snapshot ranges at launch, since the mode is only known once the session is set up.
- **Reports** (`rollback/hash_reports.rs`). Every 8th position from 8 is hashed as it is
  simulated; a re-simulation replaces the hash, and once the position is confirmed its report goes
  out on the next local turn (`Payload.state_hash`). Relays keep reports on the mesh and strip them
  from everything sent to clients. `SB_ROLLBACK_WITHHOLD_HASHES_FROM=<position>` stops reporting,
  to exercise the missing verdict.
- **Comparator** (rp2 `consensus/sync/hashes.rs`). The authority judges a step once every required
  slot has reported, or 5 s after it became confirmable. Native sync is ignored in rollback
  sessions. A verdict names the minority when the rest agree, and any slot that kept sending turns
  (96 past the step) without its report. A slot whose turns stopped is left to the leave machinery.
  With no majority it names nobody and goes dormant.
- **Eviction** (rp2 `routing/state_hash.rs`, mesh `EvictSlot`). The authority tells the named
  slot's home relay, which closes the link (`DESYNC_EVICTED`), refuses redials, and finalizes the
  drop without waiting for a survivor's drop request. Survivors apply a finalized leave, so the
  evicted player is disconnected, which usually scores as a loss.
- **Server policy.** The desync webhook's `missing` slots count as at fault like `diverged`; a
  no-majority event still voids the game.

Since then, and still open:

- A client whose link can't come back (an evicted one included) shows "Disconnected from the
  game" with a Leave button, which ends the game the way the menu's End Game does.
- The pipe is capped at `GAME_SYNC_SAFE_BUFFER_MAX` (14) turns, lockstep's ceiling, however far
  behind the schedule the lead goes, so rollback never costs more input delay than lockstep could.
- The rollback engine is compiled out of release DLLs, so rollback sessions need debug DLLs.

**After slice 5: the relay's lead report.** The relay keeps the session clock (step F due at
`start + F × 42 ms`), measures how early or late each player's turns reach it against that, and
sends each player its own smoothed lead error. Clients then set their lead and delay against one
shared clock instead of anchoring their own schedules, which removes the anchor unfairness noted
in slice 4 and is the prerequisite for deadline enforcement. It doesn't affect correctness or
verdicts, so it follows slice 5 as its own step.

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