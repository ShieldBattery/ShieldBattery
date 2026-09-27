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
audits, dumps, correction metrics, smoothing.

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

- The receive side never blocks while `present − confirmed ≤ R_max`. A frame whose remote turn
  hasn't arrived runs with an empty turn for that slot.
- A turn that arrives for a predicted frame and carries commands triggers a rollback to that frame.
  A turn with no commands only moves the confirmed frame.
- Leaves become frame events: a counted leave applies at the frame after the departed slot's last
  turn (`final_turn_count`), and an unfinalized leave applies at its `apply_at_frame`. A leave that
  arrives late rolls back like a late command.
- Native 0x37 is off in rollback mode: no generation, no verification, and the one-per-turn check
  can't drop anyone. In debug builds both clients opt in through the env. The real switch is the
  session descriptor (rp2 step).
- The stall overlay and `/netstat` stall attribution fire only when the cap stops the client, not
  on every late turn.
- **The split:** the client chooses its own delay D and lead X from its rollback target
  (`X = R_target − steady download lateness`, D covering the rest of its RTT), with the sustain
  window before adding delay. Until the relay reports lead error, the client estimates it from its
  own RTT (upload leg ≈ RTT / 2) and anchors the session clock to the game's first frame.
- **Catch-up:** when the client falls behind its target X it steps frames back to back through the
  harness's pacing control (`probe_set_next_game_step_tick`) instead of waiting.
- Debug knobs: `R_target`, `R_max`, and delaying a chosen remote slot's turns locally (the live
  counterpart of `SB_ROLLBACK_DELAY`), so the settings can be feel-tested before any relay work.

**Verify:** two loopback clients with a delayed slot on one side. Confirmed `state_hash` rows match
across clients for the whole game, corrections look like the harness's at the same delay, the cap
stalls cleanly past `R_max`, and a player with an artificially slow link carries the delay and
rollback while the other sees its commands on time.

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

### Slice 5: confirmed-hash reports

Hash the confirmed frame every 8 frames and carry `{frame, hash}` as an envelope field on outbound
turns. This needs the rp2 client crate's `Payload` field, so it lands together with the relay
comparator (build step 3).

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
- **Game end in live games.** `trigger_result_check_timer` (RVA 0x10b0e00 in 12310g x64) counts
  down every frame outside replays and opens the local victory or defeat dialog when it expires;
  it is not in the snapshot yet (needs a samase_scarf analysis). A mispredicted defeat of the
  local player would open that dialog, so game end has to wait for the frame to be confirmed.