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
