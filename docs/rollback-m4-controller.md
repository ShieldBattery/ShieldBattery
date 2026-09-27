# Rollback in live games (M4): who decides the window, and how sync checks survive it

Status: design agreed (open questions below are decided), client work not started. Background: the replay harness
(`game/src/rollback_harness.rs`) proves the snapshot and re-simulation engine; a feel test on a
high-APM 1v1 TvZ set the policy this document turns into mechanisms.

At Fastest, one turn is one frame (about 42 ms), so this document counts both in frames.

## The policy being implemented

- Steady state: up to **3 frames** of remote lateness are hidden by rollback (R = 3). At R = 3
  corrections are barely visible (zergling chase: median 7 px, max 16 px); at R = 5 fast units
  visibly teleport (median 12 px, max 27 px).
- Sustained lateness beyond that is covered by **input delay** (D, today's turn buffer).
- Short bursts (loss, jitter) are covered by **rollback first**, up to **R_max = 8** frames, and
  become delay only if they persist.

## Two knobs, two owners

| | Rollback depth R | Input delay D |
|---|---|---|
| What it changes | how far past the confirmed frame one client lets itself predict | which frame every command executes on |
| Needs agreement? | **No**: confirmed frames are identical whatever R each client uses | **Yes**: must apply on the same frame everywhere |
| Owner | each client, locally | the authority relay (existing buffer directive) |
| Cost of too much | visual corrections, CPU (one extra sim step ≈ 0.3–0.45 ms) | input lag on every command, all the time |

That split keeps R out of consensus: no per-frame agreement, no directive, nothing a peer can
influence. The one shared piece is the cap R_max, a session setting, because the relay's law
decides how long to let rollback absorb a burst based on it.

### Client: the prediction cap

The DLL steps the simulation whenever the game loop schedules a frame, even if some remote inputs
for it are missing, as long as `next_frame - confirmed_frame <= R_max` (8, from the session
descriptor so it matches what the relay's law assumes). Past that it stalls,
exactly as lockstep does today. There is no "R = 3 target" on the client: the client never chooses
how late inputs are, it only caps how far it will guess. The steady-state R = 3 is achieved by the
relay choosing D so that typical lateness stays within 3 frames of it.

Each tick is the harness loop: restore the confirmed snapshot, step the confirmed frames that
now have all inputs (normally one), snapshot, then re-step to the present with the latest inputs.
The harness measures this at about 1 ms of copying plus (frames re-stepped + 1) plain steps.

### Relay: the delay law, made rollback-aware

The existing law picks the depth that absorbs the network's lateness. In a rollback game it should
pick a depth that leaves up to `R_steady` (3) frames of lateness uncovered, because rollback hides
those:

- **Target:** `max(bounds.min, law_target - R_steady)`. The hop cushion, delivery-lag term and
  arrival-stretch term stay as they are; only the result is offset.
- **Raise side:** today a loss burst gets a fast raise within about a second. In a rollback game a
  burst up to `R_max - R_steady` (5) extra frames is absorbed without any stall, so the fast raise
  should require the lateness to hold for a sustain window (2–3 s is a reasonable start) unless it
  already exceeds what `R_max` can hide, in which case raise immediately as today.
- **Lower side:** unchanged (shrink floor, edge probation).
- **Initial depth:** the pre-start seed gets the same `- R_steady` offset.
- **Ceiling:** `GAME_SYNC_SAFE_BUFFER_MAX` (14) exists only because of native 0x37's 16-slot ring.
  With native sync replaced (below), it stops applying to rollback games. Bounds still cap D, but
  from a latency budget rather than a correctness cliff.

Evidence stays relay-authored as far as it goes today; nothing new is client-asserted. The
delivery-lag input the law already folds is the same signal in different units: how many turns
behind each destination is.

### What players get

Today the depth absorbs all lateness, so a player's own commands take effect D + 1 frames after
they're issued, sized to the worst pairwise path. In a rollback game a player's own commands take
effect on the next frame, like single player, and extra delay is added only for lateness beyond
`R_steady` (3 frames, ~125 ms one-way). Most same-region games would play with no added input delay
at all; everyone sees everyone else's commands late by the network path, as small corrections.

A side effect worth noting: a client that predicts instead of stalling keeps producing turns on
schedule, so the depth-one micro-stall ring that send-phase alignment exists to fix mostly
disappears in rollback games. Alignment stays (it is harmless and still tightens arrival), but
it stops carrying the weight it does in lockstep.

## Sync checks: replacing 0x37

Native 0x37 cannot work under rollback: it hashes the frame about to run at send time (a
predicted frame on a client running ahead), and the receiver checks it against its own ring slot
immediately, which may itself still be predicted in a 3+ player game. The relay's current
comparator already works around 0x37's quirks (reconstructing native generation ordinals, legacy vs
enhanced ordering, per-origin failure latches). Rollback games replace all of it.

- **What is hashed:** the confirmed frame, at the harness's confirmed step (all inputs up to that
  frame applied, so every honest client has identical state). A 64-bit hash of units, bullets,
  economy, supply, research and the RNG, with no pointer values and no viewer-local state
  (`rollback_probe::state_hash`, verified across processes and against plain playback).
- **What is sent:** `{frame, hash}` every N frames (N = 8 to start) on the v2 control channel, not
  in the game's command stream.
- **What the relay does:** compares reports by frame, with the same verdict rules as today
  (majority authoritative, diverged minority discarded in team games, 1v1 divergence voids).
- **Liveness:** the relay knows, from the inputs it forwarded, the frame at which each checkpoint
  became confirmable, so it sets the report deadline itself (for example, confirmable + 2 s). A
  missing report past the deadline is a failure, so withholding hashes is not a way to dodge
  detection. No client-asserted frame feeds the deadline.
- **Native sync off:** in a rollback game the DLL stops generating 0x37, and the native per-turn
  sync count and peer verification must not drop anyone. Rollback feeds commands to the simulation
  per frame rather than through the game's turn processing, so the natural cut is there. This must
  switch for every client in the game at once, never leaving a gap where 0x37 has stopped but the
  replacement isn't running.
- **Replays:** unaffected. Replays contain no 0x37, and playback skips sync verification.

## Mode negotiation

A game is a rollback game only if every client supports it. The coordinator decides at session
create time (a field on the session descriptor, alongside bounds) and the relay applies the
rollback-aware law and the new comparator for that session only. Lockstep games are untouched.
Observers never issue commands. They can run with rollback like players, or with plain lockstep plus
a larger local buffer; either way they are not required to report hashes, as today.

## Presentation (client only, no consensus)

- **Correction smoothing: tried and parked.** A render-only prototype (`SB_ROLLBACK_SMOOTHING=<frames>`)
  draws a corrected unit part of the way back towards its previous position and eases it in. Both
  variants read worse than a snap in the feel test. The slow ease showed the unit already facing
  and animating its new state while sliding; the 2-frame ease makes units visibly speed up for a
  moment. Blending facing or animation would need display-only iscript state. At R = 3 the snaps
  are small enough to leave alone.
- **Sounds:** record requests above BW's camera and fog gating (two wrappers above `play_sound`)
  so re-simulation doesn't gain or lose sounds as the camera moves; decide audibility when playing.
- **Announcements:** chat, game messages and the observer UI already follow the confirmed timeline
  in the harness, R frames behind the screen. Chat could be shown on arrival instead, since its
  content isn't predicted.

## Open questions

1. ~~`R_max = 8`: fixed, or a tenant bound like the depth bounds?~~ **Decided:** R_max is a
   tenant setting beside `R_steady` and `BufferBounds`, validated the same way and carried on the
   session descriptor, so the relay's law and every client in the game use the same value. Any R
   is safe for correctness (confirmed frames don't depend on it), but the law's raise side does
   depend on it: it holds off raising for a burst only while the burst fits within R_max. A client
   capped lower than the law assumes would stall through that sustain window, and a stalled client
   stops producing turns, so every other client runs out of prediction and stalls with it. Debug
   builds keep an env override for local experiments. Clients don't report their own R_max: the
   relay would have to act on a client's claim, and it already sees a stalling client directly as
   lateness in that client's turns.
2. **What triggers a raise (answered by prod data, 453 games):** today's raises mostly answer tiny
   or passing events, not sustained lateness. The median loss-driven raise follows 1 lost packet
   out of ~2,600, and 43% of path-driven raises come from a path less than 5 ms past a turn
   boundary. Any raise then holds for at least ~22 s (the lowering side keeps a 525-frame trailing
   max). A 2 s sustain window on the current target would avoid only a few of these, because the
   target already smooths its inputs over several seconds. What removes them is a raise-side margin
   (a loss-risk floor, and a path margin past the boundary like the 5.2 ms one lowering uses). In a
   rollback game the `R_steady` offset does that automatically: anything rollback absorbs (3
   frames, ~125 ms) never reaches the delay. Keep the immediate raise past `R_max`. Report:
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
   responsiveness), and remote commands roll in whenever they arrive. The law then only adds delay
   beyond what rollback hides: `extra delay = max(0, lateness − R_steady)`. Games whose one-way
   lateness is within ~3 frames (~125 ms, most same-region games) play with no added input delay;
   the cost is corrections bounded by `R_steady`. Both ends are tenant configuration, to be tuned
   from player feedback: `R_steady` sets how much correction players accept, and `BufferBounds.min`
   sets a delay floor (e.g. always one turn) if single-player responsiveness turns out not to be
   worth the corrections.

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
  commands go straight into the input table for the next frame instead of being echoed into a
  FIFO behind the delay pipe. The pipe (`latency_turns` / `outstanding_turns`) becomes the added
  delay the relay asks for, often zero.
- **Input table:** the per-slot FIFOs become frame-indexed, so a remote turn that arrives for an
  already-predicted frame lands in its slot, and the next tick re-simulates from the confirmed
  frame with it.
- **Counters keyed by frame:** the leave tracker's consumed-turn count and the sync-generation
  stamping assume one turn per frame per slot. Re-simulation calls the receive hook several times
  for the same frame, so both must count by frame number, not by call.
- **Native sync bookkeeping:** `ProcessGameCommands` still notes a turn missing its 0x37 and logs
  a drop (inert under v2, since nothing acts on it). In rollback mode, with 0x37 gone, that
  bookkeeping must be switched off rather than fired on every frame.
- **Snapshot engine:** the harness's range-list snapshot, restore, re-step loop moves out of the
  debug-only harness into a release module driven by the input table, with the harness kept as its
  replay-driven test rig.

## Build order

1. Harness: the state hash as a fingerprint column (done; verified across processes and against
   plain playback).
2. Client M4 core: drive the engine from the netcode v2 dispatch seam with the prediction cap,
   stalling beyond `R_max`; confirmed-frame hash reports; native sync off in rollback mode.
3. rp2: session mode flag carrying `R_max` and `R_steady`; frame-keyed hash comparator with relay-set deadlines; rollback-aware law
   (offset, sustained raise).
4. Presentation: sound hook, chat on arrival.
