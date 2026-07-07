//! The netcode v2 (rally-point2) turn transport.
//!
//! This module owns the ShieldBattery side of the three-hook turn/command seam that replaces Storm's
//! UDP turn transport wholesale with a QUIC link to a home relay, driven by the `rally-point-client`
//! crate. The hooks themselves live in `bw_scr.rs`; this module owns the game-thread state they
//! operate on and the async setup that stands up a session.
//!
//! ## The three hooks (in `bw_scr.rs`) and how they use this module
//!
//! 1. **OUT** — hooks `send_turn_message`, which hands us the fully-assembled local turn
//!    `(buffer_ptr, len)` on the BW/sync thread. The hook calls [`TurnState::submit_local_turn`] to
//!    enqueue it. The driver assigns the transport `seq` and the relay binds the `slot`, so both are
//!    left zero.
//! 2. **IN** — *fully replaces* `receive_storm_turns` (never calls the original, so its obfuscated
//!    inner routine that memsets the arrays never runs). The hook calls [`TurnState::receive_turns`]
//!    (drains the inbound channel, gates on all required slots being present); when it returns
//!    `true`, it iterates [`TurnState::dispatch_buffers`] to fill
//!    `player_turns[]`/`player_turns_size[]`/`net_player_flags[]` (setting `0x10000|0x20000` on each
//!    ready slot), then runs the synced-leave pass **after releasing the turn-state lock** (the leave pass
//!    can re-enter the OUT hook). The dispatched bytes are owned here as refcounted `Bytes`, valid
//!    until the next receive.
//! 3. **PIPE** — *fully replaces* `flush_local_turns_to_latency_depth`, driving the flush loop
//!    against [`TurnState::outstanding_turns`] and [`TurnState::latency_turns`] rather than the
//!    native in-flight count (which goes degenerate-0 once Storm's counters stop advancing).
//!
//! ## What's here
//!
//! - [`credentials`]: the security boundary — turning the launch handoff into an `Identity` + a
//!   pinned TLS trust store.
//! - [`TurnState`]: the game-thread-owned state the hooks operate on — the turn channels to the
//!   Tokio-side [`LinkDriver`](rally_point_client::LinkDriver), the latency-buffer
//!   [`DirectiveTracker`], the slot↔storm-id map, and the PIPE-hook in-flight turn counter.
//! - [`session`]: [`establish_session`] (dial the relay, spawn the driver, stash the turn state) and
//!   [`with_turn_state`] (the hooks' accessor to the live turn state).
//!
//! The BW-thread ⇄ Tokio-thread handoff is [`rally_point_client::TurnChannels`] (tokio `mpsc`, whose
//! `try_send`/`try_recv` are sync and safe to call from the BW thread). The Tokio side runs
//! [`rally_point_client::LinkDriver::run`] on the DLL's existing async runtime.

// `clear_session` is wired but not yet called (no game-end teardown hooked yet). The narrow allow
// covers it without hiding dead code elsewhere.
#![allow(dead_code)]

mod credentials;

use std::collections::VecDeque;
use std::sync::atomic::Ordering;

use bytes::Bytes;
use rally_point_client::DirectiveTracker;
use rally_point_client::LeaveTracker;
use rally_point_client::TurnChannels;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::proto::messages::{LeaveDirective, Payload};
use tokio::sync::mpsc;

mod session;

// The turn state is driven from `bw_scr.rs` (the three hooks) and stood up from `game_state.rs`
// (`establish_session`), so only these are re-exported. The credential/session types stay internal
// to their submodules. `with_lobby_session_seed` is consumed by the `storm_join_game` replacement
// hook (in `bw_scr.rs`); the seed types and `set_lobby_session_seed`/`clear_lobby_session_seed` are
// the staging API the native-lobby setup path uses to stage (and drop) a join seed.
pub use session::{
    LobbySessionSeed, StormMemberSeed, begin_local_only, clear_lobby_session_seed,
    establish_session, set_lobby_session_seed, submit_result_report, with_lobby_session_seed,
    with_turn_state,
};

use crate::app_messages::SbUserId;
use crate::bw;
use crate::bw::players::StormPlayerId;

/// BW's native "player left" leave reason — the same value the relay stamps onto a clean leave, so a
/// locally-fabricated leave (see [`TurnState::begin_local_only`]) applies identically to a
/// relay-directed clean departure.
const LOCAL_ONLY_LEAVE_REASON: u32 = 3;

/// BW's lobby-phase keep-alive record: the bare 1-byte command buffer `send_turn_message` flushes
/// when nothing was queued that tick. Used both to synthesize a stand-in for a required peer with
/// nothing queued, and to recognize (and skip relaying) the local flush's own empty-tick buffer.
const LOBBY_KEEP_ALIVE: u8 = 0x05;

/// Builds the 12-byte Storm net key that identifies a session member in Storm's local
/// session-player list. The key is `[b'S', b'B', slot, 0]` followed by the SB user id as a
/// little-endian `u32`, then zero padding to 12 bytes.
///
/// Storm uses these keys only as local list-lookup identities — the join replacement seeds each
/// member's list node under its key and later looks it up by the same key. The network paths that
/// would compare a key against one derived from a received packet never run in the native-lobby
/// seam, so the only requirement on this value is that it be deterministic and unique per member
/// within the session; both the slot and the user id are unique per member, so either alone would
/// suffice and the pair is comfortably unique.
pub fn storm_net_key(slot: u8, user_id: SbUserId) -> [u8; 12] {
    let mut key = [0u8; 12];
    key[0] = b'S';
    key[1] = b'B';
    key[2] = slot;
    key[3] = 0;
    key[4..8].copy_from_slice(&user_id.0.to_le_bytes());
    key
}

/// The game-thread-owned state the three hooks operate on.
///
/// Created once per game after the home relay link is up (see module docs). Not `Sync`: it is
/// touched only from the BW/sync thread, which is also the only thread the hooks fire on. The Tokio
/// side owns the other ends of [`TurnChannels`] via the driver.
pub struct TurnState {
    /// Turns to/from the Tokio-side driver. `outbound` carries turns we produce; `inbound` carries
    /// peers' turns the relay forwarded, tagged by source slot.
    channels: TurnChannels,
    /// Collapses the authority relay's redundant, out-of-order latency-buffer directive stream into
    /// at-most-one change per decision, surfaced at its apply frame.
    directives: DirectiveTracker,
    /// Collapses the authority relay's redundant, out-of-order synced player-leave directive stream
    /// into at-most-one leave per slot, surfaced at its apply frame. Sibling of `directives`; a due
    /// leave is applied at the top of the IN hook (before readiness), because clearing the departing
    /// slot is what unstalls a step blocked on it.
    leaves: LeaveTracker,
    /// The latency buffer (in turns) currently in force — the PIPE hook keeps this many turns in
    /// flight. Starts at the built-in floor; a due [`BufferDirective`] resizes it, with no upward cap
    /// (the relay owns latency) but floored at 1 locally — see
    /// [`apply_due_directive`](Self::apply_due_directive).
    latency_turns: u32,
    /// rally-point2 slot → BW storm id. `None` until learned during lobby join (native join
    /// assigns storm ids in join order, so the map starts empty).
    slot_to_storm: [Option<StormPlayerId>; bw::MAX_STORM_PLAYERS],
    /// The session's slot roster from the coordinator (via the launch handoff): which SB user
    /// occupies each rp2 slot. Consulted as storm ids solidify during join to map each *peer's*
    /// slot; our own slot comes from the signed token instead ([`map_local_storm`](Self::map_local_storm)).
    roster: Vec<(SlotId, SbUserId)>,
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
    /// sender, so our turns never come back over `inbound`, and echoing is what keeps local commands
    /// on the same latency delay as everyone else's (lockstep requires our own commands to execute
    /// on the same turn as our peers see them).
    inbound_queues: [VecDeque<Bytes>; bw::MAX_STORM_PLAYERS],
    /// The command bytes for the turn currently being dispatched, per storm slot. Owned here (as
    /// refcounted [`Bytes`]) so the pointers written into `player_turns[]` stay valid through the
    /// whole `step_network` dispatch; replaced on the next successful receive, never freed
    /// mid-dispatch.
    current_dispatch: [Option<Bytes>; bw::MAX_STORM_PLAYERS],
    /// Which storm slots must supply a turn before a step is ready to dispatch. Set as slots are
    /// mapped during join; a synced leave clears one (so the sim stops waiting on a departed peer).
    required: [bool; bw::MAX_STORM_PLAYERS],
    /// Whether the lobby seam is active: when `true`, [`submit_local_lobby_turn`](Self::submit_local_lobby_turn)
    /// and [`lobby_receive_turns`](Self::lobby_receive_turns) carry BW's lobby-phase command traffic
    /// over the driver's lobby channels instead of leaving lobby join on native Storm networking.
    /// Defaults to `false`: the lobby seam is dead code until the (future) native-lobby setup path
    /// calls [`enable_lobby_seam`](Self::enable_lobby_seam) — the currently-shipping "scope C"
    /// direct-registration setup path never does, so adding this machinery changes zero runtime
    /// behavior on its own.
    lobby_seam_enabled: bool,
    /// The local member's pending lobby turns, queued at OUT time by
    /// [`submit_local_lobby_turn`](Self::submit_local_lobby_turn) — the lobby analogue of
    /// `inbound_queues`'s local echo. Also the pacing gate for
    /// [`lobby_receive_turns`](Self::lobby_receive_turns): the native lobby flush produces one
    /// buffer roughly every 50 ms, so gating readiness on this queue reproduces that cadence instead
    /// of free-running a turn per poll.
    lobby_echo: VecDeque<Bytes>,
    /// Per-storm-slot FIFO of other members' lobby command buffers, delivered off
    /// `channels.lobby_in` and routed by [`drain_lobby_inbound`](Self::drain_lobby_inbound). The
    /// lobby analogue of `inbound_queues`.
    lobby_inbound: [VecDeque<Bytes>; bw::MAX_STORM_PLAYERS],
    /// The lobby command buffers currently being dispatched, per storm slot. Kept separate from
    /// `current_dispatch` so the lobby→game transition can't cross-pollute the two dispatch sets.
    /// Owned here (as refcounted [`Bytes`]) for the same reason as `current_dispatch`: the pointers
    /// written into `player_turns[]` must stay valid through the whole dispatch.
    lobby_dispatch: [Option<Bytes>; bw::MAX_STORM_PLAYERS],
    /// Set once the local result is decided (see [`begin_local_only`](Self::begin_local_only)): the
    /// session is ending, so [`submit_local_turn`](Self::submit_local_turn) keeps echoing our turns
    /// into the sim but stops handing them to the (closing) link. Latched — never cleared.
    local_only: bool,
    /// Whether this game contains computer (AI) players. Set once at setup from the slot list.
    /// Gates [`should_self_close`](Self::should_self_close): only a game with AI can continue after
    /// every remote human has left, so only such a game self-closes its session when it runs out of
    /// remote humans. A human-only game left alone is one whose winner is about to report a result,
    /// which must not race the session closing.
    has_computers: bool,
    /// Slots the `forceLeave` debug command has queued for a forced synced leave on the game thread.
    /// Drained by the IN hook before it checks readiness (see `bw_scr::apply_forced_leaves`), which
    /// writes each slot's `pending_leave_reason` and drops it from `required`. Debug-only trigger for
    /// exercising the leave/reconnect paths without a real human quit.
    #[cfg(debug_assertions)]
    forced_leaves: Vec<SlotId>,
    /// Set by the `forceDesync` debug command; drained by the IN hook on the game thread (see
    /// `bw_scr::apply_forced_desync`), which perturbs the local player's minerals so this client's
    /// simulation diverges from its peers. Debug-only trigger for observing how a desync propagates.
    #[cfg(debug_assertions)]
    forced_desync: bool,
}

impl TurnState {
    /// Builds turn state around the channels a running [`LinkDriver`](rally_point_client::LinkDriver)
    /// handed back. `local_slot` is this client's origin slot; `initial_latency_turns` is the
    /// built-in floor to start the pipe at (natively 2); `roster` is the coordinator's slot↔user
    /// pairing for every session participant; `has_computers` is whether the game contains AI
    /// players (drives [`should_self_close`](Self::should_self_close)).
    pub fn new(
        channels: TurnChannels,
        local_slot: SlotId,
        initial_latency_turns: u32,
        roster: Vec<(SlotId, SbUserId)>,
        has_computers: bool,
    ) -> Self {
        Self {
            channels,
            directives: DirectiveTracker::new(),
            leaves: LeaveTracker::new(),
            latency_turns: initial_latency_turns.max(1),
            slot_to_storm: [None; bw::MAX_STORM_PLAYERS],
            roster,
            local_slot,
            turns_in_flight: 0,
            inbound_queues: std::array::from_fn(|_| VecDeque::new()),
            current_dispatch: std::array::from_fn(|_| None),
            required: [false; bw::MAX_STORM_PLAYERS],
            lobby_seam_enabled: false,
            lobby_echo: VecDeque::new(),
            lobby_inbound: std::array::from_fn(|_| VecDeque::new()),
            lobby_dispatch: std::array::from_fn(|_| None),
            local_only: false,
            has_computers,
            #[cfg(debug_assertions)]
            forced_leaves: Vec::new(),
            #[cfg(debug_assertions)]
            forced_desync: false,
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

    /// Records this client's own rp2 slot ↔ storm id mapping, learned when our storm id solidifies
    /// during join. The local slot comes from the signed token (not the join order), so this is the
    /// one mapping we can always make correctly; it's what makes the local echo
    /// ([`submit_local_turn`](Self::submit_local_turn)) deliver our own turns into the sim.
    pub fn map_local_storm(&mut self, storm_id: StormPlayerId) {
        let slot = self.local_slot;
        self.map_slot(slot, storm_id);
    }

    /// Records a *peer's* rp2 slot ↔ storm id mapping by resolving the user through the session
    /// roster, as that player's storm id solidifies during join. A user missing from the roster is
    /// logged and skipped (e.g. an observer outside the rp2 session) — their turns simply can't be
    /// routed through the turn transport.
    pub fn map_storm_for_user(&mut self, user: SbUserId, storm_id: StormPlayerId) {
        let Some(slot) = self.roster_slot_for_user(user) else {
            warn!("netcode v2: user {user} has no slot in the session roster; not mapping");
            return;
        };
        self.map_slot(slot, storm_id);
    }

    /// Looks up a user's rp2 slot in the session roster, if the roster names them.
    pub fn roster_slot_for_user(&self, user: SbUserId) -> Option<SlotId> {
        self.roster
            .iter()
            .find(|&&(_, u)| u == user)
            .map(|&(slot, _)| slot)
    }

    /// The `(user, storm id)` pairing for every session participant, where storm id ≡ rp2 slot.
    /// Used to write real storm ids into BW's player slots directly from the roster instead of
    /// learning them from a Storm join.
    pub fn roster_storm_ids(&self) -> Vec<(SbUserId, StormPlayerId)> {
        self.roster
            .iter()
            .map(|&(slot, user)| (user, StormPlayerId(slot.0)))
            .collect()
    }

    /// Assign the slot→storm identity map (storm id ≡ rp2 slot) for every roster slot up front,
    /// rather than learning storm ids as they solidify during a Storm join. Each mapped slot becomes
    /// `required` (a session participant the sim must have a turn from each step). The roster names
    /// every participant including ourselves, so this covers the local slot too (superseding the
    /// per-join `map_local_storm`/`map_storm_for_user` calls, which stay available for the legacy
    /// path and tests).
    pub fn populate_identity_slots(&mut self) {
        // Read the slots first so the borrow of `roster` ends before `map_slot` borrows `self` mutably.
        let slots: Vec<SlotId> = self.roster.iter().map(|&(slot, _)| slot).collect();
        for slot in slots {
            self.map_slot(slot, StormPlayerId(slot.0));
        }
    }

    /// Looks up the BW storm id for a rally-point2 slot, if mapped.
    pub fn storm_id_for_slot(&self, slot: SlotId) -> Option<StormPlayerId> {
        self.slot_to_storm.get(slot.0 as usize).copied().flatten()
    }

    /// OUT hook body: hand a fully-assembled local turn to the driver. `commands` is the native
    /// SC:R command bytes from `send_turn_message` (keep-alive + sync already baked in). `frame` is
    /// the executable-turn index for an in-game turn, or `None` for a lobby turn (the consensus
    /// coordinate the relay preserves; leave it `None` only for lobby turns).
    ///
    /// Returns `false` if the channel to the driver is closed or full (the driver died or the game
    /// stalled) — the caller decides how to surface that (stall UI / teardown). `seq` and `slot`
    /// are left zero: the driver assigns the seq and the relay binds the slot from the token.
    pub fn submit_local_turn(&mut self, commands: &[u8], frame: Option<u32>) -> bool {
        let commands = Bytes::copy_from_slice(commands);
        if self.local_only {
            // The result is decided and the link is closing (see `begin_local_only`), so send
            // nothing to the relay — but the sim still needs its own turns, so keep the local echo
            // going. There is no peer left to desync against.
            self.echo_local_turn(commands);
            return true;
        }
        let payload = Payload {
            seq: 0,
            slot: 0,
            commands: commands.clone(),
            game_frame_count: frame,
            // We never originate relay directives; the relay stamps the buffer directive onto turns
            // it forwards, so our own outbound turn carries none.
            buffer_directive: None,
        };
        match self.channels.outbound.try_send(payload) {
            Ok(()) => {
                // Only echo on a successful send: if the turn never left, executing it locally would
                // desync us from peers who never saw it (the session is tearing down at that point
                // anyway).
                self.echo_local_turn(commands);
                true
            }
            Err(_) => false,
        }
    }

    /// Queues a just-submitted local turn into our own dispatch queue and counts it in flight. The
    /// relay fans out to peers only, so this echo is the sole path by which our commands reach the
    /// local sim — and it keeps them on the same latency delay as everyone else's (lockstep requires
    /// our own commands to execute on the same turn as our peers see them).
    fn echo_local_turn(&mut self, commands: Bytes) {
        if let Some(local_storm) = self.storm_id_for_slot(self.local_slot)
            && let Some(queue) = self.inbound_queues.get_mut(local_storm.0 as usize)
        {
            queue.push_back(commands);
        }
        self.turns_in_flight = self.turns_in_flight.saturating_add(1);
    }

    /// Drains every inbound turn currently available from the driver into the per-slot queues,
    /// feeding each turn's [`BufferDirective`] to the latency tracker as it goes. Never blocks.
    /// `next_frame` is the frame the game is about to simulate.
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
        // The relay is phase-agnostic, so a hostile client can keep spraying lobby commands mid-game,
        // up to the replay log's cap. `drain_inbound` only runs in-game (via `receive_turns`), and the
        // lobby seam's own drain doesn't run once the game has started — so this is the only thing
        // still draining `lobby_in`. An undrained channel would eventually fill and wedge the driver;
        // there's nothing useful to do with a lobby command mid-game, so it's discarded.
        while self.channels.lobby_in.try_recv().is_ok() {}
    }

    /// IN-hook core: drain arrivals, then — if every required slot has a turn queued — pop exactly
    /// one turn per required slot into the owned dispatch buffers and report ready.
    ///
    /// Returns `true` when a full turn is ready to dispatch (every required slot present), `false`
    /// to stall. On a stall **nothing is consumed**, so a later call re-checks once the missing
    /// turns arrive — the caller returns 0 from `receive_storm_turns` to hold the sim (that return
    /// value is the all-players-present gate). After a `true`, read
    /// [`dispatch_buffers`](Self::dispatch_buffers) to fill `player_turns[]`, then call
    /// [`apply_due_directive`](Self::apply_due_directive).
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
    /// Valid until the next [`receive_turns`](Self::receive_turns). The IN hook writes each entry's
    /// pointer/length into `player_turns[]`/`player_turns_size[]` and sets the `0x10000 | 0x20000`
    /// present+ready flags on that slot.
    pub fn dispatch_buffers(&self) -> impl Iterator<Item = (StormPlayerId, &[u8])> {
        self.current_dispatch
            .iter()
            .enumerate()
            .filter_map(|(storm, buf)| {
                buf.as_ref()
                    .map(|b| (StormPlayerId(storm as u8), b.as_ref()))
            })
    }

    /// Latches the lobby seam on, so the OUT/IN hooks route lobby-phase command traffic through
    /// [`submit_local_lobby_turn`](Self::submit_local_lobby_turn) /
    /// [`lobby_receive_turns`](Self::lobby_receive_turns) instead of falling through to native Storm
    /// networking for the lobby. Nothing calls this outside tests yet — it's wired up by the
    /// native-lobby setup path (next slice).
    pub fn enable_lobby_seam(&mut self) {
        self.lobby_seam_enabled = true;
    }

    /// Whether the lobby seam is active (see [`enable_lobby_seam`](Self::enable_lobby_seam)).
    pub fn lobby_seam_enabled(&self) -> bool {
        self.lobby_seam_enabled
    }

    /// OUT hook body for the lobby phase: queues `buffer` into the local echo and, if it carries real
    /// command records, relays it to the other session members over the driver's lobby channel.
    /// `buffer` is the raw bytes BW's lobby flush produced — bare concatenated command records, or
    /// the single byte [`LOBBY_KEEP_ALIVE`] when nothing was queued that tick. Unlike
    /// [`submit_local_turn`](Self::submit_local_turn), nothing here strips control commands: lobby
    /// records are a different command set than in-game commands and must arrive byte-identical.
    ///
    /// Always echoes locally, keep-alives included — the local sim needs every lobby turn the same
    /// way native loopback returns our own commands through `process_lobby_commands`. A keep-alive-only
    /// buffer is never relayed to peers: the relay keeps a capped per-session replay log (1024
    /// commands / 256 KiB) for members whose stream comes up late, and forwarding a keep-alive every
    /// ~50 ms (20 Hz) would exhaust that cap in under a minute for zero information.
    ///
    /// Returns `false` only when the buffer carried real commands and the relay send failed
    /// (channel full/closed) — a lost lobby command is correctness-critical (a peer could permanently
    /// miss a slot-setup/init record). The echo has already happened by the time a `false` comes back
    /// (the game is tearing down at that point anyway).
    pub fn submit_local_lobby_turn(&mut self, buffer: &[u8]) -> bool {
        let commands = Bytes::copy_from_slice(buffer);
        self.lobby_echo.push_back(commands.clone());
        if matches!(buffer, [LOBBY_KEEP_ALIVE]) {
            return true;
        }
        self.channels.lobby_out.try_send(commands.to_vec()).is_ok()
    }

    /// Drains every `(slot, buffer)` pair currently available from the driver's `lobby_in` channel
    /// into the per-storm-slot lobby queues. Never blocks. Mirrors [`drain_inbound`](Self::drain_inbound)'s
    /// treatment of an unmapped slot: it can't be attributed to a BW player, so it's dropped rather
    /// than mis-delivered.
    fn drain_lobby_inbound(&mut self) {
        while let Ok((slot, buffer)) = self.channels.lobby_in.try_recv() {
            let Some(storm) = self.storm_id_for_slot(slot) else {
                debug_assert!(false, "lobby command for unmapped slot {slot:?}");
                continue;
            };
            if let Some(queue) = self.lobby_inbound.get_mut(storm.0 as usize) {
                queue.push_back(Bytes::from(buffer));
            }
        }
    }

    /// IN hook core for the lobby phase: drain arrivals, then — once the local echo has a queued
    /// turn — pop one buffer per required slot into the owned lobby dispatch buffers and report
    /// ready.
    ///
    /// The local echo is the pacing gate, not the readiness set: the native lobby flush produces one
    /// buffer roughly every 50 ms, so gating on it reproduces that cadence — without it this hook
    /// would free-run a turn per poll instead of waiting out the native tick. Peers never gate this
    /// way: a peer with nothing queued gets a synthesized [`LOBBY_KEEP_ALIVE`] rather than stalling
    /// the whole lobby on a quiet member.
    ///
    /// Returns `true` when a lobby turn is ready to dispatch, `false` to stall — nothing is consumed
    /// on a stall. After a `true`, read [`lobby_dispatch_buffers`](Self::lobby_dispatch_buffers) to
    /// fill `player_turns[]`.
    pub fn lobby_receive_turns(&mut self) -> bool {
        self.drain_lobby_inbound();
        let Some(local_turn) = self.lobby_echo.pop_front() else {
            // Nothing queued yet this tick: stall rather than free-run ahead of the native cadence.
            return false;
        };
        let Some(local_storm) = self.storm_id_for_slot(self.local_slot) else {
            // Setup never ran, so there's no slot to attribute this turn to. Stall rather than
            // panic, and put the turn back so the next (properly set-up) call still sees it.
            debug_assert!(false, "lobby receive with an unmapped local slot");
            self.lobby_echo.push_front(local_turn);
            return false;
        };
        for storm in 0..bw::MAX_STORM_PLAYERS {
            self.lobby_dispatch[storm] = if !self.required[storm] {
                None
            } else if storm == local_storm.0 as usize {
                Some(local_turn.clone())
            } else {
                Some(
                    self.lobby_inbound[storm]
                        .pop_front()
                        .unwrap_or_else(|| Bytes::from_static(&[LOBBY_KEEP_ALIVE])),
                )
            };
        }
        true
    }

    /// The lobby command buffers to dispatch this step: `(storm id, command bytes)` for each ready
    /// slot. Valid until the next [`lobby_receive_turns`](Self::lobby_receive_turns). Mirrors
    /// [`dispatch_buffers`](Self::dispatch_buffers) over the lobby-specific dispatch set.
    pub fn lobby_dispatch_buffers(&self) -> impl Iterator<Item = (StormPlayerId, &[u8])> {
        self.lobby_dispatch
            .iter()
            .enumerate()
            .filter_map(|(storm, buf)| {
                buf.as_ref()
                    .map(|b| (StormPlayerId(storm as u8), b.as_ref()))
            })
    }

    /// Marks a storm slot as departed: it no longer gates step readiness, and its queued and
    /// in-dispatch bytes are dropped. Called from the synced leave pass when a peer leaves/drops so
    /// the sim stops waiting on a slot that will never send another turn.
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

    /// Surfaces coordinated synced leaves due at `next_frame` as `(storm id, native leave reason)`
    /// pairs — mapping each departing slot to its storm id and dropping it from the readiness set
    /// (`mark_slot_left`) so a step gated on it can proceed. The IN hook calls this at the *top* of
    /// the receive step, before the readiness check (a due leave is what unstalls the step), then
    /// writes each returned storm's `pending_leave_reason` for the synced-leave pass to drain in the
    /// RNG window — the production twin of the debug `forceLeave` path, sourced from the relay's
    /// directive instead of a local injection.
    ///
    /// A due leave for a slot with no storm id yet (unmapped — shouldn't happen in-game; slots map at
    /// join) is warned and skipped: it can't be written into `pending_leave_reason`, and the
    /// `LeaveTracker` has already marked it surfaced so it won't retry every step.
    pub fn take_due_leaves(&mut self, next_frame: u32) -> Vec<(StormPlayerId, u32)> {
        // Drain any leaves the driver surfaced from the reliable control stream
        // into the tracker first. Leaves arrive here, off the turn path, because a
        // drop stops turn flow — so this is the channel that still delivers the
        // leave that must unstall us.
        //
        // Once local-only, the link is closing and every remote slot is already left or tracked
        // (see `begin_local_only`), so a directive arriving now is redundant — and observing it
        // is actively unsafe: a fabricated entry carries a synthetic apply frame/reason, so a real
        // directive for the same slot would conflict with it and trip the tracker's per-slot
        // consistency assert. Drain the channel so it doesn't back up, but throw the contents away.
        if self.local_only {
            while self.channels.leaves.try_recv().is_ok() {}
        } else {
            while let Ok(leave) = self.channels.leaves.try_recv() {
                self.leaves.observe(&leave);
            }
        }
        let mut out = Vec::new();
        for (slot, reason) in self.leaves.take_due(next_frame) {
            match self.storm_id_for_slot(slot) {
                Some(storm) => {
                    self.mark_slot_left(storm);
                    out.push((storm, reason));
                }
                None => warn!("netcode v2: coordinated leave for unmapped slot {slot:?}; skipping"),
            }
        }
        out
    }

    /// PIPE hook input: local turns in flight. Replaces the native `get_outstanding_turn_count`,
    /// which goes degenerate once Storm's counters stop advancing.
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

    /// Whether the session should close itself now: this game has computer players and no live
    /// remote human slot remains (every remote human has left), and it is not already local-only.
    ///
    /// A still-`required` slot other than our own is a live remote human — the readiness set holds
    /// exactly the mapped rp2 participants, and a synced leave clears one as it departs. When the
    /// last of them is gone, a game with AI can keep going versus the computers with no peer to stay
    /// in lockstep with, so there is no reason to keep the relay session open: the caller latches
    /// [`begin_local_only`](Self::begin_local_only) to continue entirely locally and close the link.
    ///
    /// The computers gate is load-bearing, not cosmetic. In a human-only game, running out of remote
    /// humans means the local player is the winner and its result report is imminent; closing the
    /// session first would send the leave intent ahead of that report and drop it. A human-only game
    /// therefore never self-closes here — it ends through the victory-dialog path instead, which
    /// reports the result before closing.
    pub fn should_self_close(&self) -> bool {
        if !self.has_computers || self.local_only {
            return false;
        }
        let local_storm = self
            .storm_id_for_slot(self.local_slot)
            .map(|s| s.0 as usize);
        let remote_human_remains = (0..bw::MAX_STORM_PLAYERS)
            .any(|storm| self.required[storm] && Some(storm) != local_storm);
        !remote_human_remains
    }

    /// Ends the networked session for a locally-decided game, transitioning to local-only play.
    /// Idempotent: the second call is a no-op.
    ///
    /// Once the local result is settled, keeping the game networked is a liability — a later
    /// simulation divergence would surface as relay desync events against a game whose outcome is
    /// already fixed. This severs the link cleanly: it fabricates a "player left" leave for every
    /// remote slot still live and not already tracked, and routes each through the same
    /// [`LeaveTracker`] the relay's own directives flow through (marked due immediately, so the next
    /// [`take_due_leaves`](Self::take_due_leaves) surfaces it and the IN hook applies it in the
    /// deterministic synced-leave window — the identical path a relay-directed leave takes). Then it
    /// flips into local-only mode so [`submit_local_turn`](Self::submit_local_turn) stops sending,
    /// and signals the clean leave to the driver.
    ///
    /// Order matters: the local-only flag is set before signaling the leave, so no further datagram
    /// can queue behind the announcement and the driver's outbound drain completes at once.
    pub fn begin_local_only(&mut self) {
        if self.local_only {
            return;
        }
        self.local_only = true;

        for slot_idx in 0..bw::MAX_STORM_PLAYERS {
            // Our own slot keeps feeding the sim; only remote participants are dropped.
            if slot_idx == self.local_slot.0 as usize {
                continue;
            }
            let Some(storm) = self.slot_to_storm[slot_idx] else {
                continue; // unmapped: not a routed participant, nothing to leave
            };
            // A slot already dropped from `required` has left; re-leaving it would double-apply the
            // native leave. Only slots still gating the step are live and need a fabricated leave.
            if !self
                .required
                .get(storm.0 as usize)
                .copied()
                .unwrap_or(false)
            {
                continue;
            }
            // A real relay directive may already be tracked for this slot (observed, but not yet
            // due) — a team-victory co-winner's own clean leave arriving while ours is in flight.
            // It carries the authoritative apply frame/reason and will surface on its own; fabricating
            // a second entry for the same slot would conflict with it (different apply frame/reason)
            // and trip the tracker's per-slot consistency check.
            if self.leaves.contains(slot_idx as u32) {
                continue;
            }
            self.leaves.observe(&LeaveDirective {
                slot: slot_idx as u32,
                reason: LOCAL_ONLY_LEAVE_REASON,
                // Due at any frame, so the very next `take_due_leaves` surfaces it.
                apply_at_frame: 0,
                leave_seq: 0,
            });
        }

        self.send_leave_intent();
    }

    /// Tells the driver this client will never produce another turn — the game loop just
    /// returned, whether because the local player quit (F10) or the game ended naturally. The
    /// driver holds the actual announcement until every turn we've produced has been sent and
    /// acked, then writes it to the relay, so surviving players get a prompt synced leave with
    /// the "player left" reason instead of waiting out the idle-timeout "dropped" path. A crash
    /// or hard kill never reaches this call, which is correct: those still need the relay's
    /// link-death detection to notice the drop.
    ///
    /// Safe to call more than once, though only the first call does anything: the driver latches
    /// a single signal. A repeat finds the channel already holding it (`Full`) or the driver
    /// already gone (`Closed`); both are expected outcomes here, not failures, so they're logged
    /// at debug level and otherwise ignored — a stray extra call changes nothing either way.
    pub fn send_leave_intent(&mut self) {
        match self.channels.leave_intent.try_send(()) {
            Ok(()) => debug!("netcode v2: announced clean leave to relay"),
            Err(mpsc::error::TrySendError::Full(())) => {
                debug!("netcode v2: leave intent already signaled; ignoring repeat call")
            }
            Err(mpsc::error::TrySendError::Closed(())) => {
                debug!("netcode v2: leave-intent channel closed; driver already gone")
            }
        }
    }

    /// Latches the result-expected flag the driver reads to hold a pending leave intent until the
    /// end-of-game result report has been sent — guaranteeing the result frame precedes the leave
    /// intent on the wire. Set from the game thread before any leave intent can be signalled. A
    /// plain relaxed store, so it's cheap and idempotent.
    pub fn expect_result_report(&self) {
        self.channels.result_expected.store(true, Ordering::Relaxed);
    }

    /// Hands the serialized end-of-game result report to the driver, which sends it up the relay's
    /// reliable control stream ahead of any leave intent. `try_send` is enough: the channel holds a
    /// single report and at most one is produced per game. A full or closed channel (a duplicate
    /// report, or a dead/absent link) is warned and the report dropped — best-effort, and harmless
    /// because a v2 game with no live relay has no result to deliver there anyway.
    pub fn submit_result_report(&self, report: Vec<u8>) {
        match self.channels.result.try_send(report) {
            Ok(()) => debug!("netcode v2: handed result report to driver"),
            Err(e) => warn!("netcode v2: dropping result report, channel unavailable: {e}"),
        }
    }

    /// Queues a slot for a forced synced leave, for the `forceLeave` debug-control command. The
    /// game thread drains this on its next receive (see `bw_scr::apply_forced_leaves`); nothing is
    /// applied here, so this is safe to call from the async side.
    #[cfg(debug_assertions)]
    pub fn debug_force_leave(&mut self, slot: SlotId) {
        self.forced_leaves.push(slot);
    }

    /// Drains the slots queued by [`debug_force_leave`](Self::debug_force_leave), in queue order.
    /// Called once per receive on the game thread.
    #[cfg(debug_assertions)]
    pub fn take_forced_leaves(&mut self) -> Vec<SlotId> {
        std::mem::take(&mut self.forced_leaves)
    }

    /// Arms a one-shot mineral perturbation for the `forceDesync` debug-control command. The game
    /// thread drains this on its next receive (see `bw_scr::apply_forced_desync`); nothing is
    /// applied here, so this is safe to call from the async side.
    #[cfg(debug_assertions)]
    pub fn debug_force_desync(&mut self) {
        self.forced_desync = true;
    }

    /// Consumes the flag armed by [`debug_force_desync`](Self::debug_force_desync), returning whether
    /// a perturbation is pending. Called once per receive on the game thread.
    #[cfg(debug_assertions)]
    pub fn take_forced_desync(&mut self) -> bool {
        std::mem::take(&mut self.forced_desync)
    }

    /// A point-in-time read of this turn state, for the `queryState` debug-control command. Pure
    /// read: touches no counters, drains no queues.
    #[cfg(debug_assertions)]
    pub fn debug_snapshot(&self) -> crate::debug_control::TurnStateSnapshot {
        use crate::debug_control::TurnSlotSnapshot;

        let slots = self
            .roster
            .iter()
            .map(|&(slot, user_id)| match self.storm_id_for_slot(slot) {
                Some(storm) => {
                    // `map_slot` tolerates a storm id the fixed-size arrays can't track (it skips
                    // via `get_mut`), so a diagnostic read must degrade the same way, not panic.
                    let storm = storm.0 as usize;
                    TurnSlotSnapshot {
                        slot: slot.0,
                        user_id,
                        storm_id: Some(storm as u8),
                        required: self.required.get(storm).copied().unwrap_or(false),
                        queued_turns: self.inbound_queues.get(storm).map_or(0, |q| q.len()),
                        has_dispatch: self
                            .current_dispatch
                            .get(storm)
                            .is_some_and(|d| d.is_some()),
                    }
                }
                None => TurnSlotSnapshot {
                    slot: slot.0,
                    user_id,
                    storm_id: None,
                    required: false,
                    queued_turns: 0,
                    has_dispatch: false,
                },
            })
            .collect();

        crate::debug_control::TurnStateSnapshot {
            local_slot: self.local_slot.0,
            latency_turns: self.latency_turns,
            outstanding_turns: self.turns_in_flight,
            slots,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    use rally_point_client::TurnChannels;
    use rally_point_client::proto::messages::{BufferDirective, LeaveDirective};
    use tokio::sync::mpsc;

    use super::*;

    const LOCAL_SLOT: SlotId = SlotId(0);
    const PEER_SLOT: SlotId = SlotId(1);
    const LOCAL_STORM: StormPlayerId = StormPlayerId(3);
    const PEER_STORM: StormPlayerId = StormPlayerId(5);

    const LOCAL_USER: SbUserId = SbUserId(11);
    const PEER_USER: SbUserId = SbUserId(22);

    /// The harness tuple [`turn_state`]/[`turn_state_with_computers`]/[`turn_state_inner`] return:
    /// the state, a sender to inject peer turns on `inbound`, the outbound receiver to
    /// observe/keep-alive what we submit, a sender to inject relay-pushed leaves on the `leaves`
    /// channel, the far-end receiver of the `leave_intent` channel so tests can assert on what
    /// [`TurnState::send_leave_intent`] signals, the far-end receiver of `lobby_out` so tests can
    /// observe what [`TurnState::submit_local_lobby_turn`] relays, and the far-end sender of
    /// `lobby_in` so tests can inject peer lobby commands.
    type TurnStateHarness = (
        TurnState,
        mpsc::Sender<Payload>,
        mpsc::Receiver<Payload>,
        mpsc::Sender<LeaveDirective>,
        mpsc::Receiver<()>,
        mpsc::Receiver<Vec<u8>>,
        mpsc::Sender<(SlotId, Vec<u8>)>,
    );

    /// Builds a TurnState wired to test channels (see [`TurnStateHarness`]). All far ends are
    /// returned so the channels stay open (dropping them would close the turn state's ends).
    fn turn_state() -> TurnStateHarness {
        turn_state_inner(false)
    }

    /// Like [`turn_state`], but for a game that contains computer (AI) players — the case that
    /// self-closes its session once the last remote human leaves.
    fn turn_state_with_computers() -> TurnStateHarness {
        turn_state_inner(true)
    }

    fn turn_state_inner(has_computers: bool) -> TurnStateHarness {
        let (out_tx, out_rx) = mpsc::channel(16);
        let (in_tx, in_rx) = mpsc::channel(16);
        let (leave_tx, leave_rx) = mpsc::channel(16);
        let (leave_intent_tx, leave_intent_rx) = mpsc::channel(1);
        // The result channel/latch aren't exercised by these tests; drop the receiver (closing the
        // channel is harmless — nothing submits a report here). See `turn_state_with_result` for
        // the result-handoff tests.
        let (result_tx, _result_rx) = mpsc::channel(1);
        let (lobby_out_tx, lobby_out_rx) = mpsc::channel(16);
        let (lobby_in_tx, lobby_in_rx) = mpsc::channel(16);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
        };
        let roster = vec![(LOCAL_SLOT, LOCAL_USER), (PEER_SLOT, PEER_USER)];
        (
            TurnState::new(channels, LOCAL_SLOT, 2, roster, has_computers),
            in_tx,
            out_rx,
            leave_tx,
            leave_intent_rx,
            lobby_out_rx,
            lobby_in_tx,
        )
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

    fn leave_directive(slot: SlotId, apply_at_frame: u32, reason: u32) -> LeaveDirective {
        LeaveDirective {
            slot: slot.0 as u32,
            reason,
            apply_at_frame,
            leave_seq: 1,
        }
    }

    fn dispatched(state: &TurnState) -> Vec<(StormPlayerId, Vec<u8>)> {
        state
            .dispatch_buffers()
            .map(|(storm, bytes)| (storm, bytes.to_vec()))
            .collect()
    }

    fn lobby_dispatched(state: &TurnState) -> Vec<(StormPlayerId, Vec<u8>)> {
        state
            .lobby_dispatch_buffers()
            .map(|(storm, bytes)| (storm, bytes.to_vec()))
            .collect()
    }

    #[test]
    fn storm_net_key_is_deterministic_and_unique_per_member() {
        // Deterministic: the same (slot, user) always produces the same key.
        assert_eq!(
            storm_net_key(2, SbUserId(0x1234)),
            storm_net_key(2, SbUserId(0x1234))
        );

        // Distinct members produce distinct keys, whether they differ by slot, by user, or both.
        let a = storm_net_key(0, SbUserId(11));
        let b = storm_net_key(1, SbUserId(11));
        let c = storm_net_key(0, SbUserId(22));
        let d = storm_net_key(1, SbUserId(22));
        let keys = [a, b, c, d];
        for i in 0..keys.len() {
            for j in (i + 1)..keys.len() {
                assert_ne!(keys[i], keys[j], "keys {i} and {j} collided");
            }
        }

        // Layout: "SB" + slot + 0, then the user id little-endian, then zero padding.
        assert_eq!(
            storm_net_key(3, SbUserId(0x0A0B_0C0D)),
            [b'S', b'B', 3, 0, 0x0D, 0x0C, 0x0B, 0x0A, 0, 0, 0, 0]
        );
    }

    #[test]
    fn initial_latency_is_floored_at_one() {
        let (out_tx, out_rx) = mpsc::channel(1);
        let (_in_tx, in_rx) = mpsc::channel(1);
        let (_leave_tx, leave_rx) = mpsc::channel(1);
        let (leave_intent_tx, _leave_intent_rx) = mpsc::channel(1);
        let (result_tx, _result_rx) = mpsc::channel(1);
        let (lobby_out_tx, _lobby_out_rx) = mpsc::channel(1);
        let (_lobby_in_tx, lobby_in_rx) = mpsc::channel(1);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
        };
        let state = TurnState::new(channels, LOCAL_SLOT, 0, Vec::new(), false);
        assert_eq!(state.latency_turns(), 1);
        drop(out_rx);
    }

    #[test]
    fn roster_maps_a_peers_slot_by_user() {
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        // A peer's storm id solidifies during join; the roster resolves their user to their slot.
        state.map_storm_for_user(PEER_USER, PEER_STORM);

        in_tx.try_send(peer_turn(PEER_SLOT, b"peer")).unwrap();
        assert!(
            state.receive_turns(0),
            "mapped peer slot should gate + dispatch"
        );
        assert_eq!(dispatched(&state), vec![(PEER_STORM, b"peer".to_vec())]);
    }

    #[test]
    fn populate_identity_slots_maps_every_roster_slot_to_its_own_id() {
        // storm id ≡ rp2 slot. After populating identity, every roster slot resolves to a storm id
        // equal to its own slot number, is `required`, and routes its turns without any per-join
        // mapping call.
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.populate_identity_slots();

        // Both roster slots (local 0, peer 1) now map to their own ids as storm ids.
        assert_eq!(state.storm_id_for_slot(LOCAL_SLOT), Some(StormPlayerId(0)));
        assert_eq!(state.storm_id_for_slot(PEER_SLOT), Some(StormPlayerId(1)));

        // The peer's turns route through its identity storm id, and both slots gate readiness.
        in_tx.try_send(peer_turn(PEER_SLOT, b"peer")).unwrap();
        assert!(
            !state.receive_turns(0),
            "the local slot is required but hasn't submitted a turn yet"
        );
        assert!(state.submit_local_turn(b"local", Some(0)));
        assert!(state.receive_turns(0), "both identity slots present");
        let mut got = dispatched(&state);
        got.sort_by_key(|(storm, _)| storm.0);
        assert_eq!(
            got,
            vec![
                (StormPlayerId(0), b"local".to_vec()),
                (StormPlayerId(1), b"peer".to_vec()),
            ]
        );
    }

    #[test]
    fn roster_storm_ids_pairs_each_user_with_its_slot_as_storm_id() {
        let (state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        let mut ids = state.roster_storm_ids();
        ids.sort_by_key(|(user, _)| user.0);
        assert_eq!(
            ids,
            vec![
                (LOCAL_USER, StormPlayerId(LOCAL_SLOT.0)),
                (PEER_USER, StormPlayerId(PEER_SLOT.0)),
            ]
        );
    }

    #[test]
    fn user_missing_from_roster_is_skipped_not_mapped() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_storm_for_user(SbUserId(99), PEER_STORM);
        // No mapping was recorded: the slot doesn't gate readiness...
        assert!(
            state.receive_turns(0),
            "unmapped slot must not stall the step"
        );
        // ...and no storm id was attached to any roster slot.
        assert_eq!(state.storm_id_for_slot(PEER_SLOT), None);
        assert_eq!(state.storm_id_for_slot(LOCAL_SLOT), None);
    }

    #[test]
    fn not_ready_until_every_required_slot_has_a_turn() {
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // Only the peer turn has arrived; our own local turn hasn't been submitted yet.
        in_tx.try_send(peer_turn(PEER_SLOT, b"peer")).unwrap();
        assert!(
            !state.receive_turns(0),
            "should stall with a required slot missing"
        );
        // A stall consumes nothing, so the peer turn is still queued for the next check.

        assert!(
            state.submit_local_turn(b"local", Some(0)),
            "submit should succeed while the driver end is open"
        );
        assert!(
            state.receive_turns(0),
            "ready once both required slots have a turn"
        );

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
        let (
            mut state,
            _in_tx,
            mut out_rx,
            _leave_tx,
            _leave_intent_rx,
            _lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();
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
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
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
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
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
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
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
    fn debug_snapshot_reflects_mapped_and_unmapped_slots() {
        use crate::debug_control::TurnSlotSnapshot;

        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        // PEER_SLOT is left unmapped on purpose, to exercise the "no storm id yet" branch.

        assert!(state.submit_local_turn(b"local", Some(0)));
        // Peer slot isn't required (unmapped), so this is ready and dispatches immediately.
        assert!(state.receive_turns(0));

        let snapshot = state.debug_snapshot();
        assert_eq!(snapshot.local_slot, LOCAL_SLOT.0);
        assert_eq!(snapshot.latency_turns, 2);
        assert_eq!(snapshot.outstanding_turns, 1);

        let mut slots = snapshot.slots.clone();
        slots.sort_by_key(|s| s.slot);
        assert_eq!(
            slots,
            vec![
                TurnSlotSnapshot {
                    slot: LOCAL_SLOT.0,
                    user_id: LOCAL_USER,
                    storm_id: Some(LOCAL_STORM.0),
                    required: true,
                    queued_turns: 0,
                    has_dispatch: true,
                },
                TurnSlotSnapshot {
                    slot: PEER_SLOT.0,
                    user_id: PEER_USER,
                    storm_id: None,
                    required: false,
                    queued_turns: 0,
                    has_dispatch: false,
                },
            ]
        );

        // Map the peer, queue up an extra turn behind the one that'll dispatch, and confirm the
        // queue depth and required flag both show up.
        state.map_slot(PEER_SLOT, PEER_STORM);
        in_tx.try_send(peer_turn(PEER_SLOT, b"t1")).unwrap();
        in_tx.try_send(peer_turn(PEER_SLOT, b"t2")).unwrap();
        assert!(state.submit_local_turn(b"local2", Some(1)));
        assert!(state.receive_turns(1));

        let snapshot = state.debug_snapshot();
        let peer = snapshot
            .slots
            .iter()
            .find(|s| s.slot == PEER_SLOT.0)
            .expect("peer slot present");
        assert_eq!(peer.storm_id, Some(PEER_STORM.0));
        assert!(peer.required);
        assert_eq!(
            peer.queued_turns, 1,
            "one turn dispatched, one still queued"
        );
        assert!(peer.has_dispatch);

        // A synced leave clears the required flag; the snapshot should reflect it immediately.
        state.mark_slot_left(PEER_STORM);
        let snapshot = state.debug_snapshot();
        let peer = snapshot
            .slots
            .iter()
            .find(|s| s.slot == PEER_SLOT.0)
            .expect("peer slot present");
        assert!(!peer.required);
        assert_eq!(peer.queued_turns, 0);
        assert!(!peer.has_dispatch);
    }

    #[test]
    fn forced_leaves_drain_in_order_then_empty() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.debug_force_leave(PEER_SLOT);
        state.debug_force_leave(LOCAL_SLOT);

        assert_eq!(state.take_forced_leaves(), vec![PEER_SLOT, LOCAL_SLOT]);
        // A second drain finds nothing: `take` left the queue empty.
        assert!(state.take_forced_leaves().is_empty());
    }

    #[test]
    fn pipe_counter_tracks_local_turns_in_flight() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);

        assert_eq!(state.outstanding_turns(), 0);
        state.submit_local_turn(b"a", Some(0));
        state.submit_local_turn(b"b", Some(1));
        assert_eq!(state.outstanding_turns(), 2);
        state.mark_local_turn_executed();
        assert_eq!(state.outstanding_turns(), 1);
    }

    #[test]
    fn send_leave_intent_delivers_one_signal_and_a_repeat_is_a_harmless_no_op() {
        let (
            mut state,
            _in_tx,
            _out_rx,
            _leave_tx,
            mut leave_intent_rx,
            _lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();

        // Two calls before the driver ever drains the channel: its capacity is 1, so the second
        // finds the first signal still sitting there (`Full`) rather than queuing a second one.
        // Neither call should panic.
        state.send_leave_intent();
        state.send_leave_intent();

        // Exactly one signal reaches the far end...
        assert_eq!(
            leave_intent_rx.try_recv(),
            Ok(()),
            "the driver sees exactly one signal"
        );
        // ...and there is no second one queued behind it.
        assert!(
            leave_intent_rx.try_recv().is_err(),
            "the repeat call must not have delivered a second signal"
        );
    }

    const DROPPED: u32 = 0x4000_0006;

    #[test]
    fn take_due_leaves_maps_slot_to_storm_marks_left_at_its_frame() {
        let (mut state, _in_tx, _out_rx, leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // The relay pushes the peer's leave down the control stream, due at frame 5.
        leave_tx
            .try_send(leave_directive(PEER_SLOT, 5, DROPPED))
            .unwrap();

        // take_due_leaves drains the control-stream channel into the tracker, then surfaces due ones.
        assert!(
            state.take_due_leaves(4).is_empty(),
            "not due before its apply frame"
        );
        assert_eq!(
            state.take_due_leaves(5),
            vec![(PEER_STORM, DROPPED)],
            "due at its frame: mapped to storm id, with the directive's reason"
        );
        // The leave dropped the peer from the readiness set, so a later step is ready without it.
        assert!(state.submit_local_turn(b"local2", Some(5)));
        assert!(
            state.receive_turns(5),
            "the left peer no longer gates readiness"
        );
        assert_eq!(dispatched(&state), vec![(LOCAL_STORM, b"local2".to_vec())]);
    }

    #[test]
    fn begin_local_only_fabricates_leaves_for_live_remote_slots() {
        let (
            mut state,
            _in_tx,
            _out_rx,
            _leave_tx,
            mut leave_intent_rx,
            _lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        state.begin_local_only();

        // The remote peer's leave surfaces through the normal application path, due immediately,
        // with the clean "player left" reason — and the local slot is never fabricated a leave.
        assert_eq!(
            state.take_due_leaves(0),
            vec![(PEER_STORM, LOCAL_ONLY_LEAVE_REASON)]
        );
        // Surfacing it marked the peer left, so it no longer gates readiness: the sim proceeds on
        // the local turn alone.
        assert!(state.submit_local_turn(b"solo", Some(0)));
        assert!(
            state.receive_turns(0),
            "sim proceeds on the local turn alone"
        );
        assert_eq!(dispatched(&state), vec![(LOCAL_STORM, b"solo".to_vec())]);

        // Local-only also announced the clean leave to the driver.
        assert_eq!(leave_intent_rx.try_recv(), Ok(()));
    }

    #[test]
    fn begin_local_only_skips_already_left_slots() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);
        // The peer already departed (e.g. an earlier relay leave), clearing it from `required`.
        state.mark_slot_left(PEER_STORM);

        state.begin_local_only();

        // Its only remote slot was already gone, so nothing is fabricated and no leave is
        // re-applied.
        assert!(state.take_due_leaves(0).is_empty());
    }

    #[test]
    fn begin_local_only_is_idempotent() {
        let (
            mut state,
            _in_tx,
            _out_rx,
            _leave_tx,
            mut leave_intent_rx,
            _lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        state.begin_local_only();
        // The second call runs before the fabricated leave is even drained: it must fabricate
        // nothing more and must not re-signal the driver.
        state.begin_local_only();

        // The peer leave still surfaces exactly once, not twice.
        assert_eq!(
            state.take_due_leaves(0),
            vec![(PEER_STORM, LOCAL_ONLY_LEAVE_REASON)]
        );
        assert!(state.take_due_leaves(0).is_empty());

        // And only a single clean-leave signal reached the driver.
        assert_eq!(leave_intent_rx.try_recv(), Ok(()));
        assert!(leave_intent_rx.try_recv().is_err());
    }

    #[test]
    fn submit_local_turn_echoes_but_does_not_send_after_local_only() {
        let (
            mut state,
            _in_tx,
            mut out_rx,
            _leave_tx,
            _leave_intent_rx,
            _lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        // PEER_SLOT is left unmapped, so local-only fabricates no peer leave here — this test is
        // about the local submit path, not the fabrication.

        state.begin_local_only();

        assert!(
            state.submit_local_turn(b"local", Some(9)),
            "local echo still succeeds in local-only mode"
        );
        // Nothing was handed to the driver: the link is closing.
        assert!(
            out_rx.try_recv().is_err(),
            "no turn should reach the relay in local-only mode"
        );
        // But it's queued for local dispatch and counted in flight, so the sim keeps stepping.
        assert_eq!(state.outstanding_turns(), 1);
        assert!(state.receive_turns(9));
        assert_eq!(dispatched(&state), vec![(LOCAL_STORM, b"local".to_vec())]);
    }

    #[test]
    fn begin_local_only_defers_to_an_already_tracked_real_directive() {
        let (mut state, _in_tx, _out_rx, leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // The relay already pushed the peer's real leave, due in the future — tracked but not yet
        // surfaced. This is the team-victory shape: a co-winner's own clean leave lands on our
        // control stream while our own leave intent is still in flight.
        leave_tx
            .try_send(leave_directive(PEER_SLOT, 10, DROPPED))
            .unwrap();
        assert!(
            state.take_due_leaves(5).is_empty(),
            "not due yet, but now tracked"
        );

        // Fabricating a second, conflicting entry (different apply frame/reason) for the same slot
        // would trip LeaveTracker's per-slot consistency debug_assert; begin_local_only must see
        // it's already tracked and leave it alone.
        state.begin_local_only();

        // The real directive still surfaces on its own schedule, with its own reason — not the
        // fabricated one — and exactly once.
        assert_eq!(state.take_due_leaves(10), vec![(PEER_STORM, DROPPED)]);
        assert!(state.take_due_leaves(10).is_empty());
    }

    #[test]
    fn a_real_directive_after_local_only_is_discarded_not_observed() {
        let (mut state, _in_tx, _out_rx, leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        state.begin_local_only();

        // A real relay directive for the same slot arrives after the fabrication, carrying a
        // different apply frame/reason than the fabricated one — the kind of mismatch that would
        // trip LeaveTracker's per-slot consistency assert if it were observed.
        leave_tx
            .try_send(leave_directive(PEER_SLOT, 50, DROPPED))
            .unwrap();

        // The fabricated leave surfaces exactly once; the real directive was discarded rather than
        // observed, so it neither panics nor re-opens/duplicates the slot's leave.
        assert_eq!(
            state.take_due_leaves(0),
            vec![(PEER_STORM, LOCAL_ONLY_LEAVE_REASON)]
        );
        assert!(state.take_due_leaves(50).is_empty());
    }

    #[test]
    fn take_due_leaves_skips_an_unmapped_departing_slot() {
        let (mut state, _in_tx, _out_rx, leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);
        let unmapped = SlotId(9); // never mapped to a storm id

        leave_tx
            .try_send(leave_directive(unmapped, 3, DROPPED))
            .unwrap();

        // A leave for a slot with no storm id can't be written into pending_leave_reason: skipped,
        // not returned, and not retried (the tracker already marked it surfaced).
        assert!(state.take_due_leaves(3).is_empty());
        assert!(state.take_due_leaves(4).is_empty());
    }

    #[test]
    fn self_close_triggers_when_last_remote_human_leaves_with_computers() {
        let (
            mut state,
            _in_tx,
            mut out_rx,
            leave_tx,
            mut leave_intent_rx,
            _lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state_with_computers();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // While a remote human is still live, the session stays open.
        assert!(
            !state.should_self_close(),
            "not alone: the peer is still here"
        );

        // The remote human leaves (relay-directed synced leave applies at frame 5).
        leave_tx
            .try_send(leave_directive(PEER_SLOT, 5, DROPPED))
            .unwrap();
        assert_eq!(state.take_due_leaves(5), vec![(PEER_STORM, DROPPED)]);

        // Now alone with the computers: the session should close itself. Drive the same sequence
        // the IN hook does — check the predicate, then latch local-only.
        assert!(state.should_self_close(), "last human left, AI remains");
        state.begin_local_only();

        // Latching local-only announced the clean leave to the driver...
        assert_eq!(leave_intent_rx.try_recv(), Ok(()));
        // ...and stopped handing our turns to the (closing) link, while still echoing locally so the
        // sim plays on versus the AI.
        assert!(state.submit_local_turn(b"solo", Some(6)));
        assert!(
            out_rx.try_recv().is_err(),
            "no turn reaches the relay once local-only"
        );
        assert!(
            state.receive_turns(6),
            "sim proceeds on the local turn alone"
        );
        assert_eq!(dispatched(&state), vec![(LOCAL_STORM, b"solo".to_vec())]);
    }

    #[test]
    fn self_close_does_not_trigger_without_computers() {
        // Same roster and departure, but a human-only game: closing here would race the winner's
        // result report, so the predicate must stay false and leave the victory-dialog path to it.
        let (mut state, _in_tx, _out_rx, leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        leave_tx
            .try_send(leave_directive(PEER_SLOT, 5, DROPPED))
            .unwrap();
        assert_eq!(state.take_due_leaves(5), vec![(PEER_STORM, DROPPED)]);

        assert!(
            !state.should_self_close(),
            "human-only games never self-close, even when alone"
        );
    }

    #[test]
    fn self_close_does_not_trigger_while_a_remote_human_remains() {
        // A computers game, but the remote human hasn't left: the session stays networked.
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state_with_computers();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        assert!(
            !state.should_self_close(),
            "a live remote human keeps the session open"
        );
    }

    #[test]
    fn self_close_is_idempotent_once_local_only() {
        let (mut state, _in_tx, _out_rx, leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state_with_computers();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        leave_tx
            .try_send(leave_directive(PEER_SLOT, 5, DROPPED))
            .unwrap();
        assert_eq!(state.take_due_leaves(5), vec![(PEER_STORM, DROPPED)]);
        assert!(state.should_self_close());

        // Once closed, the predicate stops firing so the IN hook won't re-latch every step.
        state.begin_local_only();
        assert!(
            !state.should_self_close(),
            "already local-only: nothing left to close"
        );
    }

    /// A TurnState wired so the result path is observable: returns the state, the receiver of the
    /// result channel (to see what a submit hands the driver), and a clone of the shared
    /// `result_expected` latch (to see what `expect_result_report` sets). The non-result far ends
    /// are dropped — these tests never exercise the turn/leave paths.
    fn turn_state_with_result() -> (TurnState, mpsc::Receiver<Vec<u8>>, Arc<AtomicBool>) {
        let (out_tx, _out_rx) = mpsc::channel(1);
        let (_in_tx, in_rx) = mpsc::channel(1);
        let (_leave_tx, leave_rx) = mpsc::channel(1);
        let (leave_intent_tx, _leave_intent_rx) = mpsc::channel(1);
        let (result_tx, result_rx) = mpsc::channel(1);
        let result_expected = Arc::new(AtomicBool::new(false));
        let (lobby_out_tx, _lobby_out_rx) = mpsc::channel(1);
        let (_lobby_in_tx, lobby_in_rx) = mpsc::channel(1);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::clone(&result_expected),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
        };
        let state = TurnState::new(channels, LOCAL_SLOT, 2, Vec::new(), false);
        (state, result_rx, result_expected)
    }

    #[test]
    fn expect_result_report_sets_the_shared_latch() {
        let (state, _result_rx, result_expected) = turn_state_with_result();
        assert!(
            !result_expected.load(Ordering::Relaxed),
            "not latched until asked"
        );

        state.expect_result_report();
        assert!(
            result_expected.load(Ordering::Relaxed),
            "latch flips so the driver holds the leave intent for the result"
        );

        // Idempotent: a repeat call leaves it set.
        state.expect_result_report();
        assert!(result_expected.load(Ordering::Relaxed));
    }

    #[test]
    fn submit_result_report_hands_bytes_to_the_driver() {
        let (state, mut result_rx, _result_expected) = turn_state_with_result();

        state.submit_result_report(b"report".to_vec());
        assert_eq!(
            result_rx.try_recv().expect("report handed to the driver"),
            b"report".to_vec()
        );
        // Nothing else queued behind the single report.
        assert!(result_rx.try_recv().is_err());
    }

    #[test]
    fn lobby_seam_latch_defaults_off_and_enable_flips_it() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        assert!(!state.lobby_seam_enabled(), "off until asked");
        state.enable_lobby_seam();
        assert!(state.lobby_seam_enabled());
    }

    #[test]
    fn lobby_keep_alive_only_buffer_is_echoed_but_never_relayed() {
        let (
            mut state,
            _in_tx,
            _out_rx,
            _leave_tx,
            _leave_intent_rx,
            mut lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);

        assert!(state.submit_local_lobby_turn(&[LOBBY_KEEP_ALIVE]));
        // Forwarding a keep-alive would exhaust the relay's capped replay log for zero information,
        // so nothing goes out over `lobby_out`.
        assert!(
            lobby_out_rx.try_recv().is_err(),
            "a keep-alive-only buffer must never be relayed"
        );

        // But it's still echoed, so the local lobby dispatch sees it — mirroring native loopback.
        assert!(state.lobby_receive_turns());
        assert_eq!(
            lobby_dispatched(&state),
            vec![(LOCAL_STORM, vec![LOBBY_KEEP_ALIVE])]
        );
    }

    #[test]
    fn lobby_content_buffer_is_relayed_verbatim_and_echoed() {
        let (
            mut state,
            _in_tx,
            _out_rx,
            _leave_tx,
            _leave_intent_rx,
            mut lobby_out_rx,
            _lobby_in_tx,
        ) = turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);

        assert!(state.submit_local_lobby_turn(b"slotinit"));
        assert_eq!(
            lobby_out_rx.try_recv().expect("relayed to the driver"),
            b"slotinit".to_vec()
        );

        assert!(state.lobby_receive_turns());
        assert_eq!(
            lobby_dispatched(&state),
            vec![(LOCAL_STORM, b"slotinit".to_vec())]
        );
    }

    #[test]
    fn lobby_receive_turns_gates_on_the_local_echo_and_synthesizes_a_peer_keep_alive() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, _lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        assert!(
            !state.lobby_receive_turns(),
            "stalls until the local flush produces a turn"
        );

        assert!(state.submit_local_lobby_turn(b"hello"));
        assert!(state.lobby_receive_turns());

        let mut got = lobby_dispatched(&state);
        got.sort_by_key(|(storm, _)| storm.0);
        assert_eq!(
            got,
            vec![
                (LOCAL_STORM, b"hello".to_vec()),
                (PEER_STORM, vec![LOBBY_KEEP_ALIVE]),
            ],
            "a required peer with nothing queued gets a synthesized keep-alive"
        );
    }

    #[test]
    fn a_peer_lobby_command_takes_precedence_over_the_synthesized_keep_alive() {
        let (mut state, _in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        lobby_in_tx
            .try_send((PEER_SLOT, b"peerslot".to_vec()))
            .unwrap();
        assert!(state.submit_local_lobby_turn(b"localslot"));
        assert!(state.lobby_receive_turns());

        let mut got = lobby_dispatched(&state);
        got.sort_by_key(|(storm, _)| storm.0);
        assert_eq!(
            got,
            vec![
                (LOCAL_STORM, b"localslot".to_vec()),
                (PEER_STORM, b"peerslot".to_vec()),
            ],
            "the peer's real command dispatches instead of a synthesized keep-alive"
        );
    }

    #[test]
    fn in_game_receive_discards_lobby_in_traffic_without_affecting_dispatch() {
        let (mut state, in_tx, _out_rx, _leave_tx, _leave_intent_rx, _lobby_out_rx, lobby_in_tx) =
            turn_state();
        state.map_slot(LOCAL_SLOT, LOCAL_STORM);
        state.map_slot(PEER_SLOT, PEER_STORM);

        // Fill the lobby_in channel to its test capacity (16, see `turn_state_inner`) with a
        // hostile or just-late peer's lobby traffic sprayed mid-game.
        for _ in 0..16 {
            lobby_in_tx
                .try_send((PEER_SLOT, b"late lobby command".to_vec()))
                .unwrap();
        }

        in_tx.try_send(peer_turn(PEER_SLOT, b"peer")).unwrap();
        assert!(state.submit_local_turn(b"local", Some(0)));
        assert!(
            state.receive_turns(0),
            "normal in-game turn dispatch is unaffected by the lobby traffic"
        );
        let mut got = dispatched(&state);
        got.sort_by_key(|(storm, _)| storm.0);
        assert_eq!(
            got,
            vec![
                (LOCAL_STORM, b"local".to_vec()),
                (PEER_STORM, b"peer".to_vec()),
            ]
        );

        // The full lobby_in channel was drained as part of that receive, so it has room again.
        assert!(
            lobby_in_tx.try_send((PEER_SLOT, b"more".to_vec())).is_ok(),
            "receive_turns must have drained the lobby_in backlog"
        );
    }
}
