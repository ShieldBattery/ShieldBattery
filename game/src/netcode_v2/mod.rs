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
//!   [`DirectiveTracker`], the slot↔storm-id map, and the PIPE-hook turn counters.
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
//!    arrays). Instead: drain the inbound channel (via [`SeamState`]), map each `Payload`'s `slot`
//!    to its storm id, write `player_turns[]`/`player_turns_size[]`/`net_player_flags[]` (setting
//!    `0x10000|0x20000` on ready slots), reproduce the synced-leave pass
//!    (`set_rng_enable(1)` → `apply_pending_player_leaves` → `set_rng_enable(orig)`), and return
//!    readiness. Buffer lifetime must span the whole `step_network` dispatch (guide §5.4 #4), so the
//!    filled command bytes are owned by [`SeamState`], not freed until the next receive.
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

use rally_point_client::DirectiveTracker;
use rally_point_client::TurnChannels;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::proto::messages::{BufferDirective, Payload};

/// Number of BW net-player slots. Mirrors `bw_scr::NET_PLAYER_COUNT`.
const NET_PLAYER_COUNT: usize = 12;

/// No mapping from a rally-point2 slot to a BW storm id yet. Slots are learned during lobby join
/// (native join assigns storm ids in join order), so the map starts empty.
const STORM_ID_UNMAPPED: u8 = 0xff;

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
    /// `[0,2]` cap — see dev note gotcha #2 / guide §5.3).
    latency_turns: u32,
    /// rally-point2 slot → BW storm id. `STORM_ID_UNMAPPED` until learned during lobby join.
    slot_to_storm: [u8; NET_PLAYER_COUNT],
    /// Local origin slot (which slot our own outbound turns belong to). The relay rebinds the wire
    /// `slot` from the token regardless; this is for our own bookkeeping/echo.
    local_slot: u8,
    /// Turns handed to the driver so far (the send cursor). PIPE-hook numerator.
    turns_sent: u32,
    /// Turns dispatched into the sim so far (the execute cursor). PIPE-hook subtrahend.
    turns_executed: u32,
}

impl SeamState {
    /// Builds seam state around the channels a running [`LinkDriver`](rally_point_client::LinkDriver)
    /// handed back. `local_slot` is this client's origin slot; `initial_latency_turns` is the
    /// built-in floor to start the pipe at (guide §4, natively 2).
    pub fn new(channels: TurnChannels, local_slot: u8, initial_latency_turns: u32) -> Self {
        Self {
            channels,
            directives: DirectiveTracker::new(),
            latency_turns: initial_latency_turns,
            slot_to_storm: [STORM_ID_UNMAPPED; NET_PLAYER_COUNT],
            local_slot,
            turns_sent: 0,
            turns_executed: 0,
        }
    }

    /// Records the rally-point2 slot ↔ BW storm id mapping learned during lobby join.
    pub fn map_slot(&mut self, slot: u8, storm_id: u8) {
        if let Some(entry) = self.slot_to_storm.get_mut(slot as usize) {
            *entry = storm_id;
        }
    }

    /// Looks up the BW storm id for a rally-point2 slot, if mapped.
    pub fn storm_id_for_slot(&self, slot: u8) -> Option<u8> {
        self.slot_to_storm
            .get(slot as usize)
            .copied()
            .filter(|&id| id != STORM_ID_UNMAPPED)
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
        let payload = Payload {
            seq: 0,
            slot: 0,
            commands: commands.to_vec().into(),
            game_frame_count: frame,
            buffer_directive: None,
        };
        match self.channels.outbound.try_send(payload) {
            Ok(()) => {
                self.turns_sent = self.turns_sent.wrapping_add(1);
                true
            }
            Err(_) => false,
        }
    }

    /// Drains one inbound turn from the driver, if available, without blocking the BW thread.
    /// Returns the peer turn (already in per-slot seq order) or `None` when the channel is empty.
    ///
    /// The IN hook calls this in a loop each receive, feeding any [`Payload::buffer_directive`] to
    /// [`observe_directive`](Self::observe_directive) before writing the turn's commands into
    /// `player_turns[]`.
    pub fn try_recv_turn(&mut self) -> Option<Payload> {
        self.channels.inbound.try_recv().ok()
    }

    /// Feeds a latency-buffer directive stamp (off an inbound turn's envelope) to the tracker.
    /// `next_frame` is the frame the game is about to simulate (guide §5.3 / D9).
    pub fn observe_directive(&mut self, directive: &BufferDirective, next_frame: u32) {
        self.directives.observe(directive, next_frame);
    }

    /// Applies any latency-buffer change due at `next_frame`, updating the pipe target the PIPE hook
    /// enforces. Call once per simulation step, after draining/observing that step's turns.
    pub fn apply_due_directive(&mut self, next_frame: u32) {
        if let Some(directive) = self.directives.take_due(next_frame) {
            self.latency_turns = directive.buffer_turns;
        }
    }

    /// PIPE hook input: turns in flight (`sent - executed`). Replaces the native
    /// `get_outstanding_turn_count`, which goes degenerate once Storm's counters stop advancing
    /// (guide §5.1 PIPE). Saturating so a transient ordering never underflows.
    pub fn outstanding_turns(&self) -> u32 {
        self.turns_sent.saturating_sub(self.turns_executed)
    }

    /// The latency buffer (in turns) the pipe should currently maintain.
    pub fn latency_turns(&self) -> u32 {
        self.latency_turns
    }

    /// Advances the execute cursor after a turn has been dispatched into the sim (the IN/step path).
    pub fn mark_turn_executed(&mut self) {
        self.turns_executed = self.turns_executed.wrapping_add(1);
    }

    /// The local origin slot, as a typed [`SlotId`] for the transport layer.
    pub fn local_slot_id(&self) -> SlotId {
        SlotId(self.local_slot)
    }
}
