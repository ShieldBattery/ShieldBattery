# Netcode v2 — synced player-leave determinism (design)

> **Status: design, not built.** Written 2026-07-03 on branch `rp2-integration`, picking up
> open item §6 of `netcode-v2-integration-handoff.md`. **Scope locked with Travis 2026-07-03:**
> this design builds the deterministic permanent-leave path (auto + manual triggers) and the
> self-disconnect *connection-lost state machine*; **reconnect + resync and the relay grace period
> stay in D11** (the state machine is shaped so D11 drops in — §8a, §11). Read alongside that handoff, the seam RE
> (`scr-netcode-replacement-guide.md` §5.8), the build plan (`netcode-v2-build-plan.md` D9/D11),
> and — load-bearing — `rally-point2/relay/src/consensus.rs` + `rally-point2/client/src/directive.rs`,
> which this design deliberately mirrors.
>
> **The one-line thesis:** a coordinated player-leave is the **sibling of a latency-buffer
> directive** (D9). The relay already decides a value, schedules it at a future `game_frame_count`,
> broadcasts it redundantly on the turn envelope, and every client applies it at that exact frame.
> A leave is the same machine with a different payload — reuse it, don't reinvent a consensus
> protocol at the seam.

## 1. Scope

**In scope — deterministic *permanent* leave.** A player is gone (clean quit or an unrecoverable
drop) and every remaining client must agree, deterministically: which slot, with which reason, on
which turn, applied in the same per-slot order with the same synced-RNG state — **including clients
that never observed the drop locally.** This is guide §5.8's obligation ("agreeing the turn is
necessary, not sufficient").

**Out of scope — reconnect / failover (D11).** A *transient* drop that should recover the player
(client-side network blip, relay death + reassignment) is a different problem with an open design.
The boundary is precise and stated in §11: it lives entirely in the **leave *trigger's* timing**
(immediate vs. grace-period), and this design changes nothing that forecloses it.

**Also out of scope:** turn-rate commands (`0x5f`/`0x66`) — already stripped in the OUT hook
(`strip_control_commands`); the latency buffer itself (D9, built). This design adds *one* new synced
event type alongside the buffer directive.

## 2. Why this is the buffer directive again

The D9 latency-buffer decision-maker (`relay/src/consensus.rs`) is a complete, shipping consensus
engine. Its shape:

| Buffer directive (built) | Leave directive (this design) |
|---|---|
| The **authority relay** (priority-ordered, highest still serving live players) decides. | Same authority relay decides — one scheduler ⇒ one apply frame ⇒ one truth. |
| Targets a future `game_frame_count`, the **consensus coordinate** = `min` of per-slot observed frames. | Same coordinate; the apply frame is derived from it + the departed slot's last frame (§4). |
| Rides the **turn envelope** (`Payload.buffer_directive`), stamped on *every* forwarded turn until `session_frame >= apply_at_frame`. Redundant, out-of-order-tolerant, idempotent by `decision_seq`. | Rides the same envelope in a new `Payload.leave_directive` field, broadcast the same way. |
| Client collapses the stream with `DirectiveTracker` (`observe` while draining, `take_due` once per step) and resizes the pipe. | Client collapses with a sibling `LeaveTracker`; a due leave writes `pending_leave_reason` + `mark_slot_left`. |
| Authority handoff continues the `decision_seq` numbering (`observe_directive`) so a promoted relay outranks what clients hold. | Same, with one added obligation (§10): a leave must not be *lost* across handoff, only superseded-safe like the buffer isn't. |

Reusing this machine means we inherit its hard-won correctness reasoning wholesale: the
poisoning defense (coordinate is the `min`, so a hostile client's inflated frame moves only its own
observation), the "stamp every turn until the slowest passes the frame" coverage guarantee, and the
out-of-order/redundant-copy handling. **We are not designing a consensus protocol; we are adding a
second directive kind to one that exists.**

## 3. The determinism obligations, and how each is met

Guide §5.8 lists what a leave must guarantee. Point by point:

1. **Same slot, same reason, on every client.** Both come *only* from the relay's `LeaveDirective`
   — never from any client-local detection. A client that never saw the drop learns of it solely
   from the directive, so it applies the identical `(slot, reason)` as everyone else. This is the
   substantive change from native (where each client initiates from its *own* lag threshold at its
   *own* turn) and from the debug `forceLeave` (a per-client trigger, correct only for 1v1).

2. **Same turn.** The directive names `apply_at_frame`; every client applies at exactly that
   `game_frame_count`. **And skipping it is physically impossible:** the departed slot is `required`
   in `TurnState` until the leave is applied, so a client *cannot* simulate past `apply_at_frame`
   without either the departed slot's turn (which will never come) or the leave that clears the
   requirement. The lockstep stall gate enforces "apply at exactly this frame" for free — this is
   why the `LeaveTracker` needs no "moot / past-frame" branch that `DirectiveTracker` has (a buffer
   change *may* be skipped if it arrives late; a leave *cannot* legitimately be late, because the
   thing it gates blocks the sim until it applies).

3. **Same per-slot apply order + same synced-RNG state.** Met by construction once #1 and #2 hold:
   every client, at `apply_at_frame`, has written the identical set of `pending_leave_reason[slot]`
   entries, then runs the native `apply_pending_player_leaves` inside the `set_rng_enable(1)` window
   — and that native pass drains slots in fixed slot order (0..12). Identical input array + identical
   drain order + identical RNG window ⇒ identical result. Simultaneous leaves (§10) collapse to the
   same guarantee: whatever set is due at a frame is written before the pass and drained in slot
   order everywhere.

The acceptance bar (guide: "prove it, don't assert") is a **3-player game where one player drops and
the two survivors play on to a natural end with zero desync** — desync would trip the inline sync
checksum (`verify_peer_sync_slot`), which we keep transported (§5.7 note). 1v1 is necessary but not
sufficient: with one survivor there is nobody to diverge from. See §12.

## 4. Which turn — the apply frame

The authority sets:

```
apply_at_frame = max(departed_last_frame, session_frame) + 1
```

- `departed_last_frame` = the newest `game_frame_count` the authority observed on the departed
  slot's validated turns (`SlotState.frame`, read *before* `remove_slot` clears it). The remaining
  clients stall at `departed_last_frame + 1` — the first frame the slot owes a turn it will never
  send — so applying the leave there unstalls them at the earliest safe point.
- `max(.., session_frame)` clamps against ever scheduling in the past (defensive; the stall gate
  already prevents a survivor from being *past* `departed_last_frame + 1`).
- `+1`, not `+ span + HORIZON` like the buffer: a leave wants to fire **as early as possible** (every
  stalled frame is visible lag / a step toward the timeout dialog), whereas a buffer change wants a
  comfortable delivery cushion. The leave can afford the minimal margin precisely because of the
  stall gate: the survivors are *parked* at `apply_at_frame` waiting, so the directive has until the
  stall-timeout budget to arrive — and it rides the survivors' own turns, which are flowing.

> **⚠️ CORRECTED 2026-07-04 after the live proof caught the flaw (see §14).** The paragraphs below
> originally claimed the leave rides the **turn envelope** and "delivery is guaranteed because the
> survivor reaches the apply frame by consuming peers' turns, which carry the stamp." That reasoning
> is **circular and wrong**: on a drop, lockstep stalls *every* survivor, their send cursors block,
> and **the turn stream stops** — so there are no turns left to carry the directive that is supposed
> to end the stall. Leaves are now delivered over the **reliable control stream** (relay pushes a
> `ControlFrame::LeaveDirective` to each surviving client), which works precisely when turns have
> stopped. See §14 for the full analysis and §6 for the corrected wire path.

**Delivery-before-apply (corrected — reliable control-stream push):**
- When `decide_leave` fires, the relay **pushes** the directive to each surviving client's reliable
  control stream (one-shot, QUIC-reliable) — it does **not** wait for turn traffic, which has stopped.
- The survivor's control-stream reader feeds the directive to its `LeaveTracker`; at the top of the
  IN hook, `take_due_leaves(apply_at_frame)` clears the departing slot and the survivor unstalls.
- The survivor already holds every *other* slot's turns up to and past `apply_at_frame` (each peer's
  send cursor ran `latency` turns ahead before stalling), so once the departing slot is cleared it can
  dispatch the frame and resume lockstep with the remaining players.
- **QUIC keep-alive is a hard requirement** (§14): a stalled-but-alive survivor sends no app data, so
  without keep-alive PINGs its own connection idle-times-out and the relay wrongly drops it too (this
  happened in the live proof — all three links timed out at once). With `keep_alive_interval` set, a
  live-but-stalled client keeps signaling presence, and only the genuinely dead client times out —
  making the idle-timeout a clean drop detector.

## 5. Authority and the triggers — where a leave originates

Whatever fires a leave, **the authority relay is the sole scheduler** — it alone runs
`DecisionMaker::decide_leave(slot, departed_last_frame)`, so there is always one apply frame and one
truth. There are **two triggers** that feed it, and both converge on that one decision:

**Trigger A — automatic: a client's link dies.** The **home relay's slot-link task ending**
(`relay/src/routing.rs`, after the `'serve` loop: `deregister` → `unpublish_conditions` →
`maker.remove_slot`). Every exit reason (client link failure, isolation for falling behind, clean
shutdown) already funnels here — the single existing "slot X's home client is gone" signal. This
fires for a **fully disconnected** player. Two sub-cases by where the slot homes:
- *Homes on the authority relay:* before `remove_slot`, read `departed_last_frame`, call
  `decide_leave`, then proceed with the existing cleanup.
- *Homes on a peer relay:* the peer can't decide (one scheduler), so it sends a new mesh control
  message `SlotDeparted { session, slot, last_frame, reason }` to the authority (mirroring how
  per-client *conditions* already flow to the authority over the mesh sidecar); the authority runs
  `decide_leave` on receipt.

**Trigger B — manual: a player asks to drop a laggard.** Trigger A never fires for a player who is
*degraded but still connected* — lagging badly enough to stall everyone, but not disconnected. That
is exactly the case the native "Drop Players" button exists for, and we keep it (§8): the button no
longer writes `pending_leave_reason` locally (non-consensus); it sends a **`RequestDrop { session,
slot }`** up the client's reliable control stream to its relay, which forwards it to the authority.
The authority runs the same `decide_leave` → one directive → everyone (including the requester)
applies the leave deterministically. So the manual path is just "a human shortens the wait" into the
identical machinery — the requester never drops anyone locally.

**Anti-grief on trigger B (D10 — the relay validates).** A `RequestDrop` must not let one player
evict a *healthy* peer. The authority honors it only for a slot it independently sees as the
straggler holding up the session — its observed per-slot frame lagging the session frame by more
than the buffer (i.e. it really is the one everyone is stalled on), or its link already gone. A
request for a slot that is keeping up is rejected. This mirrors native intent (you can only drop the
player you're actually stalled on) and keeps the leave authority server-side, where it belongs.
Whether a single request suffices or a quorum of connected players is required is an open policy
choice (§13); the straggler-validation alone already forecloses griefing, so v1 can honor a single
validated request.

`decide_leave` is the leave-side twin of `decide`: it assigns `apply_at_frame` (§4) and a
`leave_seq`, and queues the directive into a `pending_leaves` set that the fan-out stamps onto
outgoing payloads — exactly like `active_directive` hands out the buffer directive. Retirement is the
same test: drop a leave from the broadcast set once `session_frame >= apply_at_frame`.

**Clean quit vs. unclean drop** is only a `reason` value: `0x40000006` (dropped →
`strPLAYER_WAS_DROPPED`) vs. a non-drop nonzero (left → `strPLAYER_LEFT`) — the same encoding the
seam already uses (`FORCED_LEAVE_REASON` in `bw_scr.rs`). A clean quitter *may* first send a
leave-intent up its reliable control stream so the relay stamps the "left" reason and uses the
quitter's true final frame; absent that, an unclean drop defaults to "dropped". Both paths are one
`decide_leave` call — the only difference is the reason byte and where `last_frame` comes from.

## 6. Wire contract (rally-point2 `proto`)

Add a sibling of `BufferDirective`:

```rust
// proto: rally_point.wire (mirrors BufferDirective's field discipline)
pub struct LeaveDirective {
    pub slot: u32,            // the departing slot (relay-authoritative, not client-asserted)
    pub reason: u32,          // BW pending_leave_reason value: 0x40000006 dropped, else left
    pub apply_at_frame: u32,  // the game_frame_count every client applies it at
    pub leave_seq: u32,       // orders/dedups leaves within the session (its own seq space)
}
```

Carry it on the turn envelope, alongside the buffer directive:

```rust
pub struct Payload {
    // ... seq, slot, commands, game_frame_count, buffer_directive ...
    pub leave_directive: Option<LeaveDirective>,   // NEW
}
```

Design notes:
- **⚠️ Reliable control stream, NOT the datagram envelope (reversed 2026-07-04, §14).** The original
  design put the leave on the `Payload` envelope, reasoning the buffer-directive way. That is **wrong
  for leaves**: a drop stalls every survivor and *stops the turn stream*, so an envelope stamp can
  never be delivered (there are no turns to stamp). The leave is a new `ControlFrame` kind
  (`LeaveDirective`) that the relay **pushes** down each surviving client's reliable stream when
  `decide_leave` fires — QUIC-reliable, one-shot, independent of turn flow. `Payload.leave_directive`
  and its turn-envelope stamping are removed. (The buffer directive keeps the envelope — buffer
  changes happen *during* normal flow, when turns are moving; leaves happen exactly when they stop.)
- **Separate `leave_seq` space** from `decision_seq`. Buffer directives are "latest wins, at most
  one pending"; leaves are *cumulative* — two different slots leaving are two independent facts,
  neither supersedes the other. `leave_seq` is a **relay-side** ordering/telemetry field (and lets a
  promoted authority number a re-broadcast); it is **not** the client's dedup key — the client dedups
  by *slot* (§7), because a slot leaves once and a handoff re-derivation under a higher seq must not
  read as a second leave. So `leave_seq` never needs to be "higher than what clients have seen" for
  correctness (that mattered only under the rejected seq-dedup); it just has to be non-colliding
  per distinct leave for the relay's own bookkeeping.
- **One `Option` per payload, with the relay round-robining simultaneous leaves** (decided during
  implementation). Each leave broadcasts across a whole window of many turns, so when more than one
  is active (rare) the authority stamps them one-per-turn in rotation and every client picks each up
  over the window. A `repeated` field was tried and reverted: a repeated *message* field makes prost
  drop `Payload`'s auto-derived `Eq`/`Hash` (which `ValidatedTurn` and others rely on), and forcing
  them back via build-config is more fragile than a tiny round-robin cursor. So `optional` keeps
  `Payload` the same shape as `buffer_directive`.
- `ControlFrame` could gain the same field for an optional belt-and-suspenders path; not wired in v1.

The **client→relay** direction adds one reliable-control-stream message for trigger B (§5, §8):

```rust
// A ControlFrame kind sent up the client's reliable stream to its relay.
pub struct RequestDrop {
    pub slot: u32,   // the slot the player is asking to drop (the laggard they're stalled on)
}
// (session is implicit in the connection; the relay forwards to the authority.)
```

Design notes:
- **Reliable stream, not the datagram envelope** — the opposite choice from the directive, and for the
  opposite reason: a `RequestDrop` is a rare, one-shot *upstream* ask that must not be lost and has no
  frame-synchronization requirement (the authority decides the frame). It rides the same reliable
  control stream as oversize turns (`dda119f`). This is the reliable-`ControlFrame`-kind ask the
  handoff already lists (Scope B / "opaque ControlFrame") — the leave design needs a small, concrete
  instance of it (`RequestDrop`), which can land ahead of the general opaque-blob frame.
- The relay validates and forwards to the authority (§5 anti-grief); the authority's response *is* the
  ordinary `LeaveDirective` fan-out — there is no separate ack, the requester sees the drop apply like
  everyone else.

## 7. Client seam — the `LeaveTracker` and IN-hook application

New in `rally-point2/client`, sibling of `DirectiveTracker`:

```rust
pub struct LeaveTracker { /* one tracked leave per slot (directive + surfaced flag) */ }
impl LeaveTracker {
    pub fn observe(&mut self, d: &LeaveDirective);          // dedup by SLOT; first-per-slot wins
    pub fn take_due(&mut self, next_frame: u32)
        -> Vec<(SlotId, u32 /*reason*/)>;                   // all leaves with apply_at_frame <= next_frame
}
```

Differences from `DirectiveTracker` (all consequences of §3 point 2):
- **No "moot / past-frame" drop.** A due leave *always* surfaces; it cannot be legitimately late
  because the sim is blocked on it. (Defensive: if `take_due` is somehow called at a frame already
  past `apply_at_frame`, still surface it — failing toward "apply late" would only matter if the
  stall gate were bypassed, which is itself the bug to fix.)
- **Set-valued, not single-pending.** Multiple slots can be due at one frame; return them all so a
  single pass writes the whole set before draining (preserves slot-order determinism, §10).
- **Dedup by *slot*, not by `leave_seq`** (corrected during implementation). A slot leaves exactly
  once, permanently: the first directive seen for a slot wins, and every later directive for that
  slot — a redundant copy, a second mesh path, or an authority-handoff re-derivation under a fresh
  `leave_seq` — is ignored. Deduping by `leave_seq` would be a **desync bug**: a promoted authority
  re-broadcasts an unapplied slot's leave under a *higher* seq (§10), and a client that had already
  applied it would then double-apply and consume synced RNG twice. Deduping by slot makes the
  re-derivation a no-op for a client that already applied it and the real thing for one that missed
  the original — which is exactly what handoff needs. **The relay's half of the contract:** every
  directive it ever emits for a slot must carry the *same* `apply_at_frame` + `reason`, so
  "first-per-slot wins" agrees across clients regardless of which copy each saw first
  (`observe` `debug_assert!`s on a conflicting copy to catch a relay bug in tests).

`game/src/netcode_v2/mod.rs` — `TurnState` gains a `LeaveTracker` next to `directives`.
`drain_inbound` observes both envelope fields as it drains:

```rust
if let Some(bd) = &payload.buffer_directive { self.directives.observe(bd, next_frame); }
if let Some(ld) = &payload.leave_directive  { self.leaves.observe(ld); }
```

`bw_scr.rs` IN hook — the coordinated leave is the **production version of `apply_forced_leaves`**,
applied at the *top* of `netcode_v2_receive_turns`, before the readiness check, because it is what
*unstalls* the step:

```
1. (top of IN hook, before readiness)
   for (slot, reason) in with_turn_state(|s| s.take_due_leaves(next_frame)):
       storm = map slot -> storm id
       *pending_leave_reason[storm] = reason           // synced mailbox write
       with_turn_state(|s| s.mark_slot_left(storm))     // drop from `required` -> unstalls
   #[cfg(debug_assertions)] apply_forced_leaves(..)     // debug shortcut, unchanged
2. receive_turns(next_frame)  -> readiness (departed slot no longer required)
3. fill player_turns[]/sizes/flags; apply_due_directive; mark_local_turn_executed
4. (lock released) run_synced_leave_pass -> apply_pending_player_leaves in the RNG window
```

Step 1 replaces the debug-only `apply_forced_leaves` with a real, frame-gated, relay-driven source.
`forceLeave` stays as a debug shortcut into the same `pending_leave_reason` write (it just skips the
directive), useful for the 1v1 path; the faithful multi-client test now becomes "kill a real client
and watch the directive fan out" (§12).

`take_due_leaves` on `TurnState` maps each due `SlotId` → storm id via the existing `slot_to_storm`
and returns `(storm, reason)`; an unmapped slot is warned-and-skipped exactly as `apply_forced_leaves`
does today (it can't be leaked into `pending_leave_reason`).

## 8. The native stall-dialog hazard — a non-consensus leave path that must be closed

Today, when a survivor stalls on a missing slot, SC:R's native "Waiting for players / Drop Players"
dialog appears **after the network has been stalled past a threshold** (BW's own timeout, downstream
of the IN hook returning `Stall`). Per the handoff's 2026-07-03 live observation, **clicking "Drop
Players" writes `pending_leave_reason` directly**, which our `run_synced_leave_pass` then drains. That
is a *client-local, human-timed, per-client* leave — exactly the non-consensus path that desyncs a
3+ player game (each survivor's user clicks at a different frame with a different RNG state). With
coordinated leaves the relay directive must be the **sole** writer of `pending_leave_reason`.

**The stall threshold makes this narrow, and the fix is to kill the *drop action*, not the dialog.**
Two facts shape it:

- **The dialog is BW's, and it is the informative feedback — SB does not have its own replacement.**
  The `showNetworkStalled` shader that shades the screen while stalled (`bw_scr.rs` /
  `shaders/mask.hlsl`) is a *separate, additional* tint, **not** an equivalent of BW's "waiting for
  players" dialog (which names who we're waiting on and offers the action). So suppressing the whole
  dialog would *lose* real feedback — it is not free, as an earlier draft of this section wrongly
  assumed.
- **In the normal departure case the dialog never even appears.** The coordinated leave directive
  arrives within roughly one buffer's worth of time and unstalls the survivors *before* BW's
  stall-threshold fires. The dialog only shows on a genuinely long stall, which in v2 is one of two
  things, and a manual player-drop is wrong for **both**: (a) jitter beyond the buffer — the missing
  turn is still coming, so the stall self-resolves and no leave should happen; (b) failover (D11) —
  no directive is coming, and dropping a player desyncs rather than recovers.

So v1 keeps BW's dialog for its display but **re-routes the "Drop Players" action through the relay
instead of writing `pending_leave_reason` locally** — this is trigger B (§5). The button becomes a
`RequestDrop { session, slot }` sent up the reliable control stream; the authority validates
(straggler-only, §5) and issues the coordinated directive that everyone — the clicker included —
applies deterministically. The player keeps their agency ("this laggard is ruining the game, drop
them *now*"); it just goes through consensus, so it can never desync and can never evict a healthy
peer.

SB already has the machinery: `spawn_dialog_hook` (`bw_scr/dialog_hook.rs`) intercepts native dialogs
by name and rewrites their event handlers (it already does this for `TextBox`/`Minimap`/…). Match the
waiting/drop dialog by name and, while a v2 session owns the turn transport, replace the "Drop
Players" child control's event with one that calls into the netcode session to send `RequestDrop`
(and gives immediate "requesting drop…" feedback) rather than the native local-drop path — leaving
the "waiting for players" text intact.

Why *not* the alternatives:
- *Suppress the whole dialog:* loses BW's informative "waiting for players" feedback, which SB does
  not otherwise provide (the shader tint is weaker and anonymous). Rejected.
- *Neuter the button (dead "Drop Players"):* removes player agency for the real "drop this laggard"
  case (trigger B), which link-death (trigger A) never covers. Rejected — re-route beats neuter.
- *Build a QUIC-aware egui overlay now:* unnecessary for v1 — the native dialog already appears
  (rarely) and, re-routed, can only do the safe thing. A richer "connection lost / reconnecting…"
  overlay on the existing egui stack (`draw_overlay/`) belongs with **D11**, where it also fronts the
  self-disconnect case (§8a).

**Open RE item (blocks building this):** the native waiting/drop dialog's `Dialog` name (the string
`spawn_dialog_hook` matches on) *and* the id/structure of its "Drop Players" child control need a
BinaryNinja confirm against the 12409 BNDB — that's the whole hook. Listed in §13.

## 8a. Self-disconnect — when *I* am the one who dropped

The mirror case, and the one that would otherwise leave a player **stuck**: my own link to the relay
dies. From my seat, *every* peer's turns stop at once, I stall on all of them, and — with local
dropping gone (§8) — the re-routed "Drop Players" button can't help either (its `RequestDrop` can't
be delivered; my link is dead). Meanwhile the relay is fine: it sees *my* slot-link die (trigger A)
and issues a leave directive for **me** to the survivors, who play on without me. I must not be left
staring at a "waiting for players" dialog about players who are perfectly healthy.

**Detection — a transport fact, not a stall duration.** Do *not* infer self-disconnect from "stalled
for N frames" (that false-positives on jitter, which the buffer and recovery are there to absorb).
The clean, unambiguous signal is that my **QUIC connection to the relay is down** — the driver task
exits and drops its end of the channels, so `TurnState`'s `inbound` channel reads *closed*
(`try_recv` → `Disconnected`), and `submit_local_turn`'s `outbound.try_send` fails on a closed
channel. Closed-channel **while the game is in progress** (`game_started`, not teardown) = "my link
is gone." A stall with the channel still *open* is a peer problem or jitter — handled by the buffer /
a peer-leave, never mistaken for self-disconnect. (A subtler failure — my connection is up but the
relay stopped forwarding, or a mesh partition cuts me off from remote peers — is a partial/partition
case that belongs to D11; v1 keys on connection-down, the common and unambiguous case.)

**Handling — a "connection lost" *state*, not an instant "you've been disconnected" verdict.**
Connection-down should **not** immediately declare the game over. It opens a distinct **connection-lost
state**, and the terminal "you've been disconnected" outcome is that state's *resolution* — reached
when reconnection is exhausted or when the player themselves decides "I'm done waiting," not the
instant the link drops. This mirrors how it works today: the user retains the give-up decision. The
state machine:

- **Enter connection-lost** on the transport signal above. Show the player their connection dropped
  and give an explicit **"leave game"** affordance (their "I'm done waiting" → resolve to
  disconnected). *The native peer-waiting/drop dialog is the wrong affordance here* — its "Drop
  Players" is about the (healthy) others; suppress it and surface a "connection lost, [Leave]" prompt
  instead. Because the **DLL↔app local socket survives a relay drop** (it's not routed through the
  relay), v1 can drive this **app-side**: the DLL signals the disconnect, the app shows the prompt and
  tears the game down on the player's click *or* a bounded timeout — no new in-game egui needed (the
  existing stall shader covers the in-game view until teardown).
- **Resolve to "disconnected"** on give-up / timeout (v1) or reconnect-failure (D11): drive the
  existing end-on-network-failure flow (the `NetworkError` → game-end machinery in
  `network_manager.rs`/`game_state.rs`, surfaced to the app as a disconnect status it already renders),
  ending with a disconnect **loss** — consistent with the relay having dropped me for the survivors
  (the server already treats a disconnected player as a loss), so results agree exactly as native.
  Confirm the exact existing entry point during implementation (§13) — reuse SB's current disconnect
  path, don't add one.

**"How likely is reconnection?" — don't guess it, bound it by the relay's grace window.** The clean
signal isn't a heuristic on the QUIC close reason; it's whether the relay is **still holding my slot**.
Reconnection is possible exactly while the relay hasn't yet fired my leave to the survivors — so the
client attempts reconnect until that window closes, then resolves to disconnected. No likelihood
estimate needed; the grace window *is* the answer.

**Honest v1 caveat — the connection-lost state can't actually recover yet, and that's fine.** Strict
v1 has no client reconnect path, *and* the relay fires trigger A immediately (the grace period is
itself D11, and a grace means the survivors **stall** for its duration — the survivor-stall vs.
reconnect-chance tradeoff is a D11 tuning knob, §11). So in v1 the connection-lost state is a gentle
buffer plus the give-up affordance before an inevitable disconnect — not a real recovery. Its value
now is (1) not yanking the player out mid-action on a blip, and (2) getting the **state-machine shape**
right so D11 drops in cleanly: D11 fills the reconnect+resync branch and adds the relay grace, turning
"connection lost" from a waiting-room into genuine recovery, fronted by the "reconnecting…" overlay
(§8). The `TODO(d11)` sits at both the self-disconnect detection point and the §5 trigger (grace).

## 8b. Self-initiated leave (a player quits from the F10 menu)

**Yes — a player leaving themselves is handled by the *same* mechanism, with no extra machinery,
because a self-quit closes that player's QUIC link, which is the identical trigger as a drop.** When
you quit: your link to your home relay closes → that relay's slot-link task ends (`routing.rs`, §5) →
the authority issues a `LeaveDirective` for your slot → **every other client applies it
deterministically** at the agreed frame, exactly as for an unclean drop. The survivors don't care
*why* your link ended; they only ever see the directive.

From the quitter's own side there is nothing to apply — you're exiting, so you never receive or apply
your *own* leave; BW's normal quit path (`cleanup_and_quit` / result reporting) tears your client
down. **Result agreement is preserved** the same way native preserves it: your peers apply your leave
in the synced-RNG window at the agreed frame (deterministic among them), and your own exit result
("I left → defeat") is consistent with "left at frame L" — the same semantics native already relies
on, now made deterministic *across the survivors*.

The **only** thing a proactive self-leave buys over letting the link-close be detected as a drop is
accuracy, not correctness:
- the **reason** shown to others is "left" (`strPLAYER_LEFT`) rather than "dropped"
  (`strPLAYER_WAS_DROPPED`), and
- the relay can use your true final frame / let your last queued turns flush.

That needs a proactive **leave-intent** sent up the reliable control stream *before* the link closes
(the §13 open item). It does **not** affect determinism: the directive carries one reason to all
clients, so they always agree regardless of which reason the relay chose. **v1 recommendation:**
default every departure — self-quit included — to the drop path (one code path, fully deterministic),
and add the clean "left"-reason intent when lobby/control traffic moves onto the reliable stream
(Scope B) anyway. The cosmetic "dropped vs left" wording is the only thing deferred.

## 9. Sequence, end to end (unclean drop, 3-player: A survives on relay R1, B survives on R1, C drops on R2)

```
C's link dies  ──▶ R2 slot-link task for C ends (routing.rs)
                    R2 reads C.last_frame = D, sends Mesh SlotDeparted{C, D, dropped} to authority R1
R1 (authority)  ──▶ decide_leave(C, D): apply_at_frame = max(D, session_frame)+1 = D+1, leave_seq=k
                    queues LeaveDirective{slot=C, reason=dropped, apply_at=D+1, seq=k}
R1 fan-out      ──▶ stamps the directive on every turn it forwards to A, B (and across the mesh)
                    until session_frame (slowest of A,B) >= D+1
A, B clients    ──▶ drain_inbound observes the directive into LeaveTracker
                    each stalls at D+1 (C owes a turn it never sends)
                    at the top of the IN hook for D+1: take_due -> (C, dropped)
                      write pending_leave_reason[C_storm]; mark_slot_left(C_storm)
                    readiness now passes (C no longer required); dispatch A,B turns for D+1
                    run_synced_leave_pass: set_rng_enable(1); apply_pending_player_leaves(); restore
                    -> both A and B apply C's drop at frame D+1, same slot order, same RNG. No desync.
R1              ──▶ once both A,B pass D+1, active-leave test retires the directive
```

C never participates in its own leave (it's gone); A and B agree without either having "detected" C
locally — they only ever saw the directive.

## 10. Edge cases

- **Simultaneous leaves (two slots drop near the same frame).** Two independent
  `decide_leave`s ⇒ two `LeaveDirective`s with separate `leave_seq`s, each with its own
  `apply_at_frame`. If the frames differ, each applies at its own frame. If they *collide* on one
  frame, `take_due` returns both, both `pending_leave_reason` entries are written before the pass,
  and the native drain handles them in slot order — identical on every client. No superseding (that's
  why `leave_seq` is a separate space, §6).
- **Authority relay itself drops (its clients all left).** Authority hands off to the next relay
  (existing presence-driven mechanism). A leave the old authority was still broadcasting must **not
  be lost** — stronger than the buffer directive, which a promoted relay can simply re-derive from
  live conditions. The promoted authority *can* re-derive it: a slot that is gone from the session
  roster but still expected by clients is, by definition, an unapplied leave. On promotion, the new
  authority diffs "slots clients still expect" (the descriptor roster it holds) against "slots still
  producing turns" and re-issues a `decide_leave` for any gap. Because clients dedup by *slot* (§7),
  the re-derivation is safe regardless of `leave_seq`: a client that already applied it ignores the
  new copy, one that missed the original applies it. **The one real obligation is that the re-derived
  `apply_at_frame` match the original** — both are `departed_last_frame + 1`, and `departed_last_frame`
  is the slot's last frame *every* relay observes off the turn stream (frames flood to all relays via
  `observe_frame`), so the two authorities converge on it. This is the one place a leave is materially
  harder than a buffer change: the frame must be reproduced, not just the fact. *(If Phase-2 scoping
  wants to defer it, the honest interim restriction is "authority-relay departure during an unapplied
  leave is a failover event (D11)"; but the re-derivation is cheap and closes it cleanly, so prefer
  building it — and note the residual risk that the two authorities saw the dead slot's *last* frame
  differ by a turn, which the integration proof should probe.)*
- **A leave for the local slot.** Our own clean quit: we submit our final turns, then tear down — we
  don't need to receive our *own* leave directive (we're leaving). The seam's teardown (game-end)
  handles our exit; the directive is for the *survivors*. No self-application needed.
- **Directive arrives before the survivor reaches the frame.** Normal and fine: `LeaveTracker` holds
  it until `take_due(apply_at_frame)`.
- **Unmapped departed slot** (storm id not yet solidified — only possible very early): warned and
  skipped, as `apply_forced_leaves` already does. A pre-game-start departure is a lobby/join concern,
  not this in-game path.

## 11. Boundary with reconnect / failover (D11)

This design handles **permanent** departure. The entire difference between "permanent leave" and
"transient drop we should recover" is the **timing of the trigger in §5**: today the home relay's
slot-link task ends the instant the QUIC link fails, and we `decide_leave` immediately — which is
correct precisely *because* there is no reconnect yet. When D11 lands:

- The trigger grows a **grace period**: on link loss, hold before `decide_leave`, giving the client's
  reconnect+resync path (D11) a window to re-establish and resume producing turns. Only on grace
  expiry does the leave fire.
- Relay-death failover is the *other* half: a survivor stalled far past any leave's expected arrival
  is not seeing a leave — it's lost its authority/relay, and the D11 resync path (move to a backup
  relay, replay from cursor) applies.
- **Self-disconnect (§8a) is the client-side half that D11 upgrades directly.** v1 enters a
  connection-lost state and resolves it to a disconnect loss on the player's give-up / a timeout; D11
  fills the reconnect+resync branch (and adds the relay grace that keeps the slot recoverable),
  fronted by the "reconnecting…" overlay. Same trigger (connection-down), same state machine, so the
  v1 code is exactly the seam D11 extends — the `TODO(d11)` lives at the self-disconnect detection
  point *and* the §5 trigger site (grace).

Nothing here forecloses any of it: the leave directive is orthogonal to *how long we wait before
deciding a departure is permanent*, and the §8 dialog re-route + §8a disconnect end-game path are
exactly the seams where D11's grace period and "reconnecting…" UI slot in. This design ships with the
**immediate** trigger (matching today's no-reconnect reality).

## 12. Build plan & acceptance

Cross-repo, sequenced so each layer is unit-tested before the next depends on it (the buffer
directive's own test suites are the template to mirror — `consensus.rs` tests, `directive.rs` tests).

The core (steps 1–5) is the automatic-leave spine; the manual drop (trigger B) and self-disconnect
handling (steps 6–7) build on it and can be sequenced after the spine is proven, but they are part of
this design, not a later effort.

1. **proto (rally-point2):** `LeaveDirective`; add `leave_directive` to `Payload`.
   Round-trip encode/decode tests (covered via the driver forwards-envelope-whole test). **[DONE]**
2. **client crate (rally-point2):** `LeaveTracker` (sibling of `DirectiveTracker`) with the §7
   semantics + a full unit suite (dedup by *slot*, handoff-re-derivation no-double-apply, set-valued
   `take_due`, no-moot behavior, simultaneous-frame collision). **[DONE]**
3. **relay (rally-point2):** `DecisionMaker::decide_leave` + `pending_leaves` broadcast set +
   retirement; the `routing.rs` **trigger A** (read `last_frame` before `remove_slot`); the mesh
   `SlotDeparted` message + authority ingest; the promotion re-derivation (§10). Unit tests on
   `decide_leave` (apply-frame formula, seq numbering, handoff continuity) mirroring the buffer tests.
4. **game seam (shieldbattery):** `TurnState.leaves` + `drain_inbound` observe + `take_due_leaves`;
   IN-hook top application (§7). Unit tests on `TurnState` (a due leave clears `required` and writes
   the right storm mailbox; unmapped slot skipped).
5. **Integration / the determinism proof (automatic path).** Live loopback per the handoff runbook:
   - **1v1 (necessary):** kill client C (`forceQuit`), assert the survivor applies the leave and the
     game resolves to a correct result — reproduces today's `forceLeave` outcome but via the real
     directive path.
   - **3-player (the actual proof, guide §5.8):** two survivors on the same relay and, separately,
     across two relays; drop the third; **both survivors play on to a natural game end with zero
     desync** (the inline sync checksum would trip on any divergence). Use `queryState` to assert
     both survivors flip the departed slot to `required: false` **at the same `game_frame_count`**,
     and `screenshot`/result to confirm the game continued cleanly. This is the pass/fail gate.
6. **Manual drop — trigger B (§5, §8).** proto `RequestDrop` `ControlFrame` kind + client send API;
   relay validation (straggler-only) → `decide_leave`; game-seam **re-route of the native "Drop
   Players" action** through `spawn_dialog_hook` into a `RequestDrop` send (the RE item in §13 gates
   this). Test: a survivor requests a drop of a deliberately-lagged (not disconnected) peer; the leave
   fans out and applies deterministically on all survivors.
7. **Self-disconnect (§8a).** Seam detection of connection-down (closed channel while in-game) →
   app-side "connection lost, [Leave]" prompt (+ timeout) → resolve to the existing disconnect
   end-game path; suppress the misleading peer-drop dialog. Test: sever one client's relay link (not
   the others'); it shows connection-lost and, on give-up/timeout, ends with a disconnect loss and
   returns to menu while the others get its leave and continue — no stuck client, results agree.

Estimated shape: proto + client tracker + relay decide/trigger are each small and well-templated; the
game-seam IN-hook change is small. The spots that need real care: the **cross-relay authority-handoff
re-derivation** (§10), the **"Drop Players" re-route** (RE-gated, §8/§13), and getting
**self-disconnect wired to the *existing* end-game path** rather than a new one (§8a).

## 13. Open questions

- **"Drop Players" re-route mechanics (§8).** The native waiting/drop dialog's `Dialog` name and its
  "Drop Players" child control (id + the event that today reaches `pending_leave_reason`) — needs a
  short BinaryNinja confirm against the 12409 BNDB so `spawn_dialog_hook` can match the dialog and
  replace that control's event with a `RequestDrop` send. This is the one RE item that could reshape
  §8's implementation. (We keep the dialog's "waiting for players" display — SB has no replacement for
  it.)
- **Manual drop: single request vs. quorum, and the straggler threshold (§5).** Straggler-validation
  already forecloses griefing, so v1 can honor a single validated `RequestDrop`; decide whether a
  quorum of connected players is worth adding, and pin the exact "how far behind = draggable straggler"
  threshold (a function of the buffer). Also: rate-limit `RequestDrop` so a client can't spam the
  authority.
- **Self-disconnect end-game entry point (§8a).** Confirm the exact existing "you've been
  disconnected" end-game path to reuse (`NetworkError` variants in `network_manager.rs` /
  `game_state.rs` and how it surfaces as a game status the app renders), rather than adding a new one.
  Also decide whether to also suppress the native waiting dialog outright in the self-disconnect state
  (it's about healthy peers) or let the end-game teardown race it away.
- **`decide_leave` apply-frame vs. a mid-flight buffer change.** If a buffer directive and a leave
  directive are both pending with overlapping windows, they're independent (different fields, different
  seq spaces) and both apply at their own frames — but confirm no interaction where a buffer resize at
  frame F and a leave at F+1 change the survivor set the buffer was sized for. Likely benign (the
  buffer re-sizes off live conditions next sample anyway), but worth a test.
- **Round-robin `Option` vs. bounded `Vec` for simultaneous leaves (§6).** Decide with a stress test;
  default to `Option` + round-robin for wire-minimalism.
- **Clean-quit leave-intent channel.** ~~Whether a clean quitter's "left" reason + true final frame
  is worth the reliable-control-stream round-trip~~ — **decided and being built (§16/§16a):** the
  intent both fixes the "dropped" wording and removes the survivors' process-exit + ~10s stall,
  which turned out to be the bigger win.

## 14. Live-proof finding (2026-07-04): leave delivery must not ride the turn stream

The first live single-relay proof (3-player same-relay, `forceQuit` on the third) **failed**, and the
failure was fundamental — the design's delivery mechanism was circular. Recording it because the
reasoning is subtle and a future reader would otherwise re-introduce it.

**What happened.** `forceQuit` killed the third client; the relay detected it (QUIC idle-timeout),
`decide_leave` fired correctly (`synced player-leave decision slot=2 apply_at_frame=1088`). But the
two survivors never applied it — and worse, **their own links also timed out** (all three closed
within one millisecond). The game was dead, not recovered.

**Root cause — the leave rode the turn stream, which a drop stops.** The directive was stamped onto
the `Payload` envelope of forwarded turns. But on any drop, lockstep stalls *every* remaining player
(they're all waiting on the departed slot), and each survivor's send cursor blocks once its pipe is
full — so **the survivors stop producing turns**. The leave is only *decided* after the drop is
*detected*, by which point there are no new turns for the relay to stamp it onto. The directive that
exists to end the stall can only travel on the traffic the stall has already killed. The earlier
"the survivor reaches the apply frame by consuming peers' turns, which carry the stamp" was exactly
backwards: the survivor is stalled *before* the apply frame, and the turns that would carry it don't
exist. Second failure: with no app data flowing, the survivors' idle QUIC connections timed out too,
so the relay dropped them as well.

**The fix (two parts).**
1. **Deliver the leave over the reliable control stream** — the relay pushes a
   `ControlFrame::LeaveDirective` down each surviving client's reliable QUIC stream when `decide_leave`
   fires. This is independent of turn flow, so it arrives precisely when turns have stopped. The
   turn-envelope path (`Payload.leave_directive` + `active_leave` stamping) is removed; the round-robin
   and retire-on-frame machinery goes with it (a reliable one-shot push needs no re-broadcast window).
   `decide_leave` still computes `(slot, reason, apply_at_frame)`; only the *delivery* changes.
2. **QUIC keep-alive on client connections** — set `keep_alive_interval` (< the idle timeout) on the
   client endpoint so a stalled-but-alive survivor keeps sending PINGs and is not idle-dropped. This
   also turns the idle-timeout into a *clean* drop detector: only the genuinely dead client (no PINGs)
   times out; live-but-stalled clients survive until the leave arrives and unstalls them.

**Why the buffer directive is unaffected.** A buffer change happens *during* normal play, when turns
are flowing, so the envelope delivers it fine. A leave happens exactly when they stop. That's the
whole distinction, and it's why leaves need their own (reliable) channel while the buffer keeps the
envelope.

**Bonus — this restores automated testability.** The native "Drop Player" dialog is *inert* in v2
(the seam replaced Storm's turn collection, so it can't clear a `required` slot), so a human clicking
it does nothing. With the control-stream push, the coordinated leave fires automatically on the real
drop — no human in the loop.

**✅ RE-PROOF PASSED (2026-07-04).** Same 3-player same-relay loopback, `forceQuit` the third: the
relay logged **exactly one** link close (slot 2) and **one** leave decision (`apply_at_frame=753`),
the survivors' links **stayed up** (keep-alive — no cascade), and both survivors applied the leave and
continued **perfectly synced** to a real game result — zero desync (the inline sync checksum is the
judge). Fired automatically, no human. The native waiting dialog appeared during the ~10s
idle-timeout window before the leave arrived — the reason for the §15 replace-the-dialog task.

## 15. Decisions after the live proof (2026-07-04): auto-removal exclusive; drop the manual path

> **Superseded in part by §17 (same day):** auto-removal remains correct **for v1** (no reconnect
> exists, so waiting is pointless), but the *target* end state reinstates a manual, grace-gated
> drop on our own overlay once reconnect lands — see §17 for the full UX direction. The reasoning
> below still governs what ships now.

Discussed with Travis while fixing §14. Two decisions that both **simplify** the design:

**Auto-removal is the sole leave trigger for v1 — the manual "Drop Player" path (Trigger B /
`RequestDrop`) is dropped.** Native behavior is that a dropped player's slot stays until a human
clicks "Drop Player" (at a 40s drop-timer), with the game *frozen* meanwhile. Auto-removal just
resolves that freeze automatically at ~10s (the client-edge idle timeout, §14). In v1 there is no
reconnect path, so a 10s idle-timeout disconnect is genuinely permanent — waiting for a human only
prolongs the freeze with no benefit, so auto-removal is strictly better than native, not a
regression. **Consequences:** §5's Trigger B, §6's `RequestDrop` control frame, and §8's Drop-button
re-route are all **removed from scope** — which also **drops the BinaryNinja RE dependency** that
gated §8. The one thing manual-drop uniquely did — kick a *connected-but-lagging* laggard who never
fully disconnects — is deferred; for v1 the latency buffer (D9) absorbs a laggard, or they eventually
lag enough to disconnect and get auto-removed. It can be added back later on this same delivery path
if it proves needed.

**Reconnect (D11) is where auto-removal grows a grace period.** Travis's caveat — "once 40s pass
they're extremely unlikely to reconnect, but reconnect logic down the road might change that" — maps
exactly to §11: when reconnect lands, the trigger holds G seconds before deciding the leave (letting a
reconnect+resync happen), and only fires on grace expiry. The "40s" intuition *is* that grace length.
v1's immediate ~10s trigger is correct because there's nothing to wait for yet.

**New UI task — replace the native waiting/drop dialog with an info overlay.** With auto-removal
exclusive, the native "Drop Player" button is meaningless (and inert in v2), so players shouldn't see
it. Replace the native dialog with our own overlay: a "waiting for player… / player dropped" info
surface (a good opportunity to show *which* player and *why*), sharing the connection-lost overlay
work with §8a (self-disconnect). This supersedes §8's "re-route the button" plan — we *replace* the
dialog rather than re-wire its button.

## 16. Next task — clean-leave intent ("player left" vs "player dropped")

Surfaced live (2026-07-04): a player who quits via the F10 menu shows to the others as **"player was
dropped"** instead of **"player has left"**. This is the §8b/§13 clean-quit reason item, now worth
building. It is cosmetic (the game continues correctly either way — the reason byte doesn't affect
determinism, since the relay hands the same reason to all survivors), but visible and wrong.

**Root cause:** every departure currently routes through Trigger A (link death → idle timeout →
`decide_leave` with `LEAVE_REASON_DROPPED`). A clean quit looks identical to a hard drop, so it gets
the "dropped" reason and waits the full ~10s idle timeout.

**The fix — a leave-intent the quitting client sends up its control stream before disconnecting.**
Four pieces, all mirroring the leave machinery already built:
1. **proto** — a new `ControlFrame` kind `LeaveIntent` (client → relay). Fieldless: the relay
   knows the slot from the connection, and the reason is "left".
2. **relay** — handle `LeaveIntent` in the `control_rx` branch (currently it just warns on a
   client-sent leave). On receipt: `decide_leave(slot, reason=left)` + `fan_out_leave` **immediately**
   — so a clean quit both shows "left" *and* skips the ~10s idle-timeout stall for the survivors —
   then **end the slot's serve loop** (see the ordering hazard below; the post-loop `decide_leave`
   dedups by slot, so the normal cleanup path is a no-op). **Reason value = `3`** (RE-confirmed
   2026-07-04, §16a): the peers' handlers branch on `reason != 0x40000006` → `strPLAYER_LEFT`, and
   `3` is exactly what a native voluntary quit stores on the other clients.
3. **client crate** — a game → driver path to send a `LeaveIntent` (the reverse of the `leaves`
   channel: a `leave_intent` sender on `TurnChannels` the driver drains and writes via a new
   `send_control_leave_intent`), with **flush-then-leave** semantics (below).
4. **game/DLL** — trigger it **when `run_game_loop()` returns** (`game_thread.rs`, right before
   `send_game_results()`), via a sync `with_turn_state` call. No new BW hook and no RE dependency:
   the loop returning is precisely "this client will never produce another turn," it covers both the
   F10 quit *and* a natural game end (harmless there — the session is ending anyway), and it happens
   within a few turns of the menu click (§16a). Crash/`forceQuit` never reach it → those stay on the
   drop path, as they should. The earlier worry that this is "too late — the QUIC connection may
   already be gone" turned out backwards: `clear_session()` is currently never called, so the link
   (kept up by keep-alive) outlives the whole result flow until process exit — which is also *why*
   survivors today stall for the quitter's process-exit time **plus** the ~10s idle timeout.

**The ordering hazard the intent introduces — and the two-sided fix.** The intent rides the
*reliable control stream* while the quitter's final turns ride *datagrams*; QUIC gives no ordering
across the two, so a naive intent can overtake the last turns and freeze a stale
`departed_last_frame` into `apply_at_frame` — worse, turns arriving at the relay *after* the
decision could still be forwarded to survivors past the agreed apply frame, and (because
end-of-stream retransmission is best-effort per survivor) different survivors could hold different
final-turn sets. The drop path never has this race: a dead link is definitionally final. Fix:
- **Client (flush-then-leave):** on the intent signal the driver does not send immediately; it keeps
  draining `outbound` and re-carrying unacked turns until the outbound queue *and* the unacked
  window are both empty (the relay has acked every turn, so its `slot_last_frame` is final), then
  writes the intent. A short safety bound (~2s) sends it anyway if acks stop — at that point the
  link is effectively dead and the drop path covers us; the relay-side cut keeps even that case
  deterministic. This is the old netcode's "flush the stream on leave," rebuilt on the new
  transport. After the intent is written, the relay closing the link is the expected confirmation —
  the driver treats it as a clean shutdown, not a link failure.
- **Relay (cut at the intent):** the slot's link task processes control frames and datagram ingress
  in one serialized loop, so on `LeaveIntent` it decides + fans out the leave and then **stops
  forwarding that slot's turns** (ends the serve loop). Every survivor therefore sees the identical
  final-turn prefix and the same `apply_at_frame`, no matter how the datagrams raced.

**Test:** 3-player netcodeV2 loopback; on one client, quit via the F10 menu (not `forceQuit`, which is
a hard kill); assert the survivors see the leave applied with the "left" reason (and promptly, no
~10s stall). `forceQuit` remains the *drop* path (Trigger A / "dropped"). The same run must also
watch for the native id-0xb hazard (§16a): survivors showing "left" *before* the directive's apply
frame, or any desync, means the native async leave path is live in v2 and needs the §16a
neutralization.

## 16a. RE findings (2026-07-04, 12409 BNDB): the native voluntary-quit anatomy

A BinaryNinja pass pinned exactly what SC:R does on an F10 quit; recorded because it shapes the
trigger choice above and flags one hazard.

**The native quit is a graceful, in-band handshake — three phases:**
1. **Initiation** (`sub_7479c0`, reached from the quit-dialog handler `sub_700230`): arms a
   leave-state global, zeroes per-player leave-ack arrays, and **tail-calls
   `flush_local_turns_to_latency_depth()`** — the native "flush the stream on leave."
2. **The `0x54` leave command + ack wait:** the leave state machine emits a one-byte `0x54` command
   into the ordinary outgoing-command turn stream (`send_command` → turn flush → `send_turn_message`
   — i.e. **through our OUT hook in v2**; we don't strip `0x54`, so peers receive it over QUIC and
   the handshake still works). A per-frame driver (`sub_748e60`) keeps stepping the network until
   every remaining player has acked the leave, so the quitter's game loop ends only a few turns
   after the click — this is what makes the *loop-end trigger* both prompt and safe.
3. **Teardown** (`sub_750890(3)` → `sub_7b0670`): broadcasts an async **id-0xb "leaving" packet** to
   every peer via Storm → **the SNP shim**, then destroys the provider a few instructions later. On
   peers, that packet surfaces as `'SNET'` event 3 → `handle_player_leave_message` (`0x74fee0`),
   which writes `pending_leave_reason[slot] = 3` (defaulting to `3` when the payload is absent/zero).
   The game-over path (`finish_game`) calls `sub_750890` directly — no `0x54` handshake — so
   loop-end is the one trigger that covers both.

**Reason values (Q4):** both `handle_player_leave` (`0x74ff90`) and `process_ingame_player_leave`
(`0x750390`) branch only on `reason != 0x40000006`: `0x40000006` → `strPLAYER_WAS_DROPPED`,
everything else → `strPLAYER_LEFT`. A voluntary quit produces **`3`**. So the relay's
`LEAVE_REASON_LEFT = 3` reproduces native wording exactly.

**Hazard — the id-0xb packet is a potential non-consensus leave writer on survivors.** It travels
over the still-native Storm/SNP session path (Scope B hasn't rerouted it), and if it lands,
`handle_player_leave_message` writes the survivor's leave mailbox at that survivor's *own* time —
racing our directive and (in a 3+ player game) desyncable. The observed F10 behavior (survivors
showed "dropped" only after the ~10s idle timeout, no early "left", no desync) says this path is
**inert in v2 games in practice** — but *why* is unconfirmed (plausibly the quitter's process ends
before the async SNP send flushes, or the packet's delivery presumes Storm state the seam bypassed).
The §16 live proof must watch for it explicitly. If it ever fires, the neutralization is a
v2-gated no-op hook on `handle_player_leave_message` (`0x74fee0`) — findable for samase_scarf as
the handler registered under **event id 3 of the `'SNET'` (0x534e4554) callback map** in
`init_storm_networking` (`0x742550`), the sole writer of `pending_leave_reason` from a network
event.

**Future upgrade path (not v1):** hooking `sub_7479c0` (initiation) would fire the intent at the
menu click itself, a few hundred ms earlier than loop-end, and could front a "player is leaving"
UI. samase_scarf signature: the only function that stores `1` into the leave-state global (the one
`sub_748e60` compares against `2`), zeroes the two adjacent ack arrays, and tail-calls the
turn-flush routine; its sole caller is the quit-dialog handler. Not worth the analyzer addition for
v1's cosmetic gain.

**Rejected trigger — detecting `0x54` in the OUT hook.** Tempting (the OUT hook already scans
outgoing commands in `strip_control_commands`, so spotting the quit command needs no RE at all and
fires at the earliest possible instant), but wrong: the intent makes the relay **cut the slot**,
and at `0x54` time the quitter's BW is still *inside* the leave handshake — stepping the network,
producing turns, waiting for every peer's ack. Cutting then strands the handshake and hangs the
quitter in the leave driver; *not* cutting instead would let the quitter's post-intent turns reach
survivors past the frozen `apply_at_frame`, which is exactly the determinism race §16 closes. The
loop-end trigger has neither problem: by the time the loop returns, the handshake is complete and
the quitter is truly done producing turns. (Corollary: if a live run ever shows the F10 quit
hanging *before* the loop ends, the native ack half of the `0x54` handshake isn't completing over
v2 — fix that, don't move the trigger.)

## 17. Target disconnect UX (2026-07-04, Travis) — direction for §8a/§15/D11

Recorded from discussion after the §16 proof. This is the **end state** the connection-lost work
should be shaped toward; v1 ships the interim behaviors already built (auto-removal ~10s, §15),
because without a reconnect path waiting is pointless. The pieces:

**Disconnected player's side:** "You've lost connection — [Reconnect] [Abandon]." Reconnect is a
first-class *user* action (alongside/atop D11's automatic attempts), abandon resolves to the
disconnect loss (§8a's existing end-game path). Being disconnected from a relay must stop being a
permanent state: the client can dial a new connection and rejoin the *same* game, provided the
others haven't dropped it yet.

**Survivors' side:** an overlay naming **which player(s) are currently disconnected**, with a
grace timer (~45s, native-drop-timer intuition) before a **manual "Drop"** action unlocks.
Dropping stays a human decision even after the timer — important events or friendly games may
choose to wait minutes for a reconnect. So the removal flow becomes: relay detects link death →
broadcasts "slot X disconnected" (a connection-state control frame, NOT yet a leave) → survivors
stall/wait under the overlay → either X reconnects+resyncs (D11), or a survivor clicks Drop →
`RequestDrop` up the control stream → authority `decide_leave(dropped)` → the §6 directive path.

Design notes:
- **This reinstates Trigger B / `RequestDrop` (§5) — but without §8's old RE dependency.** The
  button lives on *our* overlay (§15's replacement dialog), not the native one, so no BinaryNinja
  work gates it. The D10 anti-grief validation also gets simpler and tighter than the old
  "straggler" heuristic: the authority honors a `RequestDrop` only for a slot it *knows* is in the
  disconnected state with the grace elapsed.
- **Auto-removal's role shrinks to the interim.** Today (no reconnect): auto at ~10s, correct.
  End state: detection produces a *disconnected state*, not a leave; the only automatic leave
  might be a very long backstop (or none — native waits forever too). The §11/§15 "grace period"
  framing maps onto this: the 45s is the *drop-unlock* timer, and the relay holds the slot
  recoverable until an actual drop is requested.
- **"Feels like a paused game, not a modal" — the chat problem.** In-game chat is a game command
  riding the turn stream, which is precisely why chat works during a native *pause* (sim stops,
  turns keep flowing) and dies during a *stall* (turns stop — survivors' send cursors block on the
  disconnected slot). Survivor↔survivor chat during the wait therefore needs **out-of-band chat on
  the reliable control stream** (a new ControlFrame kind, relay-fanned-out). Open question: replay
  interleaving — replays are per-client recordings, so each client stamping received out-of-band
  chat at its own current frame may be acceptable cosmetic divergence; unresolved.
- **Prerequisite ordering:** cross-relay leave routing (mesh `SlotDeparted` + handoff
  re-derivation) stays first — this UX sits on top of a leave machine that must already be correct
  on every topology. Then the overlay (§15) + self-disconnect (§8a) built to THIS shape (named
  players, timer, non-modal), initially wired to v1 semantics; D11 reconnect fills the
  [Reconnect] branch and the drop-gating.

**Related, separate item — pause on netcode v2 (to verify, after leave work).** Native pause is a
synced turn-stream command and turns keep flowing while paused, so the seam *should* carry it
unchanged — but nobody has proven pause/unpause through the v2 transport (and the §16a `0x54`
handshake shows quit-adjacent flows have surprising native structure). Verify in a live 2-player
game: pause, chat while paused, unpause, confirm no stall/desync.

## 18. Cross-relay propagation — BUILT + LIVE-PROVEN (2026-07-04)

The §5/§9/§10 cross-relay machinery landed in rally-point2 (branch `synced-leave`, commits
`5aa759f` mesh leave propagation, `139c6ad` mesh cert pinning) and passed the two-relay
three-player live proof. What was built, and where the implementation corrected this document:

**Transport: a mesh control stream, and SlotDeparted is a broadcast.** Each relay-pair's QUIC
connection now carries one bidirectional reliable stream (mesh ALPN `rp2-mesh/3` → `/4`; the
dialer opens it after its hello and writes an empty establishment frame — QUIC doesn't surface a
bidi stream to the peer until the opener writes). It carries length-prefixed `MeshControlFrame`s
(`{session, oneof {SlotDeparted, LeaveDirective}}`), sharing the client edge's framing and size
cap. `SlotDeparted {slot, optional last_frame, reason}` is **broadcast to every link serving the
session**, not routed to "the" authority: `Authority` is just `SelfRelay|Peer` (no peer id), and
the broadcast is exactly what makes every relay hold the departure record §10's handoff needs.
The authority ingests it and authors the one `LeaveDirective`, which is likewise broadcast to
every link; each relay caches it (dedup by slot) and pushes it down its own local survivors'
control streams. No echo: a received directive is never re-broadcast.

**§4's apply-frame formula, corrected: `apply_at = departed_last_frame + 1`, full stop** (the
session frame only as the fallback when the slot never framed). The `max(last, session_frame)`
formula was *value-identical* in every reachable state — `session_frame()` is a min over
slots-with-frames, and while the departed slot is still in the map the min can't exceed its
frame — but it silently depended on that presence. On a relay where the slot's state was removed,
a survivors-only min can EXCEED the departed frame (survivors' send stamps lead execution by the
buffer depth before they stall), and a max would schedule the leave past the stall point a
survivor can actually reach — an unreachable apply frame, i.e. a permanent stall. Survivors park
at exactly `departed_last + 1`, which is therefore always the right and reachable answer.

**Departed slots leave the live roster on every relay — and there is no leave retirement.** Only
the home relay used to `remove_slot`; on every other relay the departed slot's frozen frame would
pin `session_frame()` forever (freezing the buffer directive's dwell clock and retirement — the
D9 machinery would stop adapting for the rest of any cross-relay game after one leave).
`note_departure` now snapshots the frame into the departure record and removes the slot from the
live map on every relay, and departed slots can't resurrect via late frames or stale conditions
samples. The §10 "retire once session_frame ≥ apply_at" idea was **dropped entirely**: send
stamps lead execution, so that predicate is true both when everyone applied the leave and when
everyone is stalled waiting for it — a predicate true in both states can't gate re-delivery.
Instead: push once at decision time, re-push unconditionally on authority promotion and on mesh
link (re)join. Every consumer dedups by slot, so redundancy is free (≤ slot count, rare events).

**§10 handoff, as built:** promotion re-broadcasts every cached directive **verbatim** (the
apply frame is never recomputed — survivors that applied it did so at that exact frame; clients
also debug_assert same-apply-per-slot) and decides fresh only for a recorded departure whose
directive never escaped the dead authority (in which case no client applied one, so a fresh frame
is safe). Departure records and directive caches deliberately survive demotion.

**Mesh cert pinning (`139c6ad`)** — pre-existing blocker the proof flushed out: relays self-sign
dev certs, clients pin them via the session response, but the mesh dialer validated against
generic roots → two real relays could never mesh (`BadSignature` on every dial; all prior mesh
tests shared in-process certs). `RelayPeer` in the session descriptor now carries the peer's
enrolled `cert_der` and the dialer pins exactly that cert (configured roots only as an
old-coordinator fallback). The cert is part of the dial identity: a peer re-enrolling with a
fresh cert retargets the dial supervisor like an address change.

**Live proof (two relays, three players, loopback).** SB side: `SB_RP2_SPLIT_RELAYS=1,2` (new
dev knob in netcode-v2-service.ts) homes slots 1,2 on the backup relay — relay1 got slot 0 and
authority, relay2 got slots 1,2; mesh link established via the descriptor-pinned certs; turns
crossed both directions. Proven, all with zero relay WARN/ERROR and clean game logs:
- *Peer-homed drop:* forceQuit slot 2 (relay2) → link death detected → `SlotDeparted` crossed
  the mesh → relay1 decided (~340µs after detection; reason dropped, `leave_seq=1`) → directive
  reached the relay1 survivor locally and the relay2 survivor back across the mesh → **both
  flipped the slot to `required:false` and played on synced**.
- *Authority-homed drop:* fresh game; forceQuit slot 0 (relay1's own client) → local decision →
  directive crossed the mesh → both relay2 survivors applied.
- *Promotion with cached leave:* relay1's roster emptied → relay2 promoted logging
  `rebroadcast_leaves=1` (the cached directive re-pushed verbatim, live).
- *Post-promotion decision:* forceQuit slot 1 → relay2 (now authority) decided with
  `leave_seq=2` — numbering correctly continued above the observed seq.
- *Real result:* the last survivor got Victory and reached `resultSent`.

**Remaining manual check (needs a human):** an F10 quit from a *peer-homed* client while others
play on — the LeaveIntent → non-authority home relay → mesh `SlotDeparted(reason=left)` →
authority path. Both halves are individually proven (intent→announce same-relay in the §16 proof;
announce→mesh→decision→fan-out in this one) and the code path is the same `announce_departure`
call, but the composed flavor hasn't run live. Thirty seconds with F10 when convenient.

**Victory-dialog observation (not a bug):** the clean-leave intent fires when `run_game_loop`
returns, but a natural Victory leaves the loop running at the in-game victory dialog until the
player clicks through (results are collected and sent by the separate victory-detection path
meanwhile — `resultSent` does not imply loop end). An unattended winner therefore exits via the
drop path when its process ends, which is harmless — but worth remembering when reading logs:
"no intent from the winner" is the dialog, not a regression.

## 19. Departure classification and the victory dialog (2026-07-04 investigation)

Prompted by a concern about the coming relay → coordinator → app-server *departure notification*
(the signal that will feed §17's "survivors see who's out" UX): a winner sitting on the victory
dialog exits — when its process finally ends — via the drop path (link death → `SlotDeparted`
reason=dropped), which would be a **false "dropped"** for a game that actually just ended normally.
The question was whether to fire a clean leave earlier, at the moment the game is decided.

**RE finding (12409 BNDB).** The outgoing turn path — `step_network` (`0x749063`) →
`flush_local_turns_to_latency_depth` (`0x748800`) → `flush_outgoing_command_turn` (`0x74c420`) →
`send_turn_message` (call site `0x74e2bb`) — is gated on exactly two things: `network_ready` (set
purely from receive success/failure) and `menu_screen_id != 0x21` (you are still on the in-game
screen, not the score/stat screen). **There is no victory/defeat/game-decided flag anywhere in the
send path.** With an empty command buffer the flush emits a 1-byte keep-alive turn, so a player who
issues nothing still feeds lockstep. Slot removal from the required set is entirely event-driven
(`handle_player_leave_message` `0x74fee0` / the pending-leave path, reached only by a real network
leave or the quit-confirmation handshake `sub_7479c0`); nothing on a victory path writes leave
state. Therefore "Continue Playing" (which keeps `menu_screen_id` on the in-game value and the loop
running) keeps the client SENDING turns, and co-winners who both continue stay in lockstep with
each other — victory does not touch the required-slot set.

**Live confirmation (two 3-player single-relay loopback runs).**
- *Continue Playing stays networked:* claude-1 + claude-2 (allied) won when claude-3 (unallied) was
  defeated at frame ~347; both winners then continued and stayed in live lockstep for ~5,700 frames
  (to ~6034/6142) before leaving. Network traffic visibly continued between them after "Continue
  Playing" — the RE, confirmed in the app.
- *Result locks at the victory dialog:* eliminating the other continuing player after "Continue
  Playing" did not re-decide anything — F10 → End Mission still produced the already-locked victory.
  Results + replay are already sent by the DLL at the victory dialog today, so the app server holds
  the terminal result the moment a winner is sitting there.
- *Graceful exits are already clean:* every departure across both runs — a natural defeat and both
  continue-then-End-Mission winners — logged relay `reason=3` (clean "left"), never dropped. The
  false "dropped" appears **only** on an *ungraceful* exit (crash, force-quit, closing the window),
  which no game-side trigger can catch because the process is simply gone.

**Decision: the departure notification keys on the DLL's already-sent result, not on any game-side
trigger.** Since a graceful exit already emits a clean leave and the app server already has the
game's terminal result at victory-dialog time, the notification consumer **ignores (or reclassifies)
a departure for a game+player it already holds a terminal result for.** That covers the one
remaining case — the ungraceful exit — robustly, without any in-game victory/defeat hook (which
could not catch a crash anyway, and, per the RE, has no safe earlier moment to fire at: the client
is a full lockstep participant right up until it leaves to the score screen). No game-DLL change is
required for notification correctness.

**Corollary (optional cleanup, not required).** Networked "Continue Playing" is a footgun: it keeps
a *decided* game in live lockstep for no benefit. A tidy end state is to close the v2 session
cleanly when the victory dialog shows and let "Continue Playing" run solo/local-only. The wrinkle:
the seam hooks fall through to native Storm when there is no session, but scope C removed native
join/Storm setup, so a solo continuation needs the seam to transition to *zero peers required,
local-only* rather than fall into the dead native path. Simplest v1 is therefore to make the
victory dialog End-Mission-only (drop the networked-continue option); the solo-sandbox version is a
nicer stretch gated on that local-only transition. Either way this is cleanup, orthogonal to the
notification correctness above.

## 20. Departure notification — relay → coordinator → app server (design, 2026-07-04)

The concrete design for §19's decision: get "player X departed mid-game, left vs dropped" to the
app server, with the app server ignoring/reclassifying any departure for a game+player it already
holds a terminal result for. Three legs, each riding or minimally extending something that already
exists. No game-DLL change (per §19).

**Correlation ids — the tenant's names go on the wire at session create.** The coordinator's
`SessionRequest` gains `external_id: Option<String>` (ShieldBattery sets its `gameId`) and
`PlayerHandoff` gains `external_ref: Option<String>` (the `SbUserId`, stringified). The coordinator
stores both in its per-session setup record and echoes them in the webhook, so the notification
arrives at the app server **self-describing** — no app-server-side session→game map has to survive
restarts or span processes (today the netcode-v2 service deliberately retains nothing after
`createSessionForGame` returns, and that stays true). Optional fields; the control protos don't
`deny_unknown_fields`, so old/new peers interop.

**Leg 1 — relay → coordinator, on the existing control WebSocket.** New up-frame variant
`RelayToCoordinator::Departure { tenant, session, slot, kind, reason, leave_seq }`, where
`kind ∈ {left, dropped}` is mapped at the relay (`reason == LEAVE_REASON_DROPPED` → dropped, else
left — the relay owns those constants; the raw `reason` rides along for debugging). **Fire on the
directive-cache insert**: a relay sends exactly one Departure per (session, slot), at the moment a
`LeaveDirective` for that slot first enters its consensus cache — that is `decide_leave` success on
the authority, `observe_leave` first-insert on every other relay (mesh broadcast and
reconcile-on-join both funnel through it). Every relay serving the session reports independently
and the coordinator dedups, so the notification survives any single relay's coordinator link being
down (the same redundancy-plus-dedup philosophy as §18's re-push rule). The sender is an unbounded
mpsc drained by `connect_and_stream`'s select loop; the channel rides across reconnects, so a
departure decided while the coordinator is restarting is delivered on redial, not lost.

**Leg 2 — coordinator → tenant, a webhook POST.** The coordinator gains per-tenant notify config —
`notify_url` + `notify_secret` (dev: `--dev-notify-url`/`--dev-notify-secret` alongside
`--dev-tenant`; unset = notifications off, everything else unchanged). On a Departure frame the
coordinator dedups by (tenant, session, slot) in memory, enriches with the stored
`external_id`/`external_ref`, and POSTs JSON (snake_case, like the rest of the control plane):
`{ tenant, session, external_id, slot, external_ref, kind, reason, leave_seq }` with
`Authorization: Bearer <notify_secret>`, retrying on non-2xx/connect failure with capped backoff
(~6 attempts over ~1 min, then warn and drop — the consumer is an *optimization feed*, §19's
correctness rule makes a lost webhook degrade to today's behavior). Delivery is at-least-once
(coordinator restart forgets the dedup set; a late reconcile-driven Departure can re-fire) — the
app server end is idempotent, so redundancy is free. This is the coordinator's first tenant-push
channel; per-tenant *inbound* auth on `/session/create` remains the separate, already-tracked open
item.

**Leg 3 — app server ingest + classification.** New machine-caller endpoint
`POST /api/1/netcode-v2/departures` — no login (the caller is the coordinator), gated by
`Authorization: Bearer <SB_RP2_NOTIFY_SECRET>` (env; unset = endpoint rejects, feature off) plus an
IP throttle, mirroring the results2 "secret-bearing machine caller" precedent. Handler:

1. Parse `external_id` → gameId, `external_ref` → userId; unknown game/user → log + 204 (don't
   oracle).
2. **The §19 rule, enforced in SQL:** record the departure with a conditional UPDATE on
   `games_users` — `SET departure_kind, departure_time WHERE game_id/user_id match AND
   reported_results IS NULL AND result IS NULL AND departure_kind IS NULL`. Zero rows = moot
   (result already held, or already recorded — the race with a concurrent results2 submission is
   settled by the database, not by app code) → log "reclassified/ignored". One row = a genuine
   mid-game departure, now durably recorded with the left-vs-dropped distinction the app server
   cannot derive on its own.
3. New columns (migration): `games_users.departure_kind` (nullable text, 'left' | 'dropped') +
   `departure_time TIMESTAMPTZ`. Nothing is pushed to clients yet — that wiring is the §17
   overlay/UX task (deliberately with Travis); this leg is the durable, queryable feed it will
   read from.

**Timing note (correct by §19, worth stating):** a *clean mid-game* quitter's webhook usually
arrives before their own client's results2 POST — that is a genuine departure of an undecided game
and records as `left`. A winner idling on the victory dialog whose process later dies arrives as
`dropped`, but their results were sent at the dialog, so `reported_results` is set and the UPDATE
matches zero rows — the §19 false-positive is discarded exactly where the design intended.

**Deliberately out of scope:** coordinator session-lifecycle cleanup (Departure events could
eventually drive "all slots departed → forget the session", fixing the coordinator's
grow-forever session map — noted, separate); any client-facing push (§17 task); per-tenant
inbound auth on session/create (pre-existing open item).

### §20a. As built + live-proven (2026-07-04) — deltas from the design above

Built on rally-point2 `synced-leave` and SB `rp2-integration`; all three legs live-proven on
loopback. Decisions that changed or firmed up during implementation and review (the rest landed
as designed):

- **The endpoint moved to `POST /webhooks/netcode-v2/departures` on a dedicated early
  middleware mount** (Travis). A general `/webhooks` router (`server/webhook-routes.ts`) sits in
  app.ts right after log/error-payload middleware and *before* redirect-to-canonical, the CSRF
  origin check, the shared body parser, JWT/session, CORS, secure headers, and static serving —
  webhook callers are machines with their own bearer auth, so the browser-oriented machinery is
  useless-to-harmful for them (the origin check 403'd the first live round). Routes on this
  mount parse their own JSON-only bodies. Future webhook consumers register here too.
- **Webhook body is camelCase** (`externalId`, `externalRef`, `leaveSeq`) — it lands on SB's API
  surface, so SB's convention wins over the rp2 control plane's snake_case (Travis). The
  `/session/create` *request* stays snake_case (it's rp2's API). Absent correlation ids are
  omitted, never `null` (the consumer's schema treats them as optional strings).
- **Auth strictly precedes body validation** on the SB endpoint: unset `SB_RP2_NOTIFY_SECRET` →
  404 for everyone (endpoint existence hidden), wrong bearer → 401 before any validation error
  can leak the expected body shape. Verified over the wire with curl.
- **Promotion re-derivation also fires the relay's departure notice** (review fix): the
  fire-on-first-cache-insert rule covers decide_leave, observe_leave, AND a promoted authority's
  fresh derivation — the "directive never escaped the dead authority" case would otherwise go
  entirely unreported when no peer relay survives to observe it.
- **Coordinator webhook client is hyper/hyper-util plain-HTTP** (already in-tree via axum; keeps
  the ring-only, aws-lc-rs-free workspace pin). An `https://` notify URL needs a rustls(ring)
  connector — prod TODO in `notify.rs`.
- **Auth follow-up (Travis asked; agreed direction):** the static bearer is a legitimate v1 but
  not the end state — upgrade to HMAC-signed payloads (secret off the wire, replay-windowed) or
  fold into the per-tenant credential story alongside the still-open `/session/create` inbound
  auth. Same problem, solve once.

**Live proof (2-player loopback, single relay).** The §19 backstop finding got *stronger*: even
`forceQuit` produces a result submission (the Electron app's fallback reporter), so the only true
"no result" departure is app+game both dying — simulated by killing claude-2's Electron then its
StarCraft process directly. Matrix observed through the full pipeline (relay decision →
coordinator dedup+enrich → webhook → SQL classification), each within ~100ms of the relay's
decision, webhook delivered first-attempt:
- *dropped + recorded*: the true-crash kill — relay idle-timeout → `kind:"dropped"` webhook →
  `games_users.departure_kind='dropped'` written for the crashed player (no `reported_results`).
- *dropped + ignored*: plain forceQuit — the app's fallback results2 landed first, conditional
  UPDATE matched zero rows, logged "departure ignored".
- *left + ignored*: the winner quitting after the victory dialog (results already sent at the
  dialog) — clean-leave intent → `kind:"left"` webhook → ignored. The §19 false-positive is
  discarded exactly as designed.
- *left + recorded* (mid-game F10 of an undecided game) is the one flavor not live-run — needs
  human input; identical code path, classification decided by the same WHERE clause, unit-tested
  both sides.

### §20b. Follow-up slice (2026-07-04, same day): evidence retention, always-present refs,
### signed webhooks, https

Driven by a Travis adversarial scenario — a cheater blocks their own relay link (but not the app
server), plays out a fake solo "win", and submits it; both players claim victory; the relay-side
departure record is exactly the tiebreaker the app server needs, because a player can only sever
*their own* link: nobody can manufacture a relay-side departure for an opponent. Live-proven again
end-to-end after all changes (signed webhook, true-crash `dropped` recorded; winner's post-result
exit recorded with `reported_at < departure_time`).

- **Departures are now recorded UNCONDITIONALLY** — the §20 ignore-if-result-held rule had a
  suppression hole: pre-submitting fake results *before* cutting the link would get the departure
  evidence discarded. `recordUserDeparture`'s WHERE keeps only the `departure_kind IS NULL` dedup
  guard. Whether a departure was a benign post-result exit is *derivable* (`reported_at IS NOT
  NULL AND reported_at <= departure_time`) instead of being decided at ingest by refusing to
  record. Every player of every v2 game ends up with a departure row — the game's full departure
  timeline, deliberately.
- **Correlation ids are always present** (Travis: the optionality was an implementation leak).
  `SessionDescriptor` now carries `external_id` + per-slot `slot_refs` down to every relay; the
  **relay** stamps them into its own `DepartureNotice`; the coordinator prefers notice-carried
  refs and falls back per-field to its store. A coordinator restart no longer loses the refs (the
  old "no session record → drop" branch is gone); the only drop left is "no gameId from either
  source". `external_ref` stays an opaque *string* at the rp2 boundary by design (rp2 is
  multi-tenant and can't assume numeric ids) — SB stringifies its numeric `SbUserId` in and
  integer-parses it back at ingest.
- **Webhook auth = Ed25519 signatures from the tenant signing key** (Travis's idea), replacing
  the bearer secret entirely. The coordinator signs each delivery attempt with the same per-tenant
  key that mints player tokens: headers `x-rp2-timestamp` (unix ms) + `x-rp2-signature` (base64,
  64 bytes) over the domain-separated message `rp2-webhook-v1:<timestamp>:<raw body bytes>` (the
  prefix keeps webhook signatures unconfusable with token signatures). SB verifies with
  `SB_RP2_TENANT_PUBKEY` (the same hex the dev coordinator prints for relays; parsed to a
  KeyObject once at module load), ±5-minute replay window, raw-body-exact via the webhook
  router's `includeUnparsed` koaBody. **SB now holds zero secrets for this feed.**
  `SB_RP2_NOTIFY_SECRET` and `--dev-notify-secret` are gone. The symmetric direction —
  SB signing its `/session/create` requests with its own registered keypair — remains with the
  tenant-enrollment/credential work.
- **The webhook client speaks https** (prod app server sits behind an HTTPS reverse proxy):
  hyper-rustls, ring provider, webpki roots — aws-lc-rs verified absent from the workspace tree.
- **Feeding departures into disputed reconciliation — policy approved (Travis), 1v1 first.**
  Today a 1v1 both-claim-victory dispute reconciles to `unknown` for both, no MMR.

### §20c. Departure-order dispute tiebreak (2026-07-04, policy approved)

**The trust signal inside a dispute is relay-side departure ORDER, not submission timing.** The
`reported_at <= departure_time` derivation answers "was this departure benign?" for
notification/UX purposes, but it cannot arbitrate a dispute: a cheater who pre-submits a fake
victory and then cuts their own link produces exactly the same benign-looking shape as a
legitimate winner. What the cheater cannot forge is the order of departures — a player can only
sever their *own* link, so the relay's timeline of who left the shared game first is
adversary-proof. Whoever departed first wasn't connected for the events they claim happened
afterward.

**1v1 rule (implemented):** when a game with exactly two human players (no computers) would
reconcile disputed/unknown, and *both* players hold departure records, and one departure
precedes the other by more than a small epsilon (10s, relay-idle-timeout scale — a mutual
netsplit orders the two link-deaths meaninglessly close, so close calls stay unresolved), the
earlier-departing player takes the loss and the other the win; `disputed` clears so MMR applies;
the result carries a departure-resolved marker that is logged for audit. `left` and `dropped`
count identically (abandoning an undecided game is a concession either way — approved policy).
Any missing evidence → exactly today's behavior; the feed stays best-effort and reconciliation
never *requires* it.

**Ranked team games (designed, staged behind 1v1):** matchmaking games have alliances fixed at
start (the server prevents changes), so the same principle lifts to teams: order *teams* by
their last member's departure; in a disputed game the side that outlasted the other is the side
whose consistent claim gets trusted. Needs its own edge-case matrix before building — players
eliminated mid-game who leave benignly (their personal defeat is already reported: their early
departure must not count against a team still fighting), partial-survivor claim conflicts within
one team, multi-team FFA-ish configs, draws. Lobby games stay out: alliances can change
mid-game, so team membership at departure time isn't knowable.

**Known limitation (Travis, 2026-07-04): a desync can false-trigger the tiebreak, and needs its
own signal with veto power.** A desync-to-completion produces two *honest* clients whose sims
diverged — each plays its own game to its own end and truthfully reports a win, and the one who
finished first looks server-side exactly like the pre-submit cheat (early departure + victory
claim). Departure order cannot separate "abandoned the shared game" from "finished a different
game", because after the desync moment there is no shared game — and no server-side rule can
pick the correct sim short of re-simulating the replay (not a thing we can build). **Decision (Travis): the 1v1 tiebreak implementation is GATED on the desync signal existing
first** — changing MMR-affecting resolution logic on top of an unobserved failure mode is
backwards. Sequence: understand how a desync looks to the relay today → wire the desync signal →
then the tiebreak (with the desync veto in place from day one).

**Desync detection design (Travis, 2026-07-04): the RELAY compares the sync checksums itself.**
The sim already exchanges sync-check values through the turn command stream, and rp2 already
parses/validates turns at the client edge — Travis explicitly wants rp2 to grow more game
understanding over time, so the extraction lives relay-side (client-edge validation walks the
command stream, lifts each slot's sync values; consensus-layer state compares per interval)
rather than having the DLL lift the value into the turn envelope. A bonus over the envelope
shape: the native game always emits sync commands, so their *absence* from one client's stream
is itself an anomaly at the relay. On mismatch: an authoritative relay-side "desync at interval
N" fact (in >2-player games the minority value even identifies *who* diverged; in 1v1 it is
deliberately only a veto — void, don't adjudicate), reported through the same
notice→coordinator→signed-webhook pipeline as departures, marking the game desynced → no
tiebreak, no MMR. Gated on RE of 12409's sync-check mechanism (command id/layout, cadence,
which state the checksum covers — also determines what the force-desync debug tool must perturb
to trip it in an idle test game) and on live observation of what the native client does when its
own check fires under the seam (the native response drops the peer via Storm — inert under v2 —
so the client-side path may need neutering regardless). Tooling in progress: a `forceDesync`
debug-control command.

**RE of 12409's sync check (2026-07-04, names persisted in the BNDB):**
- **Command `0x37`, 7 bytes, flows through the seam verbatim** (not in the 0x55/0x5f/0x66 strip
  list). Layout (**corrected 2026-07-05 by full RE of issue_sync_command/verify_peer_sync_slot;
  the original note below had `[1]` wrong**): `[0]`=0x37; `[1]`=`ring_index<<4 | hash_kind` — high
  nibble is the 16-entry ring index (+1 mod 16 per network turn), LOW nibble is the hash KIND (only
  ever 1 or 2, locked to ring parity: even index = kind-1 units hash, odd = kind-2 header/rng hash;
  byte[1] cycles the fixed sequence 0x01,0x12,0x21,0x32,…,0xF2). No sender id is in the payload at
  all (identity = network framing). Game start: the enable path emits the first 0x37 at ring index 1
  and the initial latency-flush burst repeats identical ring-1 commands before the ring first
  advances. **Cross-peer comparability:** only `hash16` (+ kind) is a shared-state value; bytes
  `[4]`/`[5]`/`[6]` are per-sender vision-masked and the native check evaluates them PAIRWISE
  against the receiver's own fog buffer — they legitimately differ between players in a healthy
  game and must never be cross-compared (this exact mistake produced a live false-positive desync
  at game start before it was corrected). `[2:4]`=16-bit state hash;
  `[4]`=folded fog/vision checksum byte; `[5][6]`=fog window length + a per-player vision bit.
- **Cadence:** one 0x37 emitted per outgoing turn (`issue_sync_command` 0x7589d0, from
  `flush_outgoing_command_turn`'s tail, gated by `sync_active`); one local slot recorded per turn
  (`record_turn_sync_slot` 0x758c90 from `step_network`). The 16-entry ring (`slot` nibble) is
  latency alignment, NOT a tolerance window.
- **Coverage alternates each turn** (`compute_player_sync_hash` 0x758a30): kind-1 = every active
  unit via `hash_unit_for_sync` 0x5a7200 (type, shields, energy, x, y, HP — and nothing else:
  orders/cooldowns/facing/target are NOT covered); kind-2 = game-struct header (~first 0x60
  bytes) + `rng_seed` (sub_7521a0) + game+0x14c. Both kinds also fold the map-tile/fog region and
  a vision term. Full coverage repeats every 2 turns. **Player minerals/resources were NOT
  confirmed to be in the hashed header** — hence the debug tool perturbs the hash/RNG directly,
  not minerals.
- **No tolerance:** a single failed compare in `verify_peer_sync_slot` (0x758d30, from
  `process_commands`' remote-0x37 case) — any of hash16 / fog byte / turn nibble / vision bit
  differing — sets `desync_detected_flag` (0x11ce2fc) + `net_player_flags[offender] |= 0x10000`
  that same turn.
- **Mismatch consequence (the v2 gap):** at the turn's end `handle_desync_detected` (0x759080)
  tallies flagged-vs-present across slots; minority-desynced → `drop_player_and_notify` →
  `storm_drop_player` → `storm_send_to_player` (SNP path); majority/self →
  `storm_self_leave_network_error(0x40000006)` (the general-network-error dialog / game-end).
  **Detection is pure game state and fires identically under v2, but every consequence rides
  Storm/SNP, which is INERT under the seam** — so in 1v1 each client independently flags the
  other, its Storm drop no-ops, it prints a local notice and keeps simulating its now-diverged
  game. No coordinated resolution is possible client-side under v2, which is exactly why the
  relay (which sees every slot's 0x37) is the right detector — and why the native local
  drop/dialog path may still need neutering under v2 regardless (observe first).

### §20d. Live desync observation (2026-07-04) — a 1v1 desync is a SILENT DOUBLE-WIN, and the fix
### is a relay desync veto that voids the game

Forced a real desync in a live 2-player netcode-v2 game (`forceDesync` on one client: RNG-seed
XOR + minerals). What actually happened, and what it means:

**Observed (one lobby melee — not ranked, so no MMR applied; the ranked consequence below is
extrapolated):** both clients' native sync check tripped and both showed a "You were disconnected"
dialog (so BW's own detection *survives* the seam — the 0x37 compare runs unchanged). But the
result the server recorded was the dangerous one:
- claude-1 reported `{self: Victory(3), opponent: Playing(0)}`; claude-2 reported the mirror. Each
  diverged sim reached *its own* victory and saw the other as merely still-playing — **neither
  reported the other as Defeated.**
- `reconcileResults` therefore saw two independent, unchallenged victories: each player has one
  Victory and zero Defeats, the `victories>0 && defeats>0` dispute branch never fires, and
  **both players reconciled to `win` with `disputed` never set** (DB-confirmed). Had this been a
  ranked game it would have been a clean-looking MMR double-award. The `reconcileResults` TODO
  (`tec27`) names exactly this gap: *"Check that the results are valid for the game configuration
  (e.g. only 1 victor)"* — the one-winner validation is unbuilt.
- **Important caveat — a 1v1 desync's reconcile outcome is UNRELIABLE, not reliably clean.**
  Whether it slips through depends on how the sims diverged: here each reported the other as
  `Playing`, giving two disputed-free wins; a divergence where each reports the other `Defeated`
  instead yields each `[Victory, Defeat]` → `disputed = true` → `unknown`. So a desync can land
  either way. That unpredictability is the point: reconciliation cannot be trusted to catch a
  desync in *either* direction, which is why the fix must be the relay veto, not a reconcile
  heuristic.
- The **relay logged nothing** (its log ends at client-authorized): the native detection's drop /
  self-leave rides Storm/SNP (inert under v2), so no leave, no departure, no webhook — the app
  server had no signal that anything was wrong. And the game processes kept running with
  "Continue Playing" available (the §19 footgun: continue-play would resume networked-but-diverged
  turns).

**Why the existing machinery doesn't catch it:** BW's detection fires but results were already
sent at the dialog (§19) and its consequence is Storm-inert; reconciliation can't reliably tell a
desync from a legit game (the reports may or may not contradict). The departure-order tiebreak
(§20c) doesn't help either — when the desync reconciles clean there's no dispute to engage it, and
departure order is irrelevant to a divergence regardless.

**Policy (Travis) — split by stakes/mode:**

*Lobby / custom games: desync ⇒ disputed, don't try hard.* Lobby win/loss "doesn't matter that
much," and alliances are mutable there (see the reconcile-scoping note below), so there is no
reliable structure to adjudicate against anyway. Any relay-observed desync → mark the game
disputed. That's the whole rule.

*Matchmaking (ranked) games: void only when UNDECIDABLE; otherwise the majority sim is
authoritative.* This is where correctness matters and where alliances are locked, so structure is
trustworthy. In lockstep every client runs its own sim from the *same* command stream, so a desync
is normally *one* client diverging while all others still agree — the relay sees this directly as a
majority sharing one 0x37 lineage and a minority differing. By topology:
- **1v1 (2 slots):** a disagreement is 1-1, no majority, undecidable — void/disputed, no MMR
  (there is no way to know which sim is correct without re-simulating).
- **>2 slots with a strict majority:** the agreeing majority is the authoritative reality; the
  diverged minority is identified and at-fault. Do **not** void — discard the minority players'
  reports (their divergent self-victory is untrustworthy) and let the majority's coherent result
  reconcile. A 2v2 where one player desyncs: the other three still agree, so the game resolves by
  their shared reality and the desynced player takes the fault. (The ">2 minority identifies who
  diverged" property from the RE, put to use.)
- **>2 slots with no strict majority** (even split, e.g. 2-2): undecidable again — void.

So the relay's `DesyncNotice` carries **which slots diverged** (the minority set) and the interval,
not merely "a desync happened": for matchmaking the app server either discards the minority and
reconciles the majority, or voids when no majority remains; for lobby it just disputes. Either way
this overrides an otherwise-clean reconcile (the both-`win` case) and takes **precedence over** the
§20c departure tiebreak — a desynced game is adjudicated by the desync rule, not by departure order
(after a divergence there is no shared game to have "departed" from). Missing desync signal →
today's behavior, unchanged.

**Coverage analysis — does relay-side hash comparison see every desync? (2026-07-05, RE-backed.)**
A concern: when a client's native check fires, does it stop feeding the relay conflicting samples?
Two facts resolve this in our favor, both specific to netcode v2's architecture:
- **The native detection path never stops sync emission.** RE of 12409 (`handle_desync_detected`
  0x759080 and all `sync_active` 0x11ce294 xrefs): the only writer of `sync_active` is the game-loop
  enable/disable helper `sub_74e320`, which the detection path never calls. Detection sets Storm-level
  drop/leave flags (`net_player_flags |= 0x10000`, `storm_self_leave_network_error(0x40000006)`) — all
  inert under v2 — but `step_network` keeps calling `record_turn_sync_slot`/`flush_outgoing_command_turn`
  because `sync_active` is still set. So both diverged clients keep emitting 0x37 with conflicting hash16.
- **Broadcast, not point-to-point.** Native BW sends turns per-destination over Storm, so a desync
  prunes the offending peer from each client's send list and the two sims separate in silence (why
  native has no server-side desync visibility). rp2 sends ONE turn stream fanned by the relay; there is
  no per-destination list to prune, and the native `storm_drop_player` is inert — so neither client can
  stop broadcasting its (now diverging) stream at the authority relay. Our architecture removes the
  native blindness rather than inheriting it.
- **Residual gap (small, documented):** the relay compares only `hash16` (bytes [2:3]); the native
  fog/vision bytes [4..7] are per-sender vision-masked and not cross-comparable (see §20e), so a
  divergence living ONLY in fog state, that never perturbs a hashed unit/header/RNG value, and whose
  owner reaches the victory-dialog result-lock (§19) before it ever touches hash16, would evade the
  relay. Fog is downstream of unit positions and vision, so a pure-fog divergence with zero hashed
  consequence is exotic; the class is narrow. Closing it fully needs a client-originated signal (the
  native fog check fires immediately; a report over the reliable control stream would beat the
  result-lock). Decision (deferred to Travis): ship relay-hash as the authoritative v1 veto with this
  gap documented; a client desync-report hook feeding the same DesyncNotice pipeline is an optional
  fast-follow. Trust note: a client report can only ever be a VOID/dispute trigger (the safe
  direction — a false report denies MMR to both and is rate-limitable), never a winner claim; it does
  not reopen the "don't trust client report shape" concern, which was about trusting who won.

**Design (the detector the observation confirms we need):**
1. **Relay compares the 0x37 sync values it already parses.** rp2's edge validator already walks
   the SC:R command stream and *already classifies 0x37 Sync* (`proto/src/commands.rs`, 7-byte
   live length). Extend that walk to lift each slot's sync payload (the hash16 + fog byte + turn
   nibble + vision bit, keyed by the turn-counter nibble for interval alignment) and hand it to a
   consensus-layer comparator that, per interval, checks all required slots agree. A mismatch —
   or one slot's 0x37 *missing* where others sent one — is a relay-authoritative desync fact
   (in >2-player games the minority value identifies who diverged; in 1v1 it is only "they
   diverged", which is exactly the veto).
2. **Reuse the departure pipeline shape:** a `DesyncNotice` sibling of `DepartureNotice` up the
   coordinator control connection → dedup → signed webhook (`GET`-fetched tenant pubkey, same as
   departures) → app server marks the game desynced.
3. **Reconciliation honors it:** a game flagged desynced reconciles to disputed/void (no MMR),
   overriding an otherwise-clean result. Runs before the §20c tiebreak.
4. **Complementary cleanups:** the §19 "terminal dialog ⇒ close the v2 session" change removes the
   continue-play-diverged footgun and stops the relay seeing turns from a decided game (does not
   fix the already-sent result — the relay veto does). The native self-leave/drop path under v2
   may still want neutering (it currently just no-ops into Storm), TBD.

**Reusability note (Travis):** rp2 is deliberately *not* fully game-agnostic — it already parses
and validates SC:R commands at the edge, and the intent is for it to grow more game understanding
over time — so lifting the 0x37 checksum for comparison sits naturally in the layer that already
reads it, rather than being pushed into the DLL/turn-envelope.

**Open point — reconcile ordering vs. the desync signal (Travis).** Reconciliation currently fires
as soon as all humans report (or a force-timeout). The desync signal arrives independently, so in
principle a fast all-reported reconcile could beat it. In practice the timing favors us: desync
detection is real-time/mid-game (the relay compares 0x37 the instant checksums diverge), typically
well before clients finish and report, so the flag is usually recorded before reconcile triggers.
The edge cases (last-frame desync, webhook latency/retry, coordinator restart) motivate, for
**matchmaking only** (lobby is low-stakes), holding ranked finalization until the relay's session
verdict is known with a bounded-timeout fallback (so a lost signal can't hang reconciliation).
Deferred to the desync-reconciliation build — it sits on top of the `DesyncNotice` signal, which
doesn't exist yet. Reversing already-applied MMR after a late signal (the existing re-reconcile
`TODO(tec27)`) is the messier alternative the wait avoids.

**Separate, complementary reconcile fix (not desync-specific).** The observation above also
exposed a standalone reconciliation bug: `reconcileResults` will pass a result with more winners
than the game structure allows (two players each honestly reporting *themselves* the winner → both
`win`, `disputed` false) — the unbuilt `TODO(tec27)` "only 1 victor" validation. Fixed
independently: a reconciled result with >1 winning team is forced to `disputed`/all-unknown.

**Scoping correction (Travis): this structural check applies to MATCHMAKING games only.**
Alliances are locked solely for matchmaking (`disableAllianceChanges: true` is set only in the
matchmaking branch of `game-loader.ts`; lobby alliances are mutable and no lobby setting exposes
locking today). So config teams are authoritative *only* for matchmaking — in a lobby game two
players on different starting teams could legitimately ally and co-win, and the check would
false-flag it. Gate: `gameSource === Matchmaking` → validate (teams via `getTeamsFromConfig`, FFA =
each player own team); else skip. Lobby desyncs are instead handled by the "desync ⇒ disputed"
rule above, which needs no structure. *Forward-looking (queued):* persist a `lockedAlliances`
boolean in the stored `GameConfig` (true for matchmaking now, settable by a future lobby toggle)
and have the reconcile gate read it with the `gameSource === Matchmaking` fallback for old records
— so the check reads the real invariant instead of the mode proxy.

This structural guard is the *report-shape* layer: it catches a two-self-winner result from any
cause in matchmaking, but a desync that yields one plausible winner still reconciles clean, so it
does NOT subsume the relay veto. The two are layers — the reconcile guard catches
structurally-impossible ranked results; the relay veto catches desyncs regardless of report shape
or mode.

### §20e. Relay-side desync detection — design locked (2026-07-04, with Travis)

The detector §20d calls for, designed against the code as it exists. Decisions made with Travis
are marked (T); the rest are implementation resolutions consistent with them.

**Where it runs (T): authority-relay-only**, like `decide_leave`. Every relay already funnels
every turn — client edge, mesh hop, and the oversize-turn divert — through
`deliver_turn_to_locals` (mesh.rs), immediately after a `consensus::observe_frame` call. The lift
is a new sibling, `consensus::observe_sync(decision_makers, key, slot, &payload.commands)`, which
no-ops unless this relay is the session's authority. It re-walks the already-validated command
bytes looking for `0x37` (a trivial `command_length` scan — validation happened at the ingress
edge; mesh hops deliberately don't re-validate, and this changes nothing about that trust
model: the authority parses the bytes itself, it does not trust a peer's parse). No wire-format
changes to the turn path at all.

**Authority promotion starts the comparator fresh** — no compare-state transfers in the
descriptor or mesh. A real desync diverges every interval, so the next interval after promotion
catches it. (Consequence: a desync whose evidence straddles an authority death can be missed
once; accepted — the alternative is transferring per-interval hash state, pure complexity.)

**Interval alignment (final as-built scheme, revised twice in review).** Each client emits exactly
one 0x37 per outgoing turn once `sync_active` is set, and lockstep means every client's Nth sync
command covers the same simulated interval. Naive arrival-order counting is wrong three ways —
the mesh delivers duplicate turns via multiple flood paths, QUIC datagrams reorder, and a client
legitimately runs up to the buffer depth AHEAD of its slowest peer's arrivals (producing turn k+1
only requires having executed k+1−depth) — each of which silently offsets a slot's ordinals and
manufactures false desyncs that a symmetric loopback test never sees. As built:
- **Exactly-once observation:** `observe_sync` runs inside `deliver_turn_to_locals` immediately
  after the `mark_seen` dedup (the choke point all four turn paths funnel through), so the
  authority observes each distinct (slot, seq) turn once.
- **Nibble-corrected steady state:** each 0x37 is placed at the ordinal ≡ its ring nibble (mod 16)
  nearest the slot's own expected count — self-heals transport reordering (±7 exact), and is
  buffer-depth-independent because it's relative to the slot's own stream.
- **Frame-anchored joins:** a slot's first-ever report is placed by projecting its turn's
  `game_frame_count` against a running (ordinal, frame) calibration (rate from first/latest
  calibration points, projected from the latest, clamped to [0, frontier]), then nibble-refined.
  Lockstep binds cross-client frame skew to ~±2 turns, so this is exact at any buffer depth —
  this is what removed the earlier ±7 join ceiling when Travis raised the dev buffer bounds to
  (1, 12) (depth×42ms at TR24; 12 ≈ 504ms one-way = parity with old TR8 Extra High; BW's 16-entry
  sync ring caps total in-flight depth ~14ish). Fallback with no frame or no rate yet: frontier +
  nibble. Known accepted corner: a join during a PAUSE right after authority promotion (frames
  frozen, rate unavailable, arrival lag possibly > 7) can misplace — worst case one spurious
  notice; task-3 consumption can sanity-check.
- **Evaluation margin:** ordinal k is judged once every member whose join ordinal ≤ k reported it
  AND the frontier is ≥ k + margin, margin = max(8, bounds.max + 2) computed per call from the
  session's live bounds. Window cap 64 with eviction as the stalled-slot backstop (log, don't
  judge). An absurd-bounds backstop (max ≥ 32 = window/2) disables the comparator, log-once —
  defensive only, not a live constraint.
Compared value (**corrected 2026-07-05 after a live false positive + binary RE, see §20c**):
`hash16` (bytes [2:3]) plus kind agreement ONLY — bytes [4..7] are per-sender vision-masked and
never cross-comparable. The alternating kind-1/kind-2 coverage aligns automatically since
comparison is same-ordinal, and ring parity ↔ kind is a cross-check. hash16's cross-peer
equality is guaranteed by the structure of the native check itself (the receiver compares the
remote value against a locally recomputed one, so synced peers must produce identical values or
vanilla SC:R would flag desyncs constantly).

**Who is compared:** live, non-observer slots. Departed slots stop being required from their
departure. **Observers are excluded (T)** — they don't reliably emit 0x37 (SB observers join
as quasi-normal players today, but that's slated for cleanup) — which needs the relay to know
observer-ness: `PlayerHandoff` gains `observer: bool` (serde-default false, like `external_ref`),
the coordinator carries it into the `SessionDescriptor` as `observer_slots: Vec<SlotId>`
(serde-default empty), SB sets it at `/session/create` from the game's slot types.

**Missing-0x37 policy (v1): log, don't judge.** A slot whose ordinal stream stops (or never
starts) while others advance is logged as an anomaly (rate-limited warn with slot + ordinal gap),
but only *value mismatches* produce notices in v1. Cadence edges (pre-`sync_active` turns,
whatever SB observers actually do, §19 post-victory tails) haven't been observed enough to make
absence authoritative; revisit once the detector has run in anger.

**Mismatch → DesyncNotice, repeatable per session (T).** On the first ordinal where values
disagree: majority value = the agreeing plurality holding a strict majority of compared slots;
everyone else is the **diverged minority**. No strict majority (1v1, even split) → the notice
carries an explicit `no_majority` marker and an empty minority set (SB must not infer
undecidability from topology). The comparator then **drops the diverged minority from the
compare set and keeps watching the survivors** — a later second divergence (3v3 loses one, then
another) fires again as a new event at its own, later ordinal (T: multiple events per
session are real, if vanishingly rare; "after some count, just void the game" is app-server
policy in the reconciliation slice, and the per-event evidence supports it either way).
**The sync ordinal IS the event identity** — no relay-assigned per-session sequence. It is
monotone and derived from game data rather than relay state, so authority promotion (fresh
comparator) cannot collide with an event the dead authority already reported: a re-detection
lands at a later ordinal and is simply a second piece of evidence. Notice carries: session, the
sync ordinal, the closest observed `game_frame_count`
(human-meaningful interval), diverged slots (with external refs, like departures), detected-at.
Checksum values themselves stay relay-side (T: opaque, slots+interval suffice) — logged, not
shipped.

**Pipeline: the departure pipe, generalized (T: one pipe, my call on shape).** Nothing is
deployed, so rename rather than parallel: the relay→coordinator notice channel and the
coordinator's dedup/enrich/retry/webhook path handle a notice union (departure | desync), the
webhook body gains a `kind` discriminator, and SB's endpoint becomes
`POST /webhooks/netcode-v2/game-events` (the `/departures` route does not survive; same
dedicated early middleware chain, same Ed25519 signature scheme and fetched-pubkey verify).
Coordinator dedup key for desyncs: (tenant, session, sync_ordinal). Same at-least-once retries.

**SB persistence (this slice records, task-3 reconciliation consumes):** new table
`game_desync_events` — PK (game_id, sync_ordinal), detected-at, frame, `no_majority`
flag, diverged user ids (parsed from external refs like departures). No games_users column;
the reconciliation slice derives per-player fault from the events. Ingest is idempotent on the
PK (at-least-once delivery).

**Post-result desyncs (T):** no timestamp-classification logic here — the §19 cleanup (close the
v2 session at the terminal dialog) is the fix, and it must land **before** task-3 reconciliation
starts consuming desync flags, else a continue-playing divergence could void a decided ranked
game. Harmless in this slice (nothing consumes the flag yet); recorded as a sequencing gate.

**Explicitly out of scope for this slice:** reconciliation changes (majority-authoritative /
void / lobby-disputed — task 3), the MMR bounded-wait ordering (task 3), the §20c departure
tiebreak (task 4, gated on this), any enforcement (the relay does not kick diverged slots —
detection only, enforcement is a possible future), and neutering the native Storm-inert
drop/self-leave path (observe first, per §20c).

**Acceptance:** unit tests on the comparator (majority/minority/no-majority/second-divergence/
observer-excluded/departed-slot); the live §20d scenario re-run — `forceDesync` in a 1v1 →
relay logs the divergence at a concrete ordinal → DesyncNotice → signed webhook →
`game_desync_events` row with `no_majority` — plus a departure re-run to prove the renamed
pipe still records departures.

## 21. Desync-aware reconciliation, session-close-at-victory, and the malicious-client audit (2026-07-05)

This section covers the slice that *consumes* the §20e desync signal (the payoff nothing was
using yet), the §19 cleanup that had to land alongside it, and — the bulk of the work — a
five-front adversarial audit of the whole netcode-v2 surface against a bar Travis set explicitly:

> **A malicious client's worst case must be its OWN game disputed or voided. It must never crash
> the relay or the server, stall honest survivors, or frame an honest player.**

The audit found the parse/transport/isolation surface solid (no client-reachable panic, no
unbounded growth, per-game isolation holds, slot-binding enforced), but surfaced two ways a
client could make an *honest* player lose — both fixed here. Status at writing: built, unit-tested,
clippy/typecheck/lint-clean in all three repos; **not yet live-loopback-proven; not committed.**

### §21a. Session-close at the victory dialog (§19 cleanup, game DLL)

The §19 investigation left "networked Continue Playing" as a footgun: a *decided* game kept feeding
the relay 0x37s, so a later divergence could produce a desync event that would void an
already-decided ranked game. §20e made that a hard sequencing gate — this must land before
reconciliation consumes desync flags.

Built (`game/src/netcode_v2/`, `bw_scr/dialog_hook.rs`): on the **`WMission`** dialog only (victory
— not `LMission`), `TurnState::begin_local_only()`:
- fabricates a reason-3 ("player left") leave for every still-live remote slot, routed through the
  **same `LeaveTracker`** relay directives flow through (marked due immediately), so the IN hook
  applies them in the deterministic synced-leave window — no second application path;
- sets a latched `local_only` flag so `submit_local_turn` keeps the local echo (the sim needs its
  own turns) but stops sending to the closing link;
- then calls the existing `send_leave_intent()` so the relay decides our clean leave for any
  remaining participants.

The asymmetry (victory only): victory decides the game for everyone, so the session can end and any
further play is local-only; a defeat does not end the game for the *other* players, so the defeated
client stays a networked participant until it exits (its clean leave fires at loop end). Two
robustness details from review: `begin_local_only` skips slots already tracked in the `LeaveTracker`
(a team-victory co-winner's real directive can arrive while our fabricated one is in flight —
fabricating a second, differently-stamped entry would trip the tracker's per-slot consistency
`debug_assert!`); and once `local_only`, the leaves-channel drain **discards** incoming directives
rather than observing them (same assert hazard, and they're redundant — every remote slot is already
left or tracked). `session.rs::begin_local_only` warns on a re-entrant-lock miss, distinct from the
silent no-session no-op. This makes the §20e gate hold: a decided game stops emitting 0x37, so a
continue-play divergence cannot produce a desync event that voids it.

### §21b. Desync-aware reconciliation and the concession tiebreak (app server)

`applyDesyncPolicy` (`server/lib/games/results.ts`, pure/total/exported) consumes
`game_desync_events`:
- **Matchmaking**: any `no_majority` event → **void** (all-unknown, disputed, no MMR — undecidable);
  otherwise **majority-discard** — null out the diverged minority's own reports and let the
  majority's reports decide everyone's result (including the diverged players', pinning fault on
  them). `divergedUserIds` are intersected against the game's actual humans first (untrusted-shaped,
  even though the event is relay-signed); an event that names nobody recognizable voids rather than
  silently passing through.
- **Lobby / non-matchmaking**: force `disputed` (results stand, but stats/MMR blocked). No structure
  to adjudicate against (alliances mutable).

Diverged players are excluded from the "all humans reported" gate (a diverged sim can run
arbitrarily long). Matchmaking finalization waits out a bounded window (`DESYNC_VERDICT_GRACE_MS =
15s` past the last report) for a trailing relay verdict, via a one-shot `clock.setTimeout` deduped
in a per-game map; a `no_majority` event is already terminal and skips the wait. The 15-min sweep
now also reconciles fully-reported-but-unreconciled games (`findFullyReportedUnreconciledGames`), so
a server restart during the grace window still finalizes them. The whole policy is total over
degenerate/adversarial input (empty/all-null results, out-of-game or duplicated diverged IDs) —
it resolves to a void, never a throw (reconcile runs fire-and-forget; a throw would only wedge the
game unreconciled).

**The §20c departure tiebreak was gameable and is replaced.** The old rule (earlier departer loses,
later departer wins, dispute clears, MMR applies) trusted *departure order*, which a client controls
by **lingering**: a losing 1v1 player reports a false victory (→ mutual-victory dispute), then simply
holds its connection open past the honest winner's prompt post-victory teardown, becoming the
"later" departer → it wins with MMR and flips the honest winner to a loss. Departure order cannot
arbitrate a two-sided dispute. `applyDepartureConcessionTiebreak` restricts it to a genuine
**concession**: it engages only when exactly one of two humans reported a result and the other
**abandoned without reporting** (corroborated by a departure record) — the sole reporter is trusted
(a "won but crashed before reporting" race is farfetched, per Travis), takes the win, the abandoner
takes the loss. When both reported (the exploit shape) it stays disputed/void. Departure time/order
no longer decides anything; the departure record only corroborates that the abandoner actually left.

### §21c. The adversarial audit and the relay fixes

Five deep-dives (relay leave machinery, relay sync comparator, relay edge validation/routing,
client leave/directive lib, app-server ingest/reconciliation). Findings and dispositions:

**CRITICAL — calibration poisoning (relay `consensus.rs`, the §20e comparator).** The frame-anchored
join placement trusted a single slot's `game_frame_count` to position *another* slot's join ordinal:
an attacker floods/races to own the frontier and the calibration rate, so an honest joiner is
projected ~16 ordinals off and — after the parity-preserving nibble correction — its whole stream is
shifted a full ring cycle, making it disagree with the aligned majority and get named the diverged
party. **Fix — corroborate-or-defer:** the frames-per-ordinal rate is derived only from **≥3 distinct
slots' median** `(ordinal, frame)` points (`SYNC_CORROBORATION_MIN = 3`, `update_corroboration`);
the median of ≥3 with ≤1 attacker is always bounded within the honest spread, so **no
frame-agreement tolerance parameter exists** (an exploitable magic number avoided). A join is
frame-anchored only from that corroborated rate; with no trustworthy rate it is placed only within
one ring cycle of the frontier (`join_expected` returns `None` beyond that → `defer_join` drops and
retries on the slot's next report — a safe false-negative, never a misplacement), and a new member
whose nibble lands *above* the frontier is likewise deferred (the tell-tale of a deep join that
jumped a cycle). This also resolves cleanly post-authority-promotion (fresh comparator): all live
slots sit at the same ring, place at the frontier, and corroborate — no deadlock. A single client
controls one slot, so it can neither reach the 3-slot threshold alone nor move a corroborated
median. Also landed: **one 0x37 per (slot, turn)** enforcement in `observe_sync` — the flooding lever
the attack (and the separate window-eviction detection-evasion, MEDIUM) both depend on.

**HIGH — leave-frame inflation stalls survivors (relay `consensus.rs`/`routing.rs`/`mesh.rs`).** A
departing client sets `game_frame_count = u32::MAX`; the leave's `apply_at_frame` was derived
one-past the departing slot's own unvalidated frame with no clamp, so honest survivors got a
directive to drop the slot at a frame they never reach → permanent stall. Note the subtlety that
made the naive fix wrong: clamping *up* to a survivor-relative bound doesn't help (a stalled
survivor can't reach any frame above its stall), and survivors' *stamped* frames run ahead of their
*executed* frame by the buffer depth. **Fix — clamp DOWN to a provably-executed, single-sourced
ceiling:** `apply_base = min(slot_last, F)`, where `F` = the min over surviving slots of the highest
frame each has *provably executed* — a frame stamped at least `buffer_max` **turns** (transport seq,
not game frames — so no frames-per-turn constant enters) before the current frontier turn;
`threshold = frontier_turn.saturating_sub(buffer_max)` keeps `F` computable in the game's first turns
too (a survivor with no proven frame yet falls back to its earliest stamped frame). `F` is computed
**only on the departing slot's home relay** and carried verbatim in a new optional
`SlotDeparted.reachable_frame` (mesh-only wire field, does not touch the game client) plus the
departure record (first-non-`None`-wins), so `decide_leave` and any promoted authority's
re-derivation clamp to the identical value — determinism preserved. Honest steady state:
`slot_last ≤ F`, the clamp is a no-op. Early-game / cross-relay-mesh-lag corner: `F` may sit a few
frames below `slot_last`, giving a bounded, deterministic **early-drop** — never a stall. All four
production frame-observation sites now use the seq-aware `observe_turn_frame`; the seq-less
`observe_frame` is test-only, so the clamp cannot be bypassed live.

**HIGH — departure-order tiebreak.** Covered in §21b (fixed on the app-server side, concession-only).

**MEDIUM (deferred, documented):** oversize-turn amplification — the forward channel is bounded by
*count*, not bytes, so a valid 64 KiB turn is cloned into every peer channel (a memory spike touching
other sessions' box, and a lever to force-drop honest teammates). Fix direction: byte-budget the
forward channel / lower `MAX_CONTROL_FRAME_LEN` / rate-limit oversize turns. And: the accepted
"self-desync to void my own loss" escape has no per-user abuse rate-limit; the app server now logs
the participants at WARN on a `no_majority` void for manual review, but automated throttling is
deferred.

**LOW (fixed):** checked `u8::try_from` on the four mesh-path `SlotId` casts (defense-in-depth on
trusted peer traffic); webhook numeric fields gained `.integer()`/range bounds (a validly-signed but
malformed body no longer 500s on every at-least-once retry) and the `diverged` array is capped.

### §21d. Pre-existing note and the durable future direction

**Pre-existing (not introduced or worsened here):** after an authority promotion the comparator
re-bases sync ordinals low, so a desync straddling a relay failover could collide on the
`game_desync_events` primary key `(game_id, sync_ordinal)` and be dropped as a duplicate. This is
within §20e's already-accepted "a desync straddling an authority death can be missed once" envelope;
noted for a future revisit (e.g. an epoch/authority-generation component in the event identity).

**Durable future direction (Travis, not built): report game results *through the relay*.** Today
clients POST results directly to the app server, independently of their relay link — so a client can
sever its link (or feed a diverged game) and still submit a result, and the server has no
relay-side corroboration of it. The residual 1v1-lie class (the concession tiebreak deliberately
voids rather than adjudicates two-sided victory claims) is a direct consequence. Routing the result
report *through the relay* fixes this structurally: (a) it proves the reporting client was **actually
connected through the end of the game** — a result can only arrive over a live link the relay
watched the whole session — so a "cut my link then claim victory" report is impossible; (b) it lets
the relay **stamp and correlate timing** — the result's arrival can be placed against the relay's own
timeline of departures/disconnects for the session, giving the app server a trustworthy ordering it
cannot get from independently-submitted reports; and (c) the relay can apply light validation before
forwarding. This is the fix that would let more disputes resolve to a decisive result instead of a
void, and it composes with the existing signed relay→coordinator→webhook pipe (a result becomes
another notice kind alongside departure/desync). Recorded as the intended long-term shape; a larger
change than this slice, deliberately deferred.

### §21e. Verification status

Unit/type coverage is green everywhere: rp2 `cargo fmt`/clippy/`cargo test --workspace` (211 relay
tests, incl. the new adversarial cases — inflated-frame clamp + determinism, ≥3-median corroboration,
attacker-cannot-frame-a-joiner, early-game-inflation-no-stall); server typecheck + 86 vitest +
eslint; game clippy + unit tests + a fresh `build.bat` DLL.

**Live loopback proof (2026-07-05, PASSED).** Coordinator + relay + Node (rp2 env) + two Electron
clients (claude-1/claude-2), a real 1v1 netcode-v2 lobby game:
- *Honest play is regression-free.* Both clients ran on `netcodeV2`, authorized on the relay
  (slots 0/1), and played cleanly for the whole game — the relay log had **zero** desync/error/stall,
  only the expected startup nibble-correction (the corroborate-or-defer join path placing the two
  slots at the frontier at game start, no false positive). So the relay Fix A/B + one-per-turn
  changes don't break or false-flag normal play.
- *The full desync→dispute chain fired end to end.* `forceDesync` on one client → relay logged
  `desync detected sync_ordinal=1759 no_majority=true diverged=[]` (correct 1v1 shape) → signed
  webhook → a `game_desync_events` row (`no_majority=t`, empty diverged) → the game finished with the
  exact §20d silent-double-win report shape (each client reported self-Victory / opponent-Playing),
  and **reconciliation consumed the desync event and disputed the game** (`games.disputable = t`,
  "had 1 relay desync event(s); forcing dispute") instead of recording a clean double-win. This is
  the §20d fix proven live, not just in unit tests. (Lobby game → dispute; a matchmaking game would
  void with no MMR by the same path.)

Adversarial behaviors (Fix A inflated-frame clamp, Fix B calibration framing) can't be produced by an
honest loopback client and remain unit-test-covered. A benign pre-existing pg `DeprecationWarning`
(concurrent `client.query` in the existing `setReconciledResult` transaction path) was observed
during reconcile — not introduced here, worth a later look.

**Follow-up from the live run:** the routine sync-ordinal nibble-correction log (fires at every game
start as slots join the compare set) was downgraded from `warn!` to `debug!` — it's expected, not a
warning (Travis's call). Nothing is committed pending review.

## 22. Results through the relay — design (2026-07-04; revised same day after Travis review:
## relay-ONLY, no results2 fallback)

Builds the durable direction recorded in §21d: for a netcode-v2 game, the relay link is **the only
way a result report reaches the app server**. The report travels over the client's live,
authenticated relay link; the relay stamps arrival against its own timeline; the report flows up
the existing signed relay → coordinator → webhook pipeline as a third event kind beside
`departure`/`desync`. **The direct `results2` HTTP path is closed for v2 games** (Travis: keeping
it would forfeit every guarantee this exists to provide — an untrusted side door makes the trusted
door decorative). The payoff is structural rather than policy: a client that severed its link
**cannot have reported at all** — the report can only precede the link close on the ordered stream
— so the cut-my-link-then-claim-victory class dies without any new reconciliation rule; §21b's
existing concession tiebreak (sole reporter with a terminal self-victory + opponent
dropped-without-reporting) already resolves it decisively. The client that lost its connection
still *gets* a result: its outcome is decided from the survivors' relay-borne reports plus its own
relay-recorded departure, on the server, like any finished game. The malicious-client bar is
intact throughout (worst case remains: your own game disputed/void; never an honest player
flipped).

### §22a. Shape: opaque payload, home-relay direct, no mesh

The DLL serializes the **same `GameResultsReport` JSON it already POSTs to `results2`** (`user_id`,
`result_code`, `time`, `player_results`) and sends it as opaque bytes in a new client→relay
`ControlFrame::GameResult { payload: bytes }` (next free oneof tag, 4). rp2 never parses it — the
same tenant-agnostic boundary that keeps `external_ref` an opaque string. The relay's "light
validation" (§21d c) is structural, not semantic: a size cap (**4 KiB** — the worst-case real
report, 8 players + an 8-char result code, is ~450 bytes of JSON, so this is ~9× headroom while
still denying any meaningful use of the frame as a data channel),
**one per slot per session** (first wins, extras dropped at debug — the same anti-flooding
posture as one-0x37-per-turn), and attribution: the reporting slot comes from the **authenticated
connection** (`AuthorizedClient`), exactly like `LeaveIntent`'s implicit sender — nothing in the
payload is trusted for identity.

Delivery is **home-relay direct**: the serve loop (`routing.rs`) hands the frame to a new
`consensus::record_result` (dedup + stamp in the `DecisionMaker`), which fires
`RelayNotice::Result(ResultNotice)` on first insert, through the existing pending-until-sent
coordinator-WS buffer. **No mesh frame, no authority involvement**: every relay owns a coordinator
WS and the coordinator already dedups notices, so a peer-homed reporter's home relay reports it
directly (the departure pipeline's exact precedent). The relay stamps what only it knows:
`arrival_ms` (relay wall clock), `session_frame` (its local lockstep view at arrival), and the
reporting slot's last stamped frame. Desync/departure context is *not* embedded — those notices
already flow independently and the app server correlates by game.

Coordinator: `RelayToCoordinator::Result` variant (plus the compiler-enforced pre-Hello-violation
arm), dedup by `(tenant, session, slot)`, enrichment identical to departures (notice-carried
`external_id`/`external_ref` first, stored `session_refs` fallback — coordinator-restart safe),
then a `ResultWebhook { event: "result", tenant, session, externalId, slot, externalRef,
payload (base64), arrivalMs, sessionFrame?, slotFrame? }`, Ed25519-signed per attempt, same 6-try
backoff. All wire changes are additive: an old relay skips the unknown oneof kind (`kind: None`
path), an old coordinator folds `Result` to `Unknown`, an old app server 400s the unknown event
(the webhook is best-effort by design; HTTP dual-submit still lands the result).

### §22b. Client sequencing — result before leave-intent, one latch

The result frame and `LeaveIntent` ride the **same ordered reliable stream**, and the relay
processes control frames sequentially, breaking the serve loop only at the intent — so "result is
in before the link closes" reduces to *local enqueue order in the driver*, which a single latch
guarantees:

- `send_game_results()` (game thread, once-gated) additionally latches **result-expected** on the
  driver *synchronously, before* any leave-intent can be signalled. The async thread, on the
  `Results` message, serializes the report once and hands the bytes to a new capacity-1
  `TurnChannels::result_report` channel; the driver sends `ControlFrame::GameResult` immediately on
  receipt.
- `maybe_send_leave_intent` gains one condition: hold while result-expected ∧ not-yet-sent, bounded
  by the **existing 2s `LEAVE_INTENT_TIMEOUT`** (a missing/late result is harmless — HTTP covers it;
  the hold in practice is sub-millisecond, the time to build + serialize the report).
- The three end-of-game paths then need almost nothing:
  - **`WMission` (victory):** `dialog_hook` already calls `send_game_results()` *before*
    `begin_local_only()`/`send_leave_intent()` — correct order for free.
  - **`LMission` (defeat):** result goes out over the live link the moment the dialog shows; under
    §21a's current behavior the defeated client stays networked afterward, so there's no
    interaction with the intent at all. (Travis, on review: the victory/defeat session-close
    asymmetry itself is suspect — a decided-for-me game is a decided-for-me game — and closing the
    session at `LMission` too may be right. Not this slice; the one substantive difference to weigh
    when unifying is that staying networked after defeat is what lets a defeated player keep
    watching a still-live team game, which local-only would freeze. For *results*, the dialogs are
    already symmetric: both report at dialog time.)
  - **Loop end (F10 quit / natural end):** the one wrong ordering today — `game_thread.rs` sends
    the leave intent (line ~233) *before* `send_game_results()` (line ~238). **Swap them**, so the
    latch is set before the intent path runs; the driver hold covers the cross-thread race.
- A crash never reaches any of this — correctly so, since a crashed client's "result" doesn't
  exist and its departure is the relay's link-death record. If the result frame cannot be sent
  (driver already dead, link lost moments earlier), the DLL logs and moves on: that client is a
  non-reporter with a relay-recorded drop, which is exactly what it is. There is deliberately
  **no HTTP retry fallback** — that fallback is precisely the untrusted channel being removed.

### §22c. App-server ingest: the only door for v2 results

The webhook ingest **is** the submission path. `POST /webhooks/netcode-v2/game-events` gains the
`result` event kind (joi alternative): verify signature (unchanged), parse `externalId`→gameId /
`externalRef`→userId, base64-decode the payload and parse it as a results2-shaped body,
**cross-check `payload.user_id` against `externalRef`** (mismatch = malicious/corrupt → drop +
warn), then call the same `submitGameResults` service path — including the `result_code` check.
That check is kept deliberately even though identity is already link-proven: it's cheap, it keeps
one validation path for all submissions, and it means even a compromised relay/coordinator cannot
fabricate a *player-attributed* report without the secret only the real game client holds. The
webhook's at-least-once delivery dedups on the existing `AlreadyReported`. Relay timing lands on
`games_users` (new migration): `relay_report_time TIMESTAMPTZ` + `relay_report_frame INTEGER` —
no longer a "proven" bit (every v2 report is relay-borne by construction), but the trustworthy
single-timeline ordering of report-vs-departure-vs-desync, stored for audit and future policy.

**The doors that close** (all keyed on the game's config having `useNetcodeV2`):
- `results2` **rejects** submissions for v2 games (new coded error; the endpoint itself stays for
  pre-cutover clients and dies with them). The renderer's resend loop treats it as terminal, like
  `AlreadyReported`.
- The DLL skips its HTTP POST when a v2 session was active (its report went over the link before
  the leave intent, or it has nothing trustworthy to say).
- The Electron app's crash-backup resend (both the captured-result and blank-result flavors) is
  disabled for v2 games: a crashed client's report either already made it through the relay or
  must not exist, and "the game exited" is exactly what the relay's link-death departure records —
  the blank-result path was a weaker duplicate of a signal we now get signed.
- Replay upload stays HTTP (size; a replay is evidence, not a claim — unforgeable in the way that
  matters, since it must match the sim both players hashed all game).

**Reliability consequences, faced squarely** (this path is now load-bearing):
- A relay crash between accepting the frame and delivering the notice loses that report (the
  pending buffer is in-memory). The player becomes a non-reporter; the sweep force-reconciles from
  the survivors' reports and the departure records. The failure mode is a dispute/void or a
  survivors-decided result — never a fabricated one. Same envelope as departures/desync already
  accept, and the window is milliseconds wide.
- There is no "v2 game running on native transport" case to worry about: **if rp2 isn't
  available, the game doesn't play** (Travis, this review — no native fallback exists in the end
  state). A dial failure is a load failure like any other; a game that never started has no
  results, and the existing load-timeout path handles it. (The DLL's current dial-fail→native
  fallback in `init_game` is a dev-era leftover to be retired in line with this — same philosophy
  as the seam-symbol hard-fail decision: a client that can't run the real netcode must not run.)

### §22d. What relay-borne means — and what it deliberately doesn't

A relay-borne report certifies: *this player's authenticated link was alive at the moment it
reported, the report predates its leave-intent/close on an ordered stream, and the relay placed it
at a known point on the same timeline as every departure and desync event.* It does **not**
certify content — a connected liar can push a fabricated victory through its live link, and no
relay can see sim state. Two conflicting reports from two players who both stayed connected still
void (that is §20d/§21b ground: the desync comparator already proves whether the sims agreed; if
they did, one of two conflicting claims is a lie the server cannot pick between — voiding keeps
the attacker's damage confined to their own game).

### §22e. Reconciliation: no new policy — the structure does the work

**No reconciliation rule changes.** The §21b concession tiebreak already resolves the target
class, because relay-only delivery makes "reported" and "was connected when it reported" the same
fact:
- **The closed class:** a loser cuts its link then tries to claim victory — there is no channel.
  It is an abandoner-without-a-report with a `dropped` departure record; the honest winner is the
  sole reporter with a terminal self-victory → §21b concession → decisive honest win (today: void).
- **Lingering liar** (stays connected, lies through the relay): both reported → void, unchanged.
  An attacker can always spoil its own game; it can never flip the honest player to a loss.
- **Honest player's report lost** (relay crash window above): sole-reporter concession needs the
  *other* side to have a departure record — a lost-report player has none (it left cleanly or is
  still the survivor), so nothing engages against it; sweep → dispute/void, never a flip.
- **Both crash / neither reports:** all-unknown → sweep → void, unchanged.
The stored relay stamps (`relay_report_time`, `relay_report_frame`) drive **no v1 rule** — §21b
already established that order-based adjudication is what liars game. They exist so a future
policy (or a human reviewing a dispute) reads one trustworthy timeline instead of two clocks.

### §22f. Build plan, acceptance, open items

Order (each step lands green before the next):
1. **rp2**: proto `GameResult` frame + transport `send_control_result`/reader arm + driver channel,
   latch + intent-hold + relay serve-loop arm (no `break 'serve`) + `DecisionMaker` record/dedup/
   stamps + `RelayNotice::Result` → coordinator dispatch, dedup, `ResultWebhook` + unit tests
   (one-per-slot, size cap, result-then-intent ordering, notice refs fallback, Unknown-fold compat).
2. **game/**: async-thread handoff (serialize once, hand to driver), result-expected latch,
   loop-end reorder in `game_thread.rs`, HTTP POST skipped when a v2 session was active.
3. **server/**: webhook `result` schema + ingest-as-submission + timing-stamps migration +
   `results2` rejection for v2 games + app/renderer backup-resend disable + tests (incl. the
   §22e sweep cases as adversarial unit tests — the lie class can't be produced by an honest
   client, like Fix A/B).

Acceptance: unit suites green in all three repos, then live loopback — (a) honest 1v1: both
results arrive via relay webhook only (`relay_report_time` stamped, zero `results2` hits in the
server log), reconcile unchanged; (b) `LMission` defeat reports over the live link at dialog time;
(c) loop-end F10 quit: relay log shows the result frame processed *before* the leave intent;
(d) true-crash (kill app + game processes): no report exists anywhere, departure recorded, and the
survivor's sole report resolves the game by §21b concession — the class this section closes,
observed live; (e) a v2 game's direct `results2` POST is rejected.

Open/flagged:
- **Unify `LMission` with `WMission` session-close** (Travis, from this review: the asymmetry in
  §21a is suspect — a game that's decided *for me* is decided, whichever dialog says so). Not this
  slice; weigh the one real difference — staying networked after defeat is what lets a defeated
  player spectate a still-live team game.
- Replay upload stays HTTP forever (size); replays are evidence, not claims.
- Post-cutover cleanup: delete the `results2` submission endpoint and the app's backup-resend
  machinery outright once no pre-v2 client can exist.

### §22g. Fast force-reconcile for fully-accounted v2 games (Travis, same review — built with
### this slice)

The 180-minute force-reconcile timeout is the blunt heuristic the old TODO(tec27) in
`game-result-service.ts` complained about: with no way to know whether a game was still being
played, the sweep had to wait long enough that no legitimate game could still be running. Relay-only
results + relay-recorded departures remove the uncertainty for a v2 game: **every human is always
in exactly one of three states — still linked (game in progress), reported (result recorded), or
departed (relay-signed record, and structurally unable to ever report, since reports only travel
over the now-closed link).** So once every human has a report or a departure record, the game is
definitively over and nothing new can arrive except an in-flight webhook retry (relay pending-buffer
+ coordinator backoff, ≤ ~2 minutes end to end).

**"Reported or departed" is a closed ledger** (Travis, follow-up): a departed human structurally
cannot submit anymore, and a reported one cannot submit *again* — so the moment every human is in
one of those two states, the input set is final and reconciliation can run with force semantics
immediately, not on a timer. The one caveat that turns "immediately" into "almost immediately":
the *relay* boundary is strictly ordered (a slot's result always precedes its departure), but
webhook *delivery* is not — the coordinator dispatches each notice with independent retries
(backoff to 30s, ~6 attempts), so a result can land at the app server up to ~a minute after the
same slot's departure. A short grace absorbs that skew.

Two layers, both keyed on the same predicate — config says `useNetcodeV2` ∧ every human has
`reported_results` or a `departure_kind`:
1. **Event-driven (the normal path):** after the webhook ingest records a departure *or* a result,
   if the predicate now holds, schedule a one-shot force-reconcile in
   `RECONCILE_KNOWN_COMPLETE_DELAY_MS = 2 min` (per-game deduped one-shot via `clock.setTimeout`,
   the exact `scheduleDesyncGraceRecheck` pattern; the existing matchmaking desync-verdict grace
   still applies inside reconcile). This removes the timer from the vast majority of v2
   reconciliations — a game ends, and ~2 minutes later it is reconciled.
2. **Sweep backstop (restart resilience):** the one-shot dies with the server, so the existing
   15-minute sweep also force-reconciles any game where the predicate holds and the newest
   report/departure timestamp is ≥ `RECONCILE_KNOWN_COMPLETE_MINUTES = 10` old.

The 180-minute rule stays for anything the relay can't vouch for (legacy games, and v2 games where
some human neither reported nor departed — e.g. a diverged client still idling on its link).
D11-note: a future reconnect grace doesn't break the invariant, because a departure record is only
written when a synced leave was *decided* — a reconnect within the relay's grace window never
produces one.

**Why 2 minutes and not zero (Travis asked):** the delay exists solely because webhook delivery is
unordered across notices — each is dispatched with its own retry loop, so slot X's *result* (accepted
by the relay before X's leave, and so part of the final input set) can still be mid-retry when X's
*departure* has already landed. Reconciling at that instant would run the concession against a
player whose report is in flight, and there is no re-reconcile fixup. The 2 minutes covers the
full retry span (~60–90s worst case) with margin. It only ever costs latency in the
crashed/abandoned-player case — a fully-reported game still reconciles the moment the last report
lands, with no §22g delay at all. **Future tightening:** per-session *ordered* webhook dispatch at
the coordinator (serialize deliveries in notice order) would make "departure arrived" imply "that
slot's result already arrived", letting the grace drop to ~seconds. Not built; the win is small
next to 180 minutes → 2.

**Superseded by §22h (2026-07-05, same review conversation):** the 2-minute grace and the
`had_result` idea both died in design review — §22h replaces them with embedded results, a
session-close signal, and reap policies, deleting the reconciliation timer outright. The §22g
event-driven trigger and sweep backstop shapes survive; only the *waiting* goes.

**Live-proven (2026-07-05, loopback, both §22 and §22g):** game 1 — forceQuit the opponent:
relay-only result (relay stamps in `games_users`, zero `results2` hits, DLL "handed result report
to driver"), victory report ingested ~200ms after `WMission`, crashed client produced *no* report
of any kind (blank-backup path confirmed dead) + `dropped` record, direct `results2` POST → 409
`RelayReportRequired`, and the §21b concession resolved it `win`/`loss`, `disputable=false` (via
the 180-min sweep path, backdated). Game 2 — same crash shape with §22g live: departure 07:13:24,
result 07:13:26 (ledger closed), **auto-reconciled 07:15:31** — `win`/`loss`, `disputable=false`,
no timer manipulation, no human intervention.

### §22h. The reconciliation timer is dead — session lifecycle owns game end (design locked with
### Travis, 2026-07-05; follow-up slice to §22/§22g)

Locked over the same review conversation, driven by two of Travis's observations: **outside the
relay, a submitted result *is* a leave** (a reported player's participation is over — they can
join another game; their later link close is administrative), and **the relay layer always knows —
or can be asked — whether a game still exists**, so no reconciliation decision ever needs a blind
timer. Four pieces:

**1. Departure notices embed the slot's result (replaces §22g's 2-minute grace and the interim
`had_result` idea).** The relay retains the (≤4 KiB, one-per-slot) result payload it records and
carries it — home-relay-authored, `reachable_frame`-style first-non-None-wins through mesh
`SlotDeparted`, departure records, and promotion — into `DepartureNotice`. Every departure webhook
is then atomic terminal truth: *left/dropped, and here is the result — or there provably never was
one* (results only ride the live link; the serve loop closes at the intent; so post-departure
results are impossible by construction). SB ingests an embedded result through the same submission
path (`AlreadyReported` dedups against the early standalone result webhook, which still fires at
dialog time — the fast path and the defeat-spectator's early report both stay). Consequences:
**zero grace** — a departure ingested closes its slot with evidence in hand; all humans accounted →
force-reconcile immediately; and every single-webhook-loss mode self-heals (the standalone result
and the departure-embedded copy are redundant deliveries; only losing both falls through).
Client-side frames are deliberately NOT merged: the ordered control stream already gives
result-then-intent atomicity at the relay, a merge would delay the `LMission` report until exit
(a loitering loser would stall everyone's reconcile), and crash departures have no leave message
to merge into. The departure notice for an already-reported slot carries no *new* accounting
information (Travis's result≡leave point) but is still sent: it is the redundancy above, and §20b's
evidence-retention decision (unconditional departure records) stands.

**2. `SessionClosed`, ordered last.** Each relay fires `RelayToCoordinator::SessionClosed` when it
tears down a session's state (all its slots gone). The coordinator — which assigned the serving
relay set — emits a final `sessionClosed` webhook once every serving relay has closed. Webhook
dispatch becomes **serialized per session** (one FIFO queue per (tenant, session) instead of
independent spawn-per-notice; retries block the queue), which makes "all prior notices delivered
or exhausted" a free consequence of queue order: ingesting `sessionClosed` *guarantees* nothing
else is in flight. SB force-reconciles on it immediately with whatever evidence landed — this
covers the dark-slot case (a slot whose both deliveries were lost) without any timer.

**3. Backstop inverted from timer to query.** SB persists the rp2 session id on the game row; the
15-minute sweep, instead of a 180-minute blind force, **asks** the coordinator via one *batch*
liveness call (`POST` a list of session ids → alive/gone map — NOT a GET per session; the probe
set is only unreconciled v2 games that missed both push paths, ~zero in steady state) and
force-reconciles the gone/unknown ones. The 180-minute constant survives solely for pre-cutover
legacy games and is deleted with them.

**4. Session reap policies (Travis, this review) — sessions cannot dangle.** Coordinator-armed
(it holds the global result+departure picture in its dedup sets), enforced by a new
`CoordinatorToRelay` close-slot directive; both count **player slots only** (observers never
report; reaped at session end):
- **Holdout reap:** honest clients report within seconds of the sim deciding (the dialogs fire on
  the same turns for everyone), so *all-but-one humans accounted + the last one silent on a live
  link* is anomalous almost immediately → short grace (~60s) → close the holdout's link → normal
  `dropped` flow → session resolves. The 1v1 anti-stall: a loser withholding its report delays the
  honest winner's decisive result by at most the grace.
- **Post-decision linger reap** (the "leave timeout after submitting a result", session-qualified):
  armed only when **all** humans are accounted but links remain → short grace (~60s) → close the
  stragglers → `SessionClosed`. The qualifier protects the defeated spectator (reported at
  `LMission`, legitimately watching live teammates — not all accounted, no reap); a per-player
  reported→must-leave rule is deliberately NOT built (it becomes trivially true if the
  `LMission`/`WMission` session-close unification ever lands).

Net: every v2 game reconciles at event speed — seconds after its last webhook in the normal case,
bounded by ~60s reap grace against malicious lingering, by queue-ordered `SessionClosed` against
webhook loss, and by the batch liveness probe against coordinator death. No blind timers remain.
Build order: rp2 (retain+embed, `SessionClosed`, per-session dispatch queue, reapers + close-slot
directive, batch liveness endpoint) → server (embedded-result ingest, `sessionClosed` force,
zero-grace trigger replacing the 2-min one-shot, session-id persistence + probe backstop).
Sequenced AFTER committing the proven §22/§22g slice, BEFORE the cross-repo landing (wire adds
stay compat-free pre-push).
