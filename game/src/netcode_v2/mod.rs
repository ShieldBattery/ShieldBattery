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
use std::time::{Duration, Instant};

use bytes::Bytes;
use rally_point_client::ChatOut;
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
    establish_session, establish_sessionless, set_lobby_session_seed, submit_result_report,
    with_lobby_session_seed, with_turn_state,
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

/// The receiver scope a chat message names, decoded from (or encoded to) the wire's
/// `(target_kind, target_slot)` pair the relay carries opaquely (see
/// [`rally_point_client::ChatOut`]). Mirrors the scopes SC:R's own `MsgFltr` chat-target dialog
/// offers: everyone, allies only, observers only, or one named player.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatTarget {
    All,
    Allies,
    Observers,
    Player(SlotId),
}

impl ChatTarget {
    const WIRE_ALL: u32 = 0;
    const WIRE_ALLIES: u32 = 1;
    const WIRE_OBSERVERS: u32 = 2;
    const WIRE_PLAYER: u32 = 3;

    /// Encodes this target as the `(target_kind, target_slot)` pair `ChatOut` carries on the
    /// wire. `target_slot` is meaningless for anything but `Player`, so it's left `0`.
    pub fn to_wire(self) -> (u32, u32) {
        match self {
            ChatTarget::All => (Self::WIRE_ALL, 0),
            ChatTarget::Allies => (Self::WIRE_ALLIES, 0),
            ChatTarget::Observers => (Self::WIRE_OBSERVERS, 0),
            ChatTarget::Player(slot) => (Self::WIRE_PLAYER, slot.0 as u32),
        }
    }

    /// Decodes a wire `(target_kind, target_slot)` pair. An unrecognized `target_kind` (a future
    /// wire addition this build predates, or a non-conforming peer) degrades to `All` rather than
    /// dropping the message: `All` is the one scope the receive-side filter never hides, so it's
    /// the safe default when the scope itself can't be read.
    pub fn from_wire(target_kind: u32, target_slot: u32) -> ChatTarget {
        match target_kind {
            Self::WIRE_ALLIES => ChatTarget::Allies,
            Self::WIRE_OBSERVERS => ChatTarget::Observers,
            Self::WIRE_PLAYER => ChatTarget::Player(SlotId(target_slot as u8)),
            _ => ChatTarget::All,
        }
    }
}

/// A sustained turn-stream stall must last at least this long before the overlay names the players
/// it is blocked on. Short enough to beat the relay's much slower link-death detection, long enough
/// that ordinary latency-buffer jitter (which resets the stall clock the moment a turn arrives)
/// never trips it.
pub const STALL_TIER_DELAY: Duration = Duration::from_secs(3);

/// A relay-confirmed disconnect must last at least this long before the overlay offers its manual
/// drop. The relay's own floor for honoring a drop request is 40s; the extra margin keeps a click
/// from ever being refused merely for arriving a moment early.
pub const DROP_UNLOCK_UI: Duration = Duration::from_secs(45);

/// How long a "drop requested…" note lingers on a row after a drop request is submitted. The button
/// stays available afterward (a re-click is safe); the note just acknowledges the click.
pub const DROP_REQUESTED_NOTE: Duration = Duration::from_secs(5);

/// A render-side snapshot of the session's connectivity health, for the survivor disconnect
/// overlay. Built by [`TurnState::disconnect_status`] and read from the draw thread; it names peers
/// only by user id (resolved to a display name at render time) and touches no game state. The
/// display-ready rows and self-state are derived from it by [`rows`](Self::rows) /
/// [`self_state`](Self::self_state).
pub struct DisconnectStatus {
    /// Peers the relay's connectivity stream reported as dropped, held until a survivor's drop
    /// request produces the synced leave. Empty when the relay has confirmed no link death.
    pub peers: Vec<DisconnectedPeer>,
    /// Whether this client's own relay link is currently down. The driver re-dials on its own, so
    /// this can go back to `false` once the link is re-established — it only becomes permanent once
    /// the session ends for good.
    pub self_lost: bool,
    /// Remote participants the local simulation is blocked on right now: mapped session members
    /// other than ourselves whose next turn has not arrived, so the IN hook can't assemble a step.
    /// Read straight from the readiness set the IN hook itself uses, so it names who the sim is
    /// waiting on the instant the turn stream stalls — before the relay's slower connectivity
    /// detection confirms a link death. A slot appears here whether or not the relay has yet
    /// confirmed its drop.
    pub stalled: Vec<StalledPeer>,
    /// Whether [`stalled`](Self::stalled) covers every remaining remote participant (and there is at
    /// least one). When the whole remote roster is blocked at once and the relay has confirmed none
    /// of them, the local link is the likelier culprit than every peer dropping simultaneously.
    pub all_remotes_stalled: bool,
    /// When the current sustained turn-stream stall began, if the sim is stalled right now. Cleared
    /// the moment a full step assembles again, so a passing jitter never accumulates toward
    /// [`STALL_TIER_DELAY`].
    pub stalled_since: Option<Instant>,
    /// The slots for which a manual drop has been requested, each with the instant of the most
    /// recent request, so a row can briefly acknowledge the click (see [`DROP_REQUESTED_NOTE`]).
    pub drop_requests: Vec<(SlotId, Instant)>,
}

/// One peer the relay's connectivity stream reported as dropped.
pub struct DisconnectedPeer {
    /// The rally-point2 slot that dropped, named to the driver when a survivor requests its drop.
    pub slot: SlotId,
    /// The session user occupying the dropped slot, for display-name resolution at render time.
    pub user_id: SbUserId,
    /// When the drop was first observed, so the overlay can show how long the wait has run — and, at
    /// the drop-unlock threshold, offer the manual drop.
    pub since: Instant,
}

/// One remote participant the local simulation is currently blocked on, before any relay-confirmed
/// link death.
pub struct StalledPeer {
    /// The rally-point2 slot whose turn is outstanding.
    pub slot: SlotId,
    /// The session user occupying that slot, for display-name resolution at render time.
    pub user_id: SbUserId,
}

/// Which of the two disconnect tiers a row is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisconnectTier {
    /// The sim is blocked on this player's turn, but the relay has not (yet) confirmed a link death.
    /// Informational only — no drop is offered, since the relay would not honor one it hasn't
    /// observed.
    Stall,
    /// The relay confirmed this player's link is down. The drop-unlock clock runs from the
    /// confirmation, and the manual drop appears once it passes [`DROP_UNLOCK_UI`].
    Confirmed,
}

/// This client's own connection state, deciding the prominent self-notice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfState {
    /// Our link is fine; any rows are about peers.
    Healthy,
    /// The whole remote roster went quiet at once with no relay-confirmed peer drop — far likelier
    /// our own link than every peer failing together. Shown as a single interrupted notice rather
    /// than blaming each peer.
    Interrupted,
    /// The relay confirmed our own link is down (or the session ended). The driver auto-reconnects;
    /// this is the prominent self notice.
    Reconnecting,
}

/// One display-ready disconnect row, derived from a [`DisconnectStatus`] at a given instant. Carries
/// no display name (the caller resolves that from the game setup) so the same derivation feeds both
/// the overlay and the `queryState` snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisconnectRow {
    /// The rally-point2 slot this row is about; the target of a manual drop.
    pub slot: SlotId,
    /// The session user occupying that slot.
    pub user_id: SbUserId,
    /// Which tier the row is in (drives whether a drop can be offered).
    pub tier: DisconnectTier,
    /// How long the condition has run, in whole seconds — the confirmed-disconnect wait for a
    /// [`Confirmed`](DisconnectTier::Confirmed) row, the sustained-stall duration for a
    /// [`Stall`](DisconnectTier::Stall) one.
    pub seconds: u64,
    /// Whether the manual drop is available: a confirmed row past [`DROP_UNLOCK_UI`].
    pub drop_unlocked: bool,
    /// Whether a drop was requested for this slot within the last [`DROP_REQUESTED_NOTE`].
    pub drop_requested: bool,
}

impl DisconnectStatus {
    /// The all-healthy status: nothing disconnected, no stall, our own link fine. Used where there
    /// is no turn state to read (a replay, or a re-entrant lock).
    pub fn healthy() -> Self {
        DisconnectStatus {
            peers: Vec::new(),
            self_lost: false,
            stalled: Vec::new(),
            all_remotes_stalled: false,
            stalled_since: None,
            drop_requests: Vec::new(),
        }
    }

    /// This client's own connection state at `now`. Relay-confirmed self-loss wins outright; failing
    /// that, a sustained whole-roster stall with no confirmed peer drop reads as our own link.
    pub fn self_state(&self, now: Instant) -> SelfState {
        if self.self_lost {
            SelfState::Reconnecting
        } else if self.all_remotes_stalled && self.peers.is_empty() && self.stall_sustained(now) {
            SelfState::Interrupted
        } else {
            SelfState::Healthy
        }
    }

    /// The display-ready disconnect rows at `now`, one per blocking or relay-confirmed remote player.
    /// Empty when the self-state owns the notice (reconnecting or interrupted): the single self line
    /// is the whole story there. A relay-confirmed peer always shows as
    /// [`Confirmed`](DisconnectTier::Confirmed); a merely-stalled peer shows as
    /// [`Stall`](DisconnectTier::Stall) only once the stall is sustained, and never duplicates a peer
    /// already shown confirmed.
    pub fn rows(&self, now: Instant) -> Vec<DisconnectRow> {
        if self.self_state(now) != SelfState::Healthy {
            return Vec::new();
        }
        let mut rows: Vec<DisconnectRow> = self
            .peers
            .iter()
            .map(|peer| {
                let elapsed = now.saturating_duration_since(peer.since);
                DisconnectRow {
                    slot: peer.slot,
                    user_id: peer.user_id,
                    tier: DisconnectTier::Confirmed,
                    seconds: elapsed.as_secs(),
                    drop_unlocked: elapsed >= DROP_UNLOCK_UI,
                    drop_requested: self.drop_requested_recently(peer.slot, now),
                }
            })
            .collect();
        if self.stall_sustained(now) {
            let stall_seconds = self
                .stalled_since
                .map_or(0, |since| now.saturating_duration_since(since).as_secs());
            for stalled in &self.stalled {
                if rows.iter().any(|row| row.slot == stalled.slot) {
                    continue;
                }
                rows.push(DisconnectRow {
                    slot: stalled.slot,
                    user_id: stalled.user_id,
                    tier: DisconnectTier::Stall,
                    seconds: stall_seconds,
                    drop_unlocked: false,
                    drop_requested: self.drop_requested_recently(stalled.slot, now),
                });
            }
        }
        rows
    }

    /// Whether the current stall has lasted at least [`STALL_TIER_DELAY`] as of `now`.
    fn stall_sustained(&self, now: Instant) -> bool {
        self.stalled_since
            .is_some_and(|since| now.saturating_duration_since(since) >= STALL_TIER_DELAY)
    }

    /// Whether a manual drop for `slot` was requested within the last [`DROP_REQUESTED_NOTE`].
    fn drop_requested_recently(&self, slot: SlotId, now: Instant) -> bool {
        self.drop_requests
            .iter()
            .any(|&(s, at)| s == slot && now.saturating_duration_since(at) < DROP_REQUESTED_NOTE)
    }
}

/// How many rendered chat lines [`TurnState::record_chat`] keeps for `queryState` verification.
#[cfg(debug_assertions)]
const CHAT_LOG_CAPACITY: usize = 64;

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
    /// occupies each rp2 slot. Used to seed the slot→storm identity map up front
    /// ([`populate_identity_slots`](Self::populate_identity_slots)) and to build the joined-player
    /// set (storm id ≡ rp2 slot).
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
    /// Every thread observed driving the lobby flush (each logged once) — the flush cadence
    /// assumption behind `lobby_echo`'s pacing only holds when a single driver produces buffers,
    /// so knowing when a second one appears (e.g. the host's native lobby machine pumping from the
    /// main thread) is load-bearing for diagnosing dispatch backlog.
    lobby_flush_threads: Vec<std::thread::ThreadId>,
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
    /// Messages the `sendChat` debug command has queued for this client to send, in queue order.
    /// Drained by the IN hook on the game thread (see `bw_scr::apply_debug_chat`), which sends and
    /// locally echoes each one through the same path the in-game chat box's own send tap uses.
    #[cfg(debug_assertions)]
    debug_chat_queue: Vec<(ChatTarget, String)>,
    /// The last [`CHAT_LOG_CAPACITY`] chat lines rendered by this client (its own, and any peer's),
    /// recorded at injection time by [`record_chat`](Self::record_chat) for `queryState`
    /// verification. Oldest first.
    #[cfg(debug_assertions)]
    chat_log: VecDeque<crate::debug_control::DebugChatLogEntry>,
    /// Peers the relay's connectivity stream reported as dropped and which have neither
    /// (re)connected nor had their synced leave applied yet, each paired with the instant the drop
    /// was first observed (for the overlay's elapsed counter). In observation order. Populated only
    /// once the game has started: a pre-start drop frame is ignored (there is no in-game overlay to
    /// render it on yet), a (re)connect clears the slot, and an applied leave clears it via
    /// [`mark_slot_left`](Self::mark_slot_left). Best-effort and render-facing only.
    disconnected: Vec<(SlotId, Instant)>,
    /// Whether this client's own relay link is currently down, per the driver's self-connectivity
    /// signal on [`TurnChannels::connectivity`](rally_point_client::TurnChannels) (see
    /// [`pump_connectivity`](Self::pump_connectivity)). Unlike a peer's entry in `disconnected`,
    /// this is not a one-way latch: the driver re-dials on its own, so a `(own slot, true)` frame
    /// clears it again once the link is back. It only becomes permanent when the turn channels
    /// close outright (a terminal end of session), which also sets it and leaves it set for the
    /// rest of the game. Informational for the overlay only; never set for a deliberately-closed
    /// [`local_only`](Self::local_only) session.
    self_link_lost: bool,
    /// When the current sustained turn-stream stall began, or `None` when a full step last assembled.
    /// Set by [`receive_turns`](Self::receive_turns) the first poll it can't gather every required
    /// slot's turn, and cleared the first poll it can — so it measures one continuous stall, and a
    /// passing gap that resolves within a poll never lingers. Drives the overlay's first
    /// (stall-aware) tier; render-facing only.
    stall_start: Option<Instant>,
    /// Slots a manual drop has been requested for, each with the instant of the most recent request
    /// (see [`request_drop`](Self::request_drop)). Lets a row acknowledge the click for a short
    /// window; an applied leave clears the slot's entry via [`mark_slot_left`](Self::mark_slot_left).
    /// Render-facing only.
    drop_requests: Vec<(SlotId, Instant)>,
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
            lobby_flush_threads: Vec::new(),
            lobby_inbound: std::array::from_fn(|_| VecDeque::new()),
            lobby_dispatch: std::array::from_fn(|_| None),
            local_only: false,
            has_computers,
            #[cfg(debug_assertions)]
            forced_leaves: Vec::new(),
            #[cfg(debug_assertions)]
            forced_desync: false,
            #[cfg(debug_assertions)]
            debug_chat_queue: Vec::new(),
            #[cfg(debug_assertions)]
            chat_log: VecDeque::new(),
            disconnected: Vec::new(),
            self_link_lost: false,
            stall_start: None,
            drop_requests: Vec::new(),
        }
    }

    /// Builds turn state for a sessionless solo game (a single human, the rest AI) with no relay
    /// link behind it. The roster is the lone local participant at [`SlotId(0)`], the slot→storm
    /// identity map is seeded up front (so storm id 0 maps to slot 0), the latency floor is the
    /// built-in 1, and the state is [`local_only`](Self::local_only) from birth: every driver-bound
    /// send echoes locally or lands in a parked void rather than reaching a relay. Unlike
    /// [`begin_local_only`](Self::begin_local_only) there is no fabricated-leave dance — there are no
    /// remote slots to leave.
    ///
    /// `channels` are the fabricated turn channels whose far ends the caller parks alive (see
    /// [`session::establish_sessionless`]). `has_computers` is whether the game contains AI players.
    pub fn new_sessionless(
        channels: TurnChannels,
        local_user_id: SbUserId,
        has_computers: bool,
    ) -> Self {
        let mut state = Self::new(
            channels,
            SlotId(0),
            1,
            vec![(SlotId(0), local_user_id)],
            has_computers,
        );
        state.populate_identity_slots();
        state.local_only = true;
        state
    }

    /// Records the rally-point2 slot ↔ BW storm id mapping learned during lobby join.
    ///
    /// rp2 slots are session-bounded to `0..bw::MAX_STORM_PLAYERS` — players and observers share
    /// that range, observers occupying the upper slots — so an out-of-range slot can't occur short
    /// of a protocol bug; assert in debug so one would surface loudly rather than as a mapping that
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

    /// The `(user, storm id)` pairing for every session participant, where storm id ≡ rp2 slot.
    /// Used to write real storm ids into BW's player slots directly from the roster instead of
    /// learning them from a Storm join.
    pub fn roster_storm_ids(&self) -> Vec<(SbUserId, StormPlayerId)> {
        self.roster
            .iter()
            .map(|&(slot, user)| (user, StormPlayerId(slot.0)))
            .collect()
    }

    /// Assign the slot→storm identity map (storm id ≡ rp2 slot) for every roster slot up front. Each
    /// mapped slot becomes `required` (a session participant the sim must have a turn from each
    /// step). The roster names every participant including ourselves, so this covers the local slot
    /// too.
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

    /// OUT path for in-game chat: hands a message to the driver's chat channel for the other
    /// session members, scoped by `target` (see [`ChatTarget`]). `text` is capped to
    /// [`bw::commands::CHAT_TEXT_CAPACITY`] bytes (truncated on a UTF-8 boundary) before it ever
    /// reaches the driver — every session member injects a chat message as the fixed-size classic
    /// chat record, so trimming here keeps this client's own echo and every peer's copy identical
    /// instead of each truncating independently at a different point.
    ///
    /// Best-effort like the driver's other chat handling: returns `false` when the channel to the
    /// driver is full or closed (the driver died, or is overwhelmed), which the caller should log
    /// and otherwise ignore — a lost chat line is not correctness-critical the way a lost turn or
    /// lobby command is.
    pub fn submit_chat(&mut self, target: ChatTarget, text: String) -> bool {
        let text = bw::commands::truncate_utf8(&text, bw::commands::CHAT_TEXT_CAPACITY).to_string();
        let (target_kind, target_slot) = target.to_wire();
        let message = ChatOut {
            target_kind,
            target_slot,
            text,
        };
        self.channels.chat_out.try_send(message).is_ok()
    }

    /// OUT path for a manual drop request: names a disconnected member's `slot` to the driver, which
    /// writes a `RequestDrop` up the reliable control stream for the relay's session authority to
    /// honor once that slot has been down long enough. Fire-and-forget and best-effort — the only
    /// confirmation is the target's [`LeaveDirective`] arriving on the leaves channel; a request the
    /// authority refuses (asked too early) is silently dropped and can simply be submitted again.
    ///
    /// Returns `false` when the channel to the driver is full or closed. Both are logged and
    /// otherwise ignored: losing one request costs only a re-click, and a mis-click can never close
    /// the requester's own link (the request is rate-limited relay-side).
    pub fn request_drop(&mut self, slot: SlotId) -> bool {
        // Record the click regardless of whether the send lands: the overlay's brief acknowledgement
        // reflects that the player asked, and a full/closed channel is a best-effort loss they can
        // simply re-click through.
        let now = Instant::now();
        match self.drop_requests.iter_mut().find(|(s, _)| *s == slot) {
            Some(entry) => entry.1 = now,
            None => self.drop_requests.push((slot, now)),
        }
        match self.channels.request_drop.try_send(slot) {
            Ok(()) => true,
            Err(mpsc::error::TrySendError::Full(_)) => {
                debug!("netcode v2: request_drop channel full, dropping request for {slot:?}");
                false
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                debug!("netcode v2: request_drop channel closed, dropping request for {slot:?}");
                false
            }
        }
    }

    /// Drains every chat message currently available from the driver's `chat_in` channel. Never
    /// blocks, and always fully drains the channel regardless of `game_started` — mirrors
    /// `lobby_in`'s discard-drain at the end of [`drain_inbound`](Self::drain_inbound): a channel
    /// nothing reads eventually fills and wedges the driver, and unlike `lobby_in`, chat stays live
    /// for the driver's whole session rather than being pre-game-only.
    ///
    /// Delivers what it drains only once the game has started and this client hasn't gone
    /// [`local_only`](Self::local_only) — before the game starts there is no in-game overlay to
    /// render a line on yet, and once local-only, this client's peers are departed or departing,
    /// so there is no one left to meaningfully attribute a late message to. Outside that window the
    /// drained messages are discarded.
    ///
    /// Each returned message's text is capped to [`bw::commands::CHAT_TEXT_CAPACITY`] bytes
    /// (truncated on a UTF-8 boundary) before the caller ever sees it: the relay allows up to 256
    /// bytes on the wire, more than the classic chat record's fixed capacity, so a message from a
    /// non-conforming peer can't reach the injection helper only to overflow it there.
    pub fn drain_chat_inbound(&mut self, game_started: bool) -> Vec<(SlotId, ChatOut)> {
        let deliverable = game_started && !self.local_only;
        let mut out = Vec::new();
        while let Ok((slot, mut chat)) = self.channels.chat_in.try_recv() {
            if !deliverable {
                continue;
            }
            chat.text = bw::commands::truncate_utf8(&chat.text, bw::commands::CHAT_TEXT_CAPACITY)
                .to_string();
            out.push((slot, chat));
        }
        out
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
            // Start the stall clock on the first poll we can't gather a full step; leave it running
            // across the repeated polls a sustained stall produces so it measures one continuous
            // outage rather than restarting each poll.
            if self.stall_start.is_none() {
                self.stall_start = Some(Instant::now());
            }
            return false;
        }
        // A full step assembled: whatever brief gap there may have been is over, so the stall clock
        // resets and ordinary between-turn jitter never accumulates toward the stall tier.
        self.stall_start = None;
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
        let thread = std::thread::current().id();
        if !self.lobby_flush_threads.contains(&thread) {
            self.lobby_flush_threads.push(thread);
            debug!(
                "lobby flush driver thread {thread:?} ({} total)",
                self.lobby_flush_threads.len()
            );
        }
        let commands = Bytes::copy_from_slice(buffer);
        self.lobby_echo.push_back(commands.clone());
        let depth = self.lobby_echo.len();
        if depth >= 32 && depth.is_multiple_of(32) {
            warn!("lobby echo backlog at {depth} turns (flush outpacing dispatch)");
        }
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
        let Some(mut local_turn) = self.lobby_echo.pop_front() else {
            // Nothing queued yet this tick: stall rather than free-run ahead of the native cadence.
            return false;
        };
        // A keep-alive carries no information, so a queued real command must never wait behind
        // one: collapse leading keep-alives down to whatever follows them. Without this, a flush
        // path that runs faster than this hook (the host's native lobby machine pumps the flush on
        // the main thread on top of the async thread's step_network) grows an unbounded keep-alive
        // backlog that delays every real command behind it by queue-depth * dispatch cadence.
        while matches!(local_turn[..], [LOBBY_KEEP_ALIVE]) && !self.lobby_echo.is_empty() {
            local_turn = self.lobby_echo.pop_front().expect("checked non-empty");
        }
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
        // An applied leave ends the survivor overlay's lifetime for this slot: the peer has left
        // lockstep (whether it reconnected in time or was dropped for good), so the "waiting…"
        // notice and any pending drop-request acknowledgement no longer apply.
        if let Some(slot) = self.slot_for_storm(storm_id) {
            self.disconnected.retain(|&(s, _)| s != slot);
            self.drop_requests.retain(|&(s, _)| s != slot);
        }
    }

    /// The rally-point2 slot mapped to a storm id, if any — the inverse of
    /// [`storm_id_for_slot`](Self::storm_id_for_slot), used to translate a storm-keyed leave back to
    /// the slot the connectivity stream keys its drops by.
    fn slot_for_storm(&self, storm_id: StormPlayerId) -> Option<SlotId> {
        self.slot_to_storm
            .iter()
            .position(|&s| s == Some(storm_id))
            .map(|idx| SlotId(idx as u8))
    }

    /// Game-thread pump for the relay's best-effort slot-connectivity stream (see
    /// [`TurnChannels::connectivity`](rally_point_client::TurnChannels)). Drains every pending
    /// change without blocking, distinguishing our own slot from a peer's by comparing against
    /// [`local_slot`](Self::local_slot):
    ///
    /// - A peer frame (`false`) observed once the game has started records that slot as
    ///   disconnected (keeping the first-seen instant on a repeat); a peer `true` clears it. A
    ///   pre-start frame is ignored — the pre-start dial's own connect frames arrive here and are
    ///   absorbed harmlessly.
    /// - Our own slot's frame drives [`self_link_lost`](Self::self_link_lost) directly: `false`
    ///   sets it, `true` clears it — the driver re-dials on its own and emits this pair around each
    ///   outage, so unlike a peer's entry this is not a one-way latch. Applied regardless of
    ///   `game_started`: the overlay that reads the flag is itself gated on the game having
    ///   started, so an early frame just sets the flag to its correct value ahead of time.
    ///
    /// If the channel's sender has been dropped — the driver ended and closed its end of every turn
    /// channel, so the session is over — latches `self_link_lost` for good, unless the session was
    /// closed deliberately (already [`local_only`](Self::local_only)), where the closure is expected
    /// and not a lost connection. This is the terminal fallback: a closure no longer means "our link
    /// blipped" (the driver's own reconnect loop handles that case above), only that reconnection is
    /// no longer possible (slot-departed refusal, token expiry, or a non-link failure) or the session
    /// ended cleanly.
    ///
    /// Render-facing only: it mutates no game state, alliances, or turn pipeline.
    pub fn pump_connectivity(&mut self, game_started: bool, now: Instant) {
        loop {
            match self.channels.connectivity.try_recv() {
                Ok((slot, connected)) if slot == self.local_slot => {
                    self.self_link_lost = !connected;
                }
                Ok((slot, true)) => self.disconnected.retain(|&(s, _)| s != slot),
                Ok((slot, false)) => {
                    if game_started && !self.disconnected.iter().any(|&(s, _)| s == slot) {
                        self.disconnected.push((slot, now));
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    if game_started && !self.local_only {
                        self.self_link_lost = true;
                    }
                    break;
                }
            }
        }
    }

    /// A render-side snapshot of who has lost connection, for the survivor disconnect overlay.
    /// Resolves each disconnected slot to its session user id via the roster (a slot with no roster
    /// entry — which should not occur — is skipped), and reads which remote participants the sim is
    /// blocked on from the IN-hook readiness set. Pure read: drains no channel, mutates nothing.
    pub fn disconnect_status(&self) -> DisconnectStatus {
        let peers = self
            .disconnected
            .iter()
            .filter_map(|&(slot, since)| {
                let user_id = self.user_for_slot(slot)?;
                Some(DisconnectedPeer {
                    slot,
                    user_id,
                    since,
                })
            })
            .collect();
        let stalled = self.stalled_peers();
        let remote_required = self.remote_required_count();
        DisconnectStatus {
            peers,
            self_lost: self.self_link_lost,
            all_remotes_stalled: remote_required > 0 && stalled.len() == remote_required,
            stalled,
            stalled_since: self.stall_start,
            drop_requests: self.drop_requests.clone(),
        }
    }

    /// The remote participants the local simulation is blocked on this instant: every mapped slot
    /// other than our own that the sim still requires a turn from and whose inbound queue is empty.
    /// This is the exact condition the IN hook stalls on (see [`receive_turns`](Self::receive_turns)),
    /// so it names who the turn stream is waiting on the moment it stalls — ahead of the relay's
    /// connectivity confirmation. A slot with no roster entry (should not occur) is skipped.
    fn stalled_peers(&self) -> Vec<StalledPeer> {
        let local_storm = self.storm_id_for_slot(self.local_slot);
        (0..bw::MAX_STORM_PLAYERS)
            .filter(|&storm| self.required[storm] && self.inbound_queues[storm].is_empty())
            .filter(|&storm| Some(StormPlayerId(storm as u8)) != local_storm)
            .filter_map(|storm| {
                let slot = self.slot_for_storm(StormPlayerId(storm as u8))?;
                let user_id = self.user_for_slot(slot)?;
                Some(StalledPeer { slot, user_id })
            })
            .collect()
    }

    /// How many remote participants the sim still requires a turn from each step: every mapped,
    /// still-required slot other than our own. Shrinks as peers depart (an applied leave clears a
    /// slot's `required`), so it tracks the live remote roster rather than the original one.
    fn remote_required_count(&self) -> usize {
        let local_storm = self.storm_id_for_slot(self.local_slot);
        (0..bw::MAX_STORM_PLAYERS)
            .filter(|&storm| self.required[storm])
            .filter(|&storm| Some(StormPlayerId(storm as u8)) != local_storm)
            .count()
    }

    /// The session user occupying a rally-point2 slot, per the coordinator's roster.
    fn user_for_slot(&self, slot: SlotId) -> Option<SbUserId> {
        self.roster
            .iter()
            .find(|&&(s, _)| s == slot)
            .map(|&(_, user)| user)
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

    /// Queues a chat message for the `sendChat` debug-control command. The game thread drains this
    /// on its next receive (see `bw_scr::apply_debug_chat`) and sends + locally echoes it through
    /// the exact same path (`BwScr::send_chat_message`) the in-game chat box's own send tap uses.
    /// Nothing is sent here, so this is safe to call from the async side.
    #[cfg(debug_assertions)]
    pub fn debug_queue_chat(&mut self, target: ChatTarget, text: String) {
        self.debug_chat_queue.push((target, text));
    }

    /// Drains the messages queued by [`debug_queue_chat`](Self::debug_queue_chat), in queue order.
    /// Called once per receive on the game thread.
    #[cfg(debug_assertions)]
    pub fn take_debug_chat_queue(&mut self) -> Vec<(ChatTarget, String)> {
        std::mem::take(&mut self.debug_chat_queue)
    }

    /// Records one rendered chat line for `queryState` verification, capped to the last
    /// [`CHAT_LOG_CAPACITY`] messages (oldest dropped first). Called at injection time — see
    /// `bw_scr::BwScr::inject_chat_message` — so the log reflects exactly what was attributed and
    /// rendered, truncation included, for both this client's own messages and a peer's.
    #[cfg(debug_assertions)]
    pub fn record_chat(&mut self, entry: crate::debug_control::DebugChatLogEntry) {
        self.chat_log.push_back(entry);
        if self.chat_log.len() > CHAT_LOG_CAPACITY {
            self.chat_log.pop_front();
        }
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
            chat_log: self.chat_log.iter().cloned().collect(),
            disconnect: self.disconnect_view_snapshot(),
        }
    }

    /// The survivor disconnect overlay's current state, serialized for `queryState`. Derives the rows
    /// and self-state from the exact same [`DisconnectStatus`] the overlay renders, so the snapshot
    /// reflects what the overlay would show.
    #[cfg(debug_assertions)]
    fn disconnect_view_snapshot(&self) -> crate::debug_control::DisconnectViewSnapshot {
        use crate::debug_control::{
            DisconnectRowSnapshot, DisconnectSelfState, DisconnectTier as SnapTier,
            DisconnectViewSnapshot,
        };

        let now = Instant::now();
        let status = self.disconnect_status();
        let self_state = match status.self_state(now) {
            SelfState::Healthy => DisconnectSelfState::Ok,
            SelfState::Interrupted => DisconnectSelfState::Interrupted,
            SelfState::Reconnecting => DisconnectSelfState::Reconnecting,
        };
        let rows = status
            .rows(now)
            .into_iter()
            .map(|row| DisconnectRowSnapshot {
                slot: row.slot.0,
                user_id: row.user_id,
                tier: match row.tier {
                    DisconnectTier::Stall => SnapTier::Stall,
                    DisconnectTier::Confirmed => SnapTier::Confirmed,
                },
                elapsed_seconds: row.seconds,
                drop_unlocked: row.drop_unlocked,
                drop_requested: row.drop_requested,
            })
            .collect();
        DisconnectViewSnapshot { self_state, rows }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

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
        // Chat isn't exercised by these tests; the far ends drop on return (closing the channels
        // is harmless — nothing sends or drains chat here).
        let (chat_out_tx, _chat_out_rx) = mpsc::channel(16);
        let (_chat_in_tx, chat_in_rx) = mpsc::channel(16);
        let (_session_start_tx, session_start_rx) = mpsc::channel(1);
        // Connectivity isn't exercised by these tests; the sender drops on return (a disconnected
        // receiver is harmless — nothing pumps connectivity here). See `turn_state_with_connectivity`
        // for the disconnect-overlay tests.
        let (_connectivity_tx, connectivity_rx) = mpsc::channel(16);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
            chat_out: chat_out_tx,
            chat_in: chat_in_rx,
            request_drop: mpsc::channel(1).0,
            session_start: session_start_rx,
            connectivity: connectivity_rx,
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
        let (chat_out_tx, _chat_out_rx) = mpsc::channel(1);
        let (_chat_in_tx, chat_in_rx) = mpsc::channel(1);
        let (_session_start_tx, session_start_rx) = mpsc::channel(1);
        let (_connectivity_tx, connectivity_rx) = mpsc::channel(1);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
            chat_out: chat_out_tx,
            chat_in: chat_in_rx,
            request_drop: mpsc::channel(1).0,
            session_start: session_start_rx,
            connectivity: connectivity_rx,
        };
        let state = TurnState::new(channels, LOCAL_SLOT, 0, Vec::new(), false);
        assert_eq!(state.latency_turns(), 1);
        drop(out_rx);
    }

    #[test]
    fn sessionless_is_local_only_from_birth_and_drives_the_seam_locally() {
        // A sessionless solo game: one local slot, no peers, local-only from birth. The channels
        // stand in for the parked far ends `establish_sessionless` would hold alive.
        let (out_tx, mut out_rx) = mpsc::channel(16);
        let (_in_tx, in_rx) = mpsc::channel(16);
        let (_leave_tx, leave_rx) = mpsc::channel(16);
        let (leave_intent_tx, _leave_intent_rx) = mpsc::channel(1);
        let (result_tx, _result_rx) = mpsc::channel(1);
        let (lobby_out_tx, mut lobby_out_rx) = mpsc::channel(16);
        let (_lobby_in_tx, lobby_in_rx) = mpsc::channel(16);
        let (chat_out_tx, _chat_out_rx) = mpsc::channel(16);
        let (_chat_in_tx, chat_in_rx) = mpsc::channel(16);
        let (_session_start_tx, session_start_rx) = mpsc::channel(1);
        let (_connectivity_tx, connectivity_rx) = mpsc::channel(16);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
            chat_out: chat_out_tx,
            chat_in: chat_in_rx,
            request_drop: mpsc::channel(1).0,
            session_start: session_start_rx,
            connectivity: connectivity_rx,
        };
        // `has_computers` true, yet a sessionless game never self-closes: it is local-only from
        // birth, so there is no relay session to close.
        let mut state = TurnState::new_sessionless(channels, LOCAL_USER, true);
        assert_eq!(state.storm_id_for_slot(SlotId(0)), Some(StormPlayerId(0)));
        assert!(!state.should_self_close());

        // In-game: the local turn echoes into the sim but nothing reaches the (void) relay.
        assert!(state.submit_local_turn(b"solo", Some(0)));
        assert!(
            out_rx.try_recv().is_err(),
            "a sessionless game must not send to the relay"
        );
        assert!(state.receive_turns(0), "the lone slot's echo is enough");
        assert_eq!(
            dispatched(&state),
            vec![(StormPlayerId(0), b"solo".to_vec())]
        );

        // Lobby seam: the local echo drives dispatch for the single required slot. A real command
        // buffer is relayed into the void harmlessly (the parked far end keeps the channel open).
        state.enable_lobby_seam();
        assert!(state.submit_local_lobby_turn(b"slotinit"));
        assert_eq!(
            lobby_out_rx.try_recv().expect("relayed into the void"),
            b"slotinit".to_vec()
        );
        assert!(state.lobby_receive_turns());
        assert_eq!(
            lobby_dispatched(&state),
            vec![(StormPlayerId(0), b"slotinit".to_vec())]
        );
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
        let (chat_out_tx, _chat_out_rx) = mpsc::channel(1);
        let (_chat_in_tx, chat_in_rx) = mpsc::channel(1);
        let (_session_start_tx, session_start_rx) = mpsc::channel(1);
        let (_connectivity_tx, connectivity_rx) = mpsc::channel(1);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::clone(&result_expected),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
            chat_out: chat_out_tx,
            chat_in: chat_in_rx,
            request_drop: mpsc::channel(1).0,
            session_start: session_start_rx,
            connectivity: connectivity_rx,
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

    #[test]
    fn chat_target_wire_round_trips() {
        for target in [
            ChatTarget::All,
            ChatTarget::Allies,
            ChatTarget::Observers,
            ChatTarget::Player(PEER_SLOT),
        ] {
            let (kind, slot) = target.to_wire();
            assert_eq!(ChatTarget::from_wire(kind, slot), target);
        }
    }

    #[test]
    fn chat_target_from_wire_defaults_unrecognized_kinds_to_all() {
        // A future wire addition this build predates, or a malformed peer, must degrade to `All`
        // rather than be mistaken for one of the known scopes.
        assert_eq!(ChatTarget::from_wire(99, 0), ChatTarget::All);
    }

    /// Minimal chat-only harness: builds a `TurnState` with live `chat_out`/`chat_in` channels and
    /// drops every other channel's far end (nothing here exercises turns/leaves/lobby). Kept
    /// separate from [`turn_state_inner`] rather than extending its widely-shared tuple, since only
    /// these chat tests need live chat channels.
    fn turn_state_with_chat() -> (
        TurnState,
        mpsc::Receiver<ChatOut>,
        mpsc::Sender<(SlotId, ChatOut)>,
    ) {
        let (out_tx, _out_rx) = mpsc::channel(16);
        let (_in_tx, in_rx) = mpsc::channel(16);
        let (_leave_tx, leave_rx) = mpsc::channel(16);
        let (leave_intent_tx, _leave_intent_rx) = mpsc::channel(1);
        let (result_tx, _result_rx) = mpsc::channel(1);
        let (lobby_out_tx, _lobby_out_rx) = mpsc::channel(16);
        let (_lobby_in_tx, lobby_in_rx) = mpsc::channel(16);
        let (chat_out_tx, chat_out_rx) = mpsc::channel(16);
        let (chat_in_tx, chat_in_rx) = mpsc::channel(16);
        let (_session_start_tx, session_start_rx) = mpsc::channel(1);
        let (_connectivity_tx, connectivity_rx) = mpsc::channel(16);
        let channels = TurnChannels {
            outbound: out_tx,
            inbound: in_rx,
            leaves: leave_rx,
            leave_intent: leave_intent_tx,
            result: result_tx,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: lobby_out_tx,
            lobby_in: lobby_in_rx,
            chat_out: chat_out_tx,
            chat_in: chat_in_rx,
            request_drop: mpsc::channel(1).0,
            session_start: session_start_rx,
            connectivity: connectivity_rx,
        };
        let roster = vec![(LOCAL_SLOT, LOCAL_USER), (PEER_SLOT, PEER_USER)];
        (
            TurnState::new(channels, LOCAL_SLOT, 2, roster, false),
            chat_out_rx,
            chat_in_tx,
        )
    }

    #[test]
    fn submit_chat_sends_the_scoped_message_and_truncates_oversize_text() {
        let (mut state, mut chat_out_rx, _chat_in_tx) = turn_state_with_chat();

        assert!(state.submit_chat(ChatTarget::Allies, "gg".to_string()));
        let sent = chat_out_rx.try_recv().unwrap();
        assert_eq!(sent.target_kind, 1);
        assert_eq!(sent.target_slot, 0);
        assert_eq!(sent.text, "gg");

        assert!(state.submit_chat(ChatTarget::Player(PEER_SLOT), "hi".to_string()));
        let sent = chat_out_rx.try_recv().unwrap();
        assert_eq!(sent.target_kind, 3);
        assert_eq!(sent.target_slot, PEER_SLOT.0 as u32);

        // Oversize text is truncated to `CHAT_TEXT_CAPACITY` before it ever reaches the driver, on
        // a UTF-8 boundary — every session member injects this into the same fixed-size classic
        // chat record, so truncating once here keeps every copy identical.
        let oversize = "a".repeat(bw::commands::CHAT_TEXT_CAPACITY + 50);
        assert!(state.submit_chat(ChatTarget::All, oversize));
        let sent = chat_out_rx.try_recv().unwrap();
        assert_eq!(sent.text.len(), bw::commands::CHAT_TEXT_CAPACITY);
    }

    #[test]
    fn drain_chat_inbound_delivers_when_game_started_and_discards_otherwise() {
        let (mut state, _chat_out_rx, chat_in_tx) = turn_state_with_chat();
        let message = ChatOut {
            target_kind: 0,
            target_slot: 0,
            text: "hello".to_string(),
        };

        // Not yet in-game: drained but discarded.
        chat_in_tx.try_send((PEER_SLOT, message.clone())).unwrap();
        assert_eq!(state.drain_chat_inbound(false), Vec::new());

        // In-game: delivered.
        chat_in_tx.try_send((PEER_SLOT, message.clone())).unwrap();
        let delivered = state.drain_chat_inbound(true);
        assert_eq!(delivered, vec![(PEER_SLOT, message)]);

        // Either way the channel is fully drained, never left to back up.
        assert!(state.drain_chat_inbound(true).is_empty());
    }

    #[test]
    fn drain_chat_inbound_discards_once_local_only() {
        let (mut state, _chat_out_rx, chat_in_tx) = turn_state_with_chat();
        state.begin_local_only();

        chat_in_tx
            .try_send((
                PEER_SLOT,
                ChatOut {
                    target_kind: 0,
                    target_slot: 0,
                    text: "late".to_string(),
                },
            ))
            .unwrap();
        assert_eq!(
            state.drain_chat_inbound(true),
            Vec::new(),
            "a message arriving after local-only has no one left to attribute it to"
        );
    }

    #[test]
    fn drain_chat_inbound_truncates_oversize_wire_text() {
        let (mut state, _chat_out_rx, chat_in_tx) = turn_state_with_chat();
        // The relay allows up to 256 bytes on the wire, more than the classic chat record's fixed
        // capacity — a non-conforming peer's oversize message must not reach the injection helper
        // only to overflow it there.
        let oversize = "b".repeat(200);
        chat_in_tx
            .try_send((
                PEER_SLOT,
                ChatOut {
                    target_kind: 0,
                    target_slot: 0,
                    text: oversize,
                },
            ))
            .unwrap();
        let delivered = state.drain_chat_inbound(true);
        assert_eq!(delivered.len(), 1);
        assert_eq!(delivered[0].1.text.len(), bw::commands::CHAT_TEXT_CAPACITY);
    }

    /// Builds a TurnState wired for the disconnect-overlay tests: the slot→storm identity map is
    /// seeded from the roster (as `establish_session` does), and the senders the driver would use to
    /// push slot-connectivity changes and to which the game submits manual drop requests are
    /// returned. The other far ends drop on return — these tests exercise only `pump_connectivity` /
    /// `disconnect_status` / `mark_slot_left` / `request_drop`, none of which read them.
    fn turn_state_with_connectivity() -> (
        TurnState,
        mpsc::Sender<(SlotId, bool)>,
        mpsc::Receiver<SlotId>,
    ) {
        let (connectivity_tx, connectivity_rx) = mpsc::channel(16);
        let (request_drop_tx, request_drop_rx) = mpsc::channel(16);
        let channels = TurnChannels {
            outbound: mpsc::channel(16).0,
            inbound: mpsc::channel::<Payload>(16).1,
            leaves: mpsc::channel::<LeaveDirective>(16).1,
            leave_intent: mpsc::channel(1).0,
            result: mpsc::channel(1).0,
            result_expected: Arc::new(AtomicBool::new(false)),
            lobby_out: mpsc::channel(16).0,
            lobby_in: mpsc::channel::<(SlotId, Vec<u8>)>(16).1,
            chat_out: mpsc::channel(16).0,
            chat_in: mpsc::channel::<(SlotId, ChatOut)>(16).1,
            request_drop: request_drop_tx,
            session_start: mpsc::channel(1).1,
            connectivity: connectivity_rx,
        };
        let roster = vec![(LOCAL_SLOT, LOCAL_USER), (PEER_SLOT, PEER_USER)];
        let mut state = TurnState::new(channels, LOCAL_SLOT, 2, roster, false);
        state.populate_identity_slots();
        (state, connectivity_tx, request_drop_rx)
    }

    #[test]
    fn connectivity_records_and_clears_peer_drops_once_started() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();
        let now = Instant::now();

        // A drop that arrives before the game starts is ignored: there is no in-game overlay yet.
        connectivity_tx.try_send((PEER_SLOT, false)).unwrap();
        state.pump_connectivity(false, now);
        assert!(state.disconnect_status().peers.is_empty());

        // Once started, a drop is recorded and resolves to the slot's session user for display.
        connectivity_tx.try_send((PEER_SLOT, false)).unwrap();
        state.pump_connectivity(true, now);
        let status = state.disconnect_status();
        assert_eq!(status.peers.len(), 1);
        assert_eq!(status.peers[0].user_id, PEER_USER);
        assert!(!status.self_lost);

        // A (re)connect clears it.
        connectivity_tx.try_send((PEER_SLOT, true)).unwrap();
        state.pump_connectivity(true, now);
        assert!(state.disconnect_status().peers.is_empty());
    }

    #[test]
    fn connectivity_repeat_drop_keeps_the_first_seen_instant() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();
        let first = Instant::now();
        connectivity_tx.try_send((PEER_SLOT, false)).unwrap();
        state.pump_connectivity(true, first);
        let recorded = state.disconnect_status().peers[0].since;

        // A redundant drop for the same slot must not reset the counter.
        let later = first + Duration::from_secs(5);
        connectivity_tx.try_send((PEER_SLOT, false)).unwrap();
        state.pump_connectivity(true, later);
        assert_eq!(state.disconnect_status().peers[0].since, recorded);
    }

    #[test]
    fn applied_leave_ends_the_disconnect_notice() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();
        connectivity_tx.try_send((PEER_SLOT, false)).unwrap();
        state.pump_connectivity(true, Instant::now());
        assert_eq!(state.disconnect_status().peers.len(), 1);

        // The dropped slot's synced leave applies (storm id ≡ rp2 slot under the identity map): the
        // overlay's lifetime for that peer ends.
        let peer_storm = state.storm_id_for_slot(PEER_SLOT).unwrap();
        state.mark_slot_left(peer_storm);
        assert!(state.disconnect_status().peers.is_empty());
    }

    #[test]
    fn own_slot_frame_drives_self_link_lost_directly() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();

        // Our own slot's drop sets the flag immediately off the driver's explicit signal, without
        // waiting for the channel to close — and does not get mistaken for a peer drop.
        connectivity_tx.try_send((LOCAL_SLOT, false)).unwrap();
        state.pump_connectivity(true, Instant::now());
        let status = state.disconnect_status();
        assert!(status.self_lost);
        assert!(status.peers.is_empty());
    }

    #[test]
    fn own_slot_reconnect_clears_self_link_lost() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();

        connectivity_tx.try_send((LOCAL_SLOT, false)).unwrap();
        state.pump_connectivity(true, Instant::now());
        assert!(state.disconnect_status().self_lost);

        // The driver re-dialing successfully clears the notice — unlike a peer's entry in
        // `disconnected`, this is not a one-way latch: the driver keeps servicing the channels
        // across the outage and signals its own reconnect the same way it signaled the drop.
        connectivity_tx.try_send((LOCAL_SLOT, true)).unwrap();
        state.pump_connectivity(true, Instant::now());
        assert!(!state.disconnect_status().self_lost);
    }

    #[test]
    fn a_closed_channel_latches_self_link_lost_only_in_game() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();
        // The channel closing outright — as opposed to an own-slot frame — is the terminal
        // fallback: reconnection is no longer possible (or the session ended), so this always
        // means the link is down for the rest of the game, with no own-slot `true` frame ever
        // coming to clear it.
        drop(connectivity_tx);

        // Pre-start, the closed channel is not surfaced as a lost connection.
        state.pump_connectivity(false, Instant::now());
        assert!(!state.disconnect_status().self_lost);

        // In-game, it latches the self-disconnect notice.
        state.pump_connectivity(true, Instant::now());
        assert!(state.disconnect_status().self_lost);
    }

    #[test]
    fn a_deliberate_local_only_close_is_not_a_lost_connection() {
        let (mut state, connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();
        drop(connectivity_tx);
        // A local-only session closed its own link on purpose; the channel closing must not read as
        // a lost connection.
        state.begin_local_only();
        state.pump_connectivity(true, Instant::now());
        assert!(!state.disconnect_status().self_lost);
    }

    #[test]
    fn request_drop_hands_the_slot_to_the_driver() {
        let (mut state, _connectivity_tx, mut request_drop_rx) = turn_state_with_connectivity();

        assert!(state.request_drop(PEER_SLOT));
        assert_eq!(request_drop_rx.try_recv().unwrap(), PEER_SLOT);

        // Re-clicking the same slot is safe: each submission is an independent fire-and-forget
        // request the relay rate-limits on its own.
        assert!(state.request_drop(PEER_SLOT));
        assert_eq!(request_drop_rx.try_recv().unwrap(), PEER_SLOT);
    }

    #[test]
    fn request_drop_returns_false_when_the_driver_end_is_gone() {
        let (mut state, _connectivity_tx, request_drop_rx) = turn_state_with_connectivity();
        drop(request_drop_rx);
        assert!(
            !state.request_drop(PEER_SLOT),
            "a closed channel is reported, not panicked on"
        );
    }

    #[test]
    fn stalled_peers_names_required_remote_slots_without_a_queued_turn() {
        let (mut state, _connectivity_tx, _request_drop_rx) = turn_state_with_connectivity();

        // Both participants are required and neither has a queued turn, but the local slot is never
        // reported as stalled — you never wait on yourself — so only the peer shows, and it is the
        // whole remote roster.
        let status = state.disconnect_status();
        assert_eq!(status.stalled.len(), 1);
        assert_eq!(status.stalled[0].slot, PEER_SLOT);
        assert_eq!(status.stalled[0].user_id, PEER_USER);
        assert!(status.all_remotes_stalled);

        // Once the peer's synced leave applies, it is no longer required: nothing remote remains to
        // wait on.
        let peer_storm = state.storm_id_for_slot(PEER_SLOT).unwrap();
        state.mark_slot_left(peer_storm);
        let status = state.disconnect_status();
        assert!(status.stalled.is_empty());
        assert!(!status.all_remotes_stalled);
    }

    #[test]
    fn stall_tier_row_waits_out_the_delay_then_reports_the_blocking_player() {
        let now = Instant::now();
        // One remote slot blocking, no relay-confirmed drop, not the whole roster.
        let status = DisconnectStatus {
            peers: Vec::new(),
            self_lost: false,
            stalled: vec![StalledPeer {
                slot: PEER_SLOT,
                user_id: PEER_USER,
            }],
            all_remotes_stalled: false,
            stalled_since: Some(now - Duration::from_secs(1)),
            drop_requests: Vec::new(),
        };
        // Under the delay, nothing is shown yet.
        assert!(status.rows(now).is_empty());

        let status = DisconnectStatus {
            stalled_since: Some(now - STALL_TIER_DELAY),
            ..status
        };
        let rows = status.rows(now);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].slot, PEER_SLOT);
        assert_eq!(rows[0].tier, DisconnectTier::Stall);
        assert!(!rows[0].drop_unlocked, "a stall row never offers a drop");
    }

    #[test]
    fn confirmed_row_unlocks_the_drop_only_past_the_threshold() {
        let now = Instant::now();
        let confirmed_for = |elapsed: Duration| DisconnectStatus {
            peers: vec![DisconnectedPeer {
                slot: PEER_SLOT,
                user_id: PEER_USER,
                since: now - elapsed,
            }],
            self_lost: false,
            stalled: Vec::new(),
            all_remotes_stalled: false,
            stalled_since: None,
            drop_requests: Vec::new(),
        };

        let rows = confirmed_for(DROP_UNLOCK_UI - Duration::from_secs(1)).rows(now);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tier, DisconnectTier::Confirmed);
        assert!(!rows[0].drop_unlocked, "still locked a second early");

        let rows = confirmed_for(DROP_UNLOCK_UI).rows(now);
        assert!(rows[0].drop_unlocked, "unlocked at the threshold");
        assert_eq!(rows[0].seconds, DROP_UNLOCK_UI.as_secs());
    }

    #[test]
    fn a_relay_confirmed_peer_is_shown_once_even_while_also_stalled() {
        let now = Instant::now();
        // The same slot is both relay-confirmed and blocking the sim; it must show a single
        // confirmed row, not duplicate as a stall row too.
        let status = DisconnectStatus {
            peers: vec![DisconnectedPeer {
                slot: PEER_SLOT,
                user_id: PEER_USER,
                since: now - Duration::from_secs(10),
            }],
            self_lost: false,
            stalled: vec![StalledPeer {
                slot: PEER_SLOT,
                user_id: PEER_USER,
            }],
            all_remotes_stalled: true,
            stalled_since: Some(now - STALL_TIER_DELAY * 2),
            drop_requests: Vec::new(),
        };
        let rows = status.rows(now);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tier, DisconnectTier::Confirmed);
    }

    #[test]
    fn self_state_interrupted_only_when_the_whole_roster_stalls_unconfirmed_and_sustained() {
        let now = Instant::now();
        let base = DisconnectStatus {
            peers: Vec::new(),
            self_lost: false,
            stalled: vec![StalledPeer {
                slot: PEER_SLOT,
                user_id: PEER_USER,
            }],
            all_remotes_stalled: true,
            stalled_since: Some(now - STALL_TIER_DELAY),
            drop_requests: Vec::new(),
        };
        assert_eq!(base.self_state(now), SelfState::Interrupted);
        // The single interrupted notice owns the display: no per-peer rows.
        assert!(base.rows(now).is_empty());

        // Not yet sustained: still healthy (an ordinary between-turn gap).
        let brief = DisconnectStatus {
            stalled_since: Some(now),
            ..base
        };
        assert_eq!(brief.self_state(now), SelfState::Healthy);

        // A relay-confirmed self-loss overrides the heuristic outright.
        let lost = DisconnectStatus {
            self_lost: true,
            ..brief
        };
        assert_eq!(lost.self_state(now), SelfState::Reconnecting);
    }

    #[test]
    fn drop_request_note_lingers_only_for_its_window() {
        let now = Instant::now();
        let with_request = |ago: Duration| DisconnectStatus {
            peers: vec![DisconnectedPeer {
                slot: PEER_SLOT,
                user_id: PEER_USER,
                since: now - DROP_UNLOCK_UI,
            }],
            self_lost: false,
            stalled: Vec::new(),
            all_remotes_stalled: false,
            stalled_since: None,
            drop_requests: vec![(PEER_SLOT, now - ago)],
        };
        assert!(with_request(Duration::from_secs(1)).rows(now)[0].drop_requested);
        assert!(!with_request(DROP_REQUESTED_NOTE).rows(now)[0].drop_requested);
    }
}
