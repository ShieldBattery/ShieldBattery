//! The netcode v2 (rally-point2) game seam.
//!
//! This module owns the ShieldBattery side of the three-hook turn/command seam described in
//! `scr-netcode-replacement-guide.md` §5.1 and the build plan (`netcode-v2-build-plan.md`, WS-A). It
//! replaces Storm's UDP turn transport wholesale with a QUIC link to a home relay, driven by the
//! `rally-point-client` crate.
//!
//! ## What's here today
//!
//! - [`credentials`]: the security boundary — turning the launch handoff into an `Identity` + a
//!   pinned TLS trust store (done; unit-tested).
//! - [`SeamState`]: the game-thread-owned state the three hooks operate on — the turn channels to
//!   the Tokio-side [`LinkDriver`](rally_point_client::LinkDriver), the latency-buffer
//!   [`DirectiveTracker`], the slot↔storm-id map, and the PIPE-hook in-flight turn counter.
//!
//! ## What remains (the seam wiring — for the next dev)
//!
//! The three hooks and the async handoff are **not yet installed**. The intended shape, grounded in
//! the binary (verified in the 12409 BNDB) and the decisions locked with the team:
//!
//! 1. **OUT** — replace/hook `send_turn_message` (guide §5.1). On the BW/sync thread it hands us the
//!    assembled turn `(buffer_ptr, len)`; call [`SeamState::submit_local_turn`] to enqueue it. The
//!    driver assigns `seq` and the relay binds `slot`, so we leave both zero.
//! 2. **IN** — *fully replace* `receive_storm_turns` (guide §5.1, and the BNDB annotation at
//!    `0x73f4e0`). Do **not** call the original (that runs `storm_receive_turns`, which memsets our
//!    arrays). Instead call [`SeamState::receive_turns`] (it drains the inbound channel, maps each
//!    `Payload`'s `slot` to its storm id, and gates on all required slots being present); if it
//!    returns `true`, iterate [`SeamState::dispatch_buffers`] to write
//!    `player_turns[]`/`player_turns_size[]`/`net_player_flags[]` (setting `0x10000|0x20000` on
//!    each ready slot), reproduce the synced-leave pass (`set_rng_enable(1)` →
//!    `apply_pending_player_leaves` → `set_rng_enable(orig)`) **after releasing the seam lock**
//!    (the leave pass can re-enter our OUT hook), and return `1`; if it returns `false`, return `0`
//!    to stall. The dispatched bytes are owned by [`SeamState`] as refcounted `Bytes`, valid until
//!    the next receive (guide §5.4 #4).
//! 3. **PIPE** — replace `flush_local_turns_to_latency_depth` outright (guide §5.1 PIPE; the
//!    native `get_outstanding_turn_count` goes degenerate-0 once Storm's counters stop advancing).
//!    Drive the flush loop against [`SeamState::outstanding_turns`] and the seam's own latency
//!    target (from the [`DirectiveTracker`]), not `builtin_turn_latency + net_user_latency`.
//!
//! The BW-thread ⇄ Tokio-thread handoff is [`rally_point_client::TurnChannels`] (tokio `mpsc`,
//! whose `try_send`/`try_recv` are sync and safe to call from the BW thread). The Tokio side runs
//! [`rally_point_client::LinkDriver::run`] on the DLL's existing async runtime; build the endpoint
//! with [`credentials::bind_endpoint`], dial with `ClientEndpoint::connect`, then
//! `LinkDriver::new(link)` and hand [`SeamState`] the returned channels.
//!
//! Also outstanding (tracked in the handoff summary): the self-test before committing a game to the
//! transport (guide §5.5), offset plausibility gates + native fallback (guide §6), suppressing the
//! native latency knob / turn-rate commands (dev note gotcha #2), and the `pending_leave_reason`
//! analyzer (guide §5.8 / §6 — a samase gap).

// The seam's public surface is consumed by the three hooks in `bw_scr.rs`, which are not installed
// yet (tracked in the handoff summary / guide §5.1). Until they are, these items are legitimately
// unused; the allow keeps the scaffold warning-free without hiding real dead code elsewhere. Remove
// it once the hooks are wired.
#![allow(dead_code, unused_imports)]

mod credentials;

pub use credentials::{CredentialError, RelayTarget, SessionCredentials, bind_endpoint};

use std::collections::VecDeque;

use bytes::Bytes;
use rally_point_client::DirectiveTracker;
use rally_point_client::TurnChannels;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::proto::messages::{BufferDirective, Payload};

mod session;

pub use session::{NetcodeV2Session, SessionError, establish_session, with_seam};

use crate::bw;
use crate::bw::players::StormPlayerId;

/// The game-thread-owned state the three hooks operate on.
///
/// Created once per game after the home relay link is up (see module docs). Not `Sync`: it is
/// touched only from the BW/sync thread, which is also the only thread the hooks fire on. The Tokio
/// side owns the other ends of [`TurnChannels`] via the driver.
pub struct SeamState {
    /// Turns to/from the Tokio-side driver. `outbound` carries turns we produce; `inbound` carries
    /// peers' turns the relay forwarded, tagged by source slot.
    channels: TurnChannels,
    /// Collapses the authority relay's redundant, out-of-order latency-buffer directive stream into
    /// at-most-one change per decision, surfaced at its apply frame (D9).
    directives: DirectiveTracker,
    /// The latency buffer (in turns) currently in force — the PIPE hook keeps this many turns in
    /// flight. Starts at the built-in floor; a due [`BufferDirective`] resizes it (no native
    /// `[0,2]` cap upward — see dev note gotcha #2 / guide §5.3 — but floored at 1 locally, see
    /// [`apply_due_directive`](Self::apply_due_directive)).
    latency_turns: u32,
    /// rally-point2 slot → BW storm id. `None` until learned during lobby join (native join
    /// assigns storm ids in join order, so the map starts empty).
    slot_to_storm: [Option<StormPlayerId>; bw::MAX_STORM_PLAYERS],
    /// Local origin slot (which slot our own outbound turns belong to). The relay rebinds the wire
    /// `slot` from the token regardless; this is for our own bookkeeping/echo.
    local_slot: SlotId,
    /// Local turns handed to the driver but not yet executed by the sim — the PIPE hook keeps
    /// this at the latency target. Up on [`submit_local_turn`](Self::submit_local_turn), down on
    /// [`mark_local_turn_executed`](Self::mark_local_turn_executed); a single counter so the two
    /// events can never be miscounted against each other.
    turns_in_flight: u32,
    /// Per-storm-slot FIFO of turns waiting to be dispatched, in arrival order. A remote slot's
    /// turns arrive already per-slot seq-ordered from the driver; the local slot's own turns are
    /// echoed in here at submit time — the relay forwards each turn to every slot *except* its
    /// sender ([`routing`], D-fanout), so our turns never come back over `inbound`, and echoing is
    /// what keeps local commands on the same latency delay as everyone else's (guide §5.4 #3).
    inbound_queues: [VecDeque<Bytes>; bw::MAX_STORM_PLAYERS],
    /// The command bytes for the turn currently being dispatched, per storm slot. Owned here (as
    /// refcounted [`Bytes`]) so the pointers written into `player_turns[]` stay valid through the
    /// whole `step_network` dispatch (guide §5.4 #4); replaced on the next successful receive,
    /// never freed mid-dispatch.
    current_dispatch: [Option<Bytes>; bw::MAX_STORM_PLAYERS],
    /// Which storm slots must supply a turn before a step is ready to dispatch. Set as slots are
    /// mapped during join; a synced leave clears one (so the sim stops waiting on a departed peer).
    required: [bool; bw::MAX_STORM_PLAYERS],
}

impl SeamState {
    /// Builds seam state around the channels a running [`LinkDriver`](rally_point_client::LinkDriver)
    /// handed back. `local_slot` is this client's origin slot; `initial_latency_turns` is the
    /// built-in floor to start the pipe at (guide §4, natively 2).
    pub fn new(channels: TurnChannels, local_slot: SlotId, initial_latency_turns: u32) -> Self {
        Self {
            channels,
            directives: DirectiveTracker::new(),
            latency_turns: initial_latency_turns.max(1),
            slot_to_storm: [None; bw::MAX_STORM_PLAYERS],
            local_slot,
            turns_in_flight: 0,
            inbound_queues: std::array::from_fn(|_| VecDeque::new()),
            current_dispatch: std::array::from_fn(|_| None),
            required: [false; bw::MAX_STORM_PLAYERS],
        }
    }

    /// Records the rally-point2 slot ↔ BW storm id mapping learned during lobby join.
    ///
    /// rp2 slots are coordinator-bounded (≤ 7), so an out-of-range slot can't occur short of a
    /// protocol bug; assert in debug so one would surface loudly rather than as a mapping that
    /// silently never resolves.
    pub fn map_slot(&mut self, slot: SlotId, storm_id: StormPlayerId) {
        debug_assert!(
            (slot.0 as usize) < bw::MAX_STORM_PLAYERS,
            "rp2 slot out of range: {slot:?}"
        );
        if let Some(entry) = self.slot_to_storm.get_mut(slot.0 as usize) {
            *entry = Some(storm_id);
        }
        // A mapped slot is a session participant: the sim must have its turn each step.
        if let Some(req) = self.required.get_mut(storm_id.0 as usize) {
            *req = true;
        }
    }

    /// Looks up the BW storm id for a rally-point2 slot, if mapped.
    pub fn storm_id_for_slot(&self, slot: SlotId) -> Option<StormPlayerId> {
        self.slot_to_storm.get(slot.0 as usize).copied().flatten()
    }

    /// OUT hook body: hand a fully-assembled local turn to the driver. `commands` is the native
    /// SC:R command bytes from `send_turn_message` (keep-alive + sync already baked in). `frame` is
    /// the executable-turn index for an in-game turn, or `None` for a lobby turn (guide §5.1 dev
    /// note gotcha #1: leave it `None` only for lobby turns).
    ///
    /// Returns `false` if the channel to the driver is closed or full (the driver died or the game
    /// stalled) — the caller decides how to surface that (stall UI / teardown). `seq` and `slot`
    /// are left zero: the driver assigns the seq and the relay binds the slot from the token.
    pub fn submit_local_turn(&mut self, commands: &[u8], frame: Option<u32>) -> bool {
        let commands = Bytes::copy_from_slice(commands);
        let payload = Payload {
            seq: 0,
            slot: 0,
            commands: commands.clone(),
            game_frame_count: frame,
            buffer_directive: None,
        };
        match self.channels.outbound.try_send(payload) {
            Ok(()) => {
                // Echo our own turn into our dispatch queue: the relay fans out to peers only, so
                // this is the sole path by which our commands reach the local sim — and it keeps
                // them on the same latency delay as everyone else's (guide §5.4 #3). Only on a
                // successful send: if the turn never left, executing it locally would desync us
                // from peers who never saw it (the session is tearing down at that point anyway).
                if let Some(local_storm) = self.storm_id_for_slot(self.local_slot)
                    && let Some(queue) = self.inbound_queues.get_mut(local_storm.0 as usize)
                {
                    queue.push_back(commands);
                }
                self.turns_in_flight = self.turns_in_flight.saturating_add(1);
                true
            }
            Err(_) => false,
        }
    }

    /// Drains every inbound turn currently available from the driver into the per-slot queues,
    /// feeding each turn's [`BufferDirective`] to the latency tracker as it goes. Never blocks.
    /// `next_frame` is the frame the game is about to simulate (guide §5.3 / D9).
    fn drain_inbound(&mut self, next_frame: u32) {
        while let Ok(payload) = self.channels.inbound.try_recv() {
            if let Some(directive) = &payload.buffer_directive {
                self.directives.observe(directive, next_frame);
            }
            let slot = SlotId(payload.slot as u8);
            let Some(storm) = self.storm_id_for_slot(slot) else {
                // A turn for an unmapped slot can't be attributed to a BW player. Slots are mapped
                // at join, so this shouldn't happen; drop it rather than mis-deliver to a peer.
                debug_assert!(false, "inbound turn for unmapped slot {slot:?}");
                continue;
            };
            if let Some(queue) = self.inbound_queues.get_mut(storm.0 as usize) {
                queue.push_back(payload.commands);
            }
        }
    }

    /// IN-hook core: drain arrivals, then — if every required slot has a turn queued — pop exactly
    /// one turn per required slot into the owned dispatch buffers and report ready.
    ///
    /// Returns `true` when a full turn is ready to dispatch (every required slot present), `false`
    /// to stall. On a stall **nothing is consumed**, so a later call re-checks once the missing
    /// turns arrive — the caller returns 0 from `receive_storm_turns` to hold the sim (guide §3
    /// "return value = the gate"). After a `true`, read [`dispatch_buffers`](Self::dispatch_buffers)
    /// to fill `player_turns[]`, then call [`apply_due_directive`](Self::apply_due_directive).
    pub fn receive_turns(&mut self, next_frame: u32) -> bool {
        self.drain_inbound(next_frame);
        let ready = (0..bw::MAX_STORM_PLAYERS)
            .all(|storm| !self.required[storm] || !self.inbound_queues[storm].is_empty());
        if !ready {
            return false;
        }
        // Release one turn per required slot; non-required slots dispatch nothing this step.
        for storm in 0..bw::MAX_STORM_PLAYERS {
            self.current_dispatch[storm] = if self.required[storm] {
                self.inbound_queues[storm].pop_front()
            } else {
                None
            };
        }
        true
    }

    /// The command buffers to dispatch this step: `(storm id, command bytes)` for each ready slot.
    /// Valid until the next [`receive_turns`](Self::receive_turns) (guide §5.4 #4). The IN hook
    /// writes each entry's pointer/length into `player_turns[]`/`player_turns_size[]` and sets the
    /// `0x10000 | 0x20000` present+ready flags on that slot.
    pub fn dispatch_buffers(&self) -> impl Iterator<Item = (StormPlayerId, &[u8])> {
        self.current_dispatch
            .iter()
            .enumerate()
            .filter_map(|(storm, buf)| buf.as_ref().map(|b| (StormPlayerId(storm as u8), b.as_ref())))
    }

    /// Marks a storm slot as departed: it no longer gates step readiness, and its queued and
    /// in-dispatch bytes are dropped. Called from the synced leave pass when a peer leaves/drops
    /// (guide §5.8) so the sim stops waiting on a slot that will never send another turn.
    pub fn mark_slot_left(&mut self, storm_id: StormPlayerId) {
        let storm = storm_id.0 as usize;
        if let Some(req) = self.required.get_mut(storm) {
            *req = false;
        }
        if let Some(queue) = self.inbound_queues.get_mut(storm) {
            queue.clear();
        }
        if let Some(slot) = self.current_dispatch.get_mut(storm) {
            *slot = None;
        }
    }

    /// Applies any latency-buffer change due at `next_frame`, updating the pipe target the PIPE hook
    /// enforces. Call once per simulation step, after draining/observing that step's turns.
    ///
    /// Floored at 1: the relay's decision logic is documented to keep `buffer_turns >= 1`, but
    /// that bound is not enforced on the wire, and a 0 target would permanently stop the PIPE
    /// loop (`outstanding < 0` is never true for a `u32`) — a lockstep deadlock. Don't trust a
    /// remote invariant to prevent a local deadlock.
    pub fn apply_due_directive(&mut self, next_frame: u32) {
        if let Some(directive) = self.directives.take_due(next_frame) {
            self.latency_turns = directive.buffer_turns.max(1);
        }
    }

    /// PIPE hook input: local turns in flight. Replaces the native
    /// `get_outstanding_turn_count`, which goes degenerate once Storm's counters stop advancing
    /// (guide §5.1 PIPE).
    pub fn outstanding_turns(&self) -> u32 {
        self.turns_in_flight
    }

    /// The latency buffer (in turns) the pipe should currently maintain.
    pub fn latency_turns(&self) -> u32 {
        self.latency_turns
    }

    /// Takes one local turn out of flight after the sim executes a network step.
    ///
    /// Call this **exactly once per executed network step** — one *local* turn leaves the pipe
    /// per step — NOT once per peer [`Payload`] dispatched. In an N-player game the IN hook
    /// drains N per-slot payloads per step; counting each of those here would drive
    /// [`outstanding_turns`](Self::outstanding_turns) to 0 and make the PIPE loop flush
    /// unboundedly (the exact degenerate-0 failure this counter replaces). Saturating so a
    /// spurious extra call never underflows.
    pub fn mark_local_turn_executed(&mut self) {
        self.turns_in_flight = self.turns_in_flight.saturating_sub(1);
    }

    /// The local origin slot, as a typed [`SlotId`] for the transport layer.
    pub fn local_slot_id(&self) -> SlotId {
        self.local_slot
    }
}

#[cfg(test)]
mod tests {
    use rally_point_client::TurnChannels;
    use tokio::sync::mpsc;

    use super::*;

    const LOCAL_SLOT: SlotId = SlotId(0);
    const PEER_SLOT: SlotId = SlotId(1);
    const LOCAL_STORM: StormPlayerId = StormPlayerId(3);
    const PEER_STORM: StormPlayerId = StormPlayerId(5);

    /// Builds a SeamState wired to test channels. Returns the state, a sender to inject peer turns
    /// on `inbound`, and the outbound receiver to observe/keep-alive what we submit. Both far ends
    /// are returned so the channels stay open (dropping them would close the seam's ends).
    fn seam() -> (SeamState, mpsc::Sender<Payload>, mpsc::Receiver<Payload>) {
        let (out_tx, out_rx) = mpsc::channel(16);
        let (in_tx, in_rx) = mpsc::channel(16);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
        };
        (SeamState::new(channels, LOCAL_SLOT, 2), in_tx, out_rx)
    }

    fn peer_turn(slot: SlotId, commands: &[u8]) -> Payload {
        Payload {
            seq: 0,
            slot: slot.0 as u32,
            commands: Bytes::copy_from_slice(commands),
            game_frame_count: Some(0),
            buffer_directive: None,
        }
    }

    fn dispatched(state: &SeamState) -> Vec<(StormPlayerId, Vec<u8>)> {
        state
            .dispatch_buffers()
            .map(|(storm, bytes)| (storm, bytes.to_vec()))
            .collect()
    }

    #[test]
    fn initial_latency_is_floored_at_one() {
        let (out_tx, out_rx) = mpsc::channel(1);
        let (_in_tx, in_rx) = mpsc::channel(1);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
        };
        let state = SeamState::new(channels, LOCAL_SLOT, 0);
        assert_eq!(state.latency_turns(), 1);
        drop(out_rx);
    }

    #[test]
    fn not_ready_until_every_required_slot_has_a_turn() {
        let (mut state, in_tx, _out_rx) = seam();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // Only the peer turn has arrived; our own local turn hasn't been submitted yet.
        in_tx.try_send(peer_turn(PEER_SLOT, b"peer")).unwrap();
        assert!(!state.receive_turns(0), "should stall with a required slot missing");
        // A stall consumes nothing, so the peer turn is still queued for the next check.

        assert!(
            state.submit_local_turn(b"local", Some(0)),
            "submit should succeed while the driver end is open"
        );
        assert!(state.receive_turns(0), "ready once both required slots have a turn");

        let mut got = dispatched(&state);
        got.sort_by_key(|(storm, _)| storm.0);
        assert_eq!(
            got,
            vec![
                (LOCAL_STORM, b"local".to_vec()),
                (PEER_STORM, b"peer".to_vec()),
            ]
        );
    }

    #[test]
    fn local_turn_is_echoed_into_its_own_slot() {
        // The relay fans out to peers only, so our own commands must reach the local sim via the
        // echo — not the inbound channel.
        let (mut state, _in_tx, mut out_rx) = seam();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);

        assert!(state.submit_local_turn(b"local", Some(7)));
        // It went out to the relay...
        let sent = out_rx.try_recv().expect("turn forwarded to the driver");
        assert_eq!(&sent.commands[..], b"local");
        assert_eq!(sent.game_frame_count, Some(7));
        // ...and it's queued for local dispatch.
        assert!(state.receive_turns(7));
        assert_eq!(dispatched(&state), vec![(LOCAL_STORM, b"local".to_vec())]);
    }

    #[test]
    fn one_turn_released_per_step_even_with_a_backlog() {
        let (mut state, in_tx, _out_rx) = seam();
        state.map_slot(PEER_SLOT, PEER_STORM);

        in_tx.try_send(peer_turn(PEER_SLOT, b"t1")).unwrap();
        in_tx.try_send(peer_turn(PEER_SLOT, b"t2")).unwrap();

        assert!(state.receive_turns(0));
        assert_eq!(dispatched(&state), vec![(PEER_STORM, b"t1".to_vec())]);
        // Second turn stays queued and comes out on the next step, preserving lockstep pace.
        assert!(state.receive_turns(1));
        assert_eq!(dispatched(&state), vec![(PEER_STORM, b"t2".to_vec())]);
    }

    #[test]
    fn a_left_slot_stops_gating_readiness() {
        let (mut state, in_tx, _out_rx) = seam();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // Local present, peer absent → would stall.
        assert!(state.submit_local_turn(b"local", Some(0)));
        assert!(!state.receive_turns(0));

        // The peer leaves; the sim should proceed on the remaining slot alone. The local turn is
        // still queued (the stall above consumed nothing), so this step is now ready.
        state.mark_slot_left(PEER_STORM);
        assert!(state.receive_turns(0));
        assert_eq!(dispatched(&state), vec![(LOCAL_STORM, b"local".to_vec())]);
        drop(in_tx);
    }

    #[test]
    fn buffer_directive_off_an_inbound_turn_retargets_latency() {
        let (mut state, in_tx, _out_rx) = seam();
        state.map_slot(PEER_SLOT, PEER_STORM);

        let mut turn = peer_turn(PEER_SLOT, b"x");
        turn.buffer_directive = Some(BufferDirective {
            buffer_turns: 4,
            apply_at_frame: 10,
            decision_seq: 1,
        });
        in_tx.try_send(turn).unwrap();

        // Draining observes the directive; it applies at its frame.
        assert!(state.receive_turns(0));
        assert_eq!(state.latency_turns(), 2, "not due yet");
        state.apply_due_directive(10);
        assert_eq!(state.latency_turns(), 4, "applied at its frame");
    }

    #[test]
    fn pipe_counter_tracks_local_turns_in_flight() {
        let (mut state, _in_tx, _out_rx) = seam();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);

        assert_eq!(state.outstanding_turns(), 0);
        state.submit_local_turn(b"a", Some(0));
        state.submit_local_turn(b"b", Some(1));
        assert_eq!(state.outstanding_turns(), 2);
        state.mark_local_turn_executed();
        assert_eq!(state.outstanding_turns(), 1);
    }
}
