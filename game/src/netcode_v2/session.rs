//! Async-side setup for the netcode v2 turn transport: turning the stashed launch handoff
//! ([`NetcodeV2Setup`]) into a live QUIC session, and the global handoff by which the BW-thread
//! hooks reach the game-thread-owned [`TurnState`].
//!
//! [`establish_session`] runs on the DLL's Tokio runtime: it builds the pinned-trust credentials,
//! dials the home relay (falling back across its address families), spawns the [`LinkDriver`] that
//! services the link — re-dialing itself on a link drop, without tearing the turn channels down —
//! and stores the resulting [`TurnState`] where the three BW hooks (installed in `bw_scr.rs`) can
//! reach it via [`with_turn_state`]. [`establish_sessionless`] stores a driverless [`TurnState`] the
//! same way for a solo game. With no turn state stored (a replay), the hooks find nothing here and
//! run BW's original turn handling unchanged.

use std::ffi::CString;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use quick_error::quick_error;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::proto::messages::{LeaveDirective, Payload};
use rally_point_client::transport::Link;
use rally_point_client::{
    ChatOut, ClientEndpoint, DialError, Identity, LinkDriver, Reconnect, TurnChannels,
};
use tokio::sync::mpsc;

use super::TurnState;
use super::credentials::{self, CredentialError, RelayTarget, SessionCredentials};
use super::rehome::{self, RehomeContext};
use crate::app_messages::{NetcodeV2Setup, SbUserId};
use crate::recurse_checked_mutex::Mutex;

quick_error! {
    #[derive(Debug)]
    pub enum SessionError {
        /// Building the credentials/trust store from the launch handoff failed.
        Credentials(err: CredentialError) {
            from()
            display("netcode v2 credentials could not be built: {}", err)
            source(err)
        }
        /// Every candidate address of every relay we were given failed to connect.
        Dial(err: DialError) {
            display("netcode v2 relay could not be dialed: {}", err)
            source(err)
        }
    }
}

/// The live netcode v2 session for the current game.
///
/// Holds whatever keeps the turn transport alive for the session's lifetime (see [`SessionLink`])
/// and the game-thread-owned [`TurnState`] the three BW hooks operate on.
pub struct NetcodeV2Session {
    /// What keeps the turn transport alive (see [`SessionLink`]). Its inner value is never touched
    /// after construction, but the variant is read to tell a relay-backed session from a sessionless
    /// one (e.g. so a result report only counts as delivered when there is a real relay driver).
    link: SessionLink,
    turn_state: TurnState,
}

/// What keeps a session's turn transport standing.
enum SessionLink {
    /// A live relay game: the QUIC endpoint (and thus its UDP socket) the [`LinkDriver`] runs on.
    Relay(ClientEndpoint),
    /// A sessionless solo game: no relay, no driver. The parked far ends of the fabricated turn
    /// channels, held alive so every driver-bound send in [`TurnState`] lands in a void rather than
    /// erroring on a closed channel.
    Sessionless(ParkedChannels),
}

/// The far ends of a sessionless game's fabricated [`TurnChannels`]. There is no [`LinkDriver`] to
/// own them, so the session holds them: keeping each one alive means the [`TurnState`] end never
/// observes a closed channel, so every turn/lobby/chat/leave/result send succeeds (into nothing)
/// exactly as it would against a live driver. Nothing ever reads them.
struct ParkedChannels {
    _outbound: mpsc::Receiver<Payload>,
    _inbound: mpsc::Sender<Payload>,
    _leaves: mpsc::Sender<LeaveDirective>,
    _leave_intent: mpsc::Receiver<()>,
    _result: mpsc::Receiver<Vec<u8>>,
    _lobby_out: mpsc::Receiver<Vec<u8>>,
    _lobby_in: mpsc::Sender<(SlotId, Vec<u8>)>,
    _chat_out: mpsc::Receiver<ChatOut>,
    _chat_in: mpsc::Sender<(SlotId, ChatOut)>,
    _request_drop: mpsc::Receiver<SlotId>,
    _session_start: mpsc::Sender<()>,
    _connectivity: mpsc::Sender<(SlotId, bool)>,
}

/// The current game's session, reached from the BW/sync thread via [`with_turn_state`] and created on the
/// async thread by [`establish_session`]. Recurse-checked so a hook that re-enters (the IN hook's
/// leave pass can reach the OUT hook) gets `None` instead of deadlocking — but the lock discipline
/// is to not hold it across such calls in the first place.
static SESSION: Mutex<Option<NetcodeV2Session>> = Mutex::new(None);

/// Builds the QUIC session from the launch handoff and stores it for the hooks. Call on the Tokio
/// runtime (it dials and spawns the driver). Replaces any previous session.
///
/// `has_computers` is whether the game contains AI players; it drives the turn state's
/// self-closing behavior when the last remote human leaves (see [`TurnState::should_self_close`]).
///
/// Returns the receiver end of the relay's session-start directive: the driver forwards a unit on
/// it once every expected slot has connected, session-wide. The init path awaits it once to gate
/// the game start; the turn state never reads it, so it is lifted out of the turn channels here.
pub async fn establish_session(
    setup: &NetcodeV2Setup,
    has_computers: bool,
    rehome_context: RehomeContext,
) -> Result<mpsc::Receiver<()>, SessionError> {
    let SessionCredentials {
        identity,
        home,
        roots,
    } = SessionCredentials::from_setup(setup)?;
    // The slot and session are the ones the coordinator signed into the token, not separately-sent
    // values. The session id is the key the `/netstat` operator header carries for incident lookup.
    let local_slot = identity.token().claims.slot;
    let session_id = identity.token().claims.session.0;
    let endpoint = credentials::bind_endpoint(roots)?;

    // Dial the home relay, trying its candidate addresses in preference order (v6 then v4).
    let (link, relay_addr) = connect_relay(&endpoint, &home, &identity).await?;

    // The SB-server-mediated failover hook: when the home relay's process dies (fresh cert ⇒ pinned
    // trust refuses it), the driver escalates to this to move the whole group to a replacement
    // relay. `None` (no result code to authenticate the server request) keeps the pre-failover
    // same-relay-only behavior. The driver owns the current-relay identity and hands it to the
    // provider at escalation time, so the provider no longer needs seeding here.
    let rehome = rehome::build_provider(&rehome_context);

    let (driver, mut channels) = LinkDriver::new(link);
    // Re-dial from the same endpoint (its UDP socket stays open for the session's life via
    // `SessionLink::Relay` below) so a re-dial after a drop reuses the already-bound local port.
    let reconnect = Reconnect {
        endpoint: ClientEndpoint::from_endpoint(endpoint.endpoint().clone()),
        relay_addr,
        server_name: home.server_name.clone(),
        // Seeds the driver's current-relay tracking: the home relay is what a first death names dead.
        relay_id: setup.home_relay.relay_id,
        identity,
        rehome,
        // Use the driver's built-in escalation timing (immediate on a cert/pin rejection, ~10s of
        // failed same-relay dials otherwise; re-ask ~every 15s while unavailable).
        escalate_after: None,
        escalate_retry: None,
    };
    // Service the link on the DLL's async runtime. `run_reconnecting` re-dials internally on a
    // link failure, keeping every turn channel alive across the outage (see the self-connectivity
    // convention on `channels.connectivity` in `mod.rs`); it only ends — dropping the channels,
    // which the hooks read as end-of-session — on a clean shutdown, a terminal relay refusal, or a
    // non-link failure reconnecting can't fix.
    tokio::spawn(async move {
        match driver.run_reconnecting(reconnect).await {
            Ok(()) => debug!("netcode v2 link closed cleanly"),
            Err(e) => error!("netcode v2 link failed: {e}"),
        }
    });

    let roster = setup
        .roster
        .iter()
        .map(|entry| (SlotId(entry.slot), entry.user_id))
        .collect();
    // Seeded from the session's buffer bounds minimum (the coordinator's policy for this tenant),
    // which is also where the relay's decision-maker starts. A due BufferDirective
    // (rally_point_client::proto::messages::BufferDirective) resizes it from there; floored at 1
    // in case a malformed handoff ever carried 0.
    // The session-start receiver is awaited by the init path (and drained for the session's life
    // afterward), never by the turn state — so take it out here and leave a closed stand-in in the
    // bundle the turn state stores. The driver's sender points at the receiver returned below.
    let session_start = std::mem::replace(&mut channels.session_start, mpsc::channel(1).1);
    let mut turn_state = TurnState::new(
        channels,
        local_slot,
        setup.initial_buffer_turns.max(1),
        roster,
        has_computers,
    );
    // Storm ids come straight from the roster (storm id ≡ rp2 slot), so seed the slot→storm
    // identity map up front here rather than learning it from a Storm join.
    turn_state.populate_identity_slots();
    // Seed the `/netstat` operator header and per-player home column from the launch handoff. The
    // header's own relay id starts at the home relay and advances live on a re-home; each slot's home
    // is the create-time assignment (peers' re-homes are not client-observable). Our own region is
    // the home entry the roster carries for our slot.
    let own_region = setup
        .roster
        .iter()
        .find(|entry| entry.slot == local_slot.0)
        .and_then(|entry| entry.home_region.clone());
    turn_state.set_net_stats_identity(session_id, setup.home_relay.relay_id, own_region);
    turn_state.set_slot_homes(
        setup
            .roster
            .iter()
            .map(|entry| {
                (
                    SlotId(entry.slot),
                    entry.home_relay_id,
                    entry.home_region.clone(),
                )
            })
            .collect(),
    );
    if let Some(mut guard) = SESSION.lock() {
        *guard = Some(NetcodeV2Session {
            link: SessionLink::Relay(endpoint),
            turn_state,
        });
    }
    Ok(session_start)
}

/// Stands up a sessionless [`TurnState`] for a solo game (one human, the rest AI) and stores it for
/// the hooks, exactly where [`establish_session`] would store a relay-backed one — so the three BW
/// hooks reach it via [`with_turn_state`] uniformly. There is no relay to dial and no driver to
/// spawn: the turn channels are fabricated here and their far ends parked alive in the session (see
/// [`ParkedChannels`]), so every driver-bound send in the turn state succeeds into a void. Replaces
/// any previous session.
///
/// `has_computers` drives nothing here (a solo game is local-only from birth, so it never
/// self-closes), but is threaded through for symmetry with [`establish_session`].
pub fn establish_sessionless(local_user_id: SbUserId, has_computers: bool) {
    // Capacities matching the driver's own so a burst of lobby/chat/turn sends can't wedge on a full
    // channel before the game settles into local-only steady state. Nothing drains these; they only
    // need to stay open.
    let (outbound_tx, outbound_rx) = mpsc::channel(1024);
    let (inbound_tx, inbound_rx) = mpsc::channel(1024);
    let (leaves_tx, leaves_rx) = mpsc::channel(16);
    let (leave_intent_tx, leave_intent_rx) = mpsc::channel(1);
    let (result_tx, result_rx) = mpsc::channel(1);
    let (lobby_out_tx, lobby_out_rx) = mpsc::channel(256);
    let (lobby_in_tx, lobby_in_rx) = mpsc::channel(256);
    let (chat_out_tx, chat_out_rx) = mpsc::channel(256);
    let (chat_in_tx, chat_in_rx) = mpsc::channel(256);
    let (request_drop_tx, request_drop_rx) = mpsc::channel(1);
    let (session_start_tx, session_start_rx) = mpsc::channel(16);
    let (connectivity_tx, connectivity_rx) = mpsc::channel(16);

    let channels = TurnChannels {
        outbound: outbound_tx,
        inbound: inbound_rx,
        leaves: leaves_rx,
        leave_intent: leave_intent_tx,
        result: result_tx,
        result_expected: Arc::new(AtomicBool::new(false)),
        lobby_out: lobby_out_tx,
        lobby_in: lobby_in_rx,
        chat_out: chat_out_tx,
        chat_in: chat_in_rx,
        request_drop: request_drop_tx,
        session_start: session_start_rx,
        connectivity: connectivity_rx,
    };
    let parked = ParkedChannels {
        _outbound: outbound_rx,
        _inbound: inbound_tx,
        _leaves: leaves_tx,
        _leave_intent: leave_intent_rx,
        _result: result_rx,
        _lobby_out: lobby_out_rx,
        _lobby_in: lobby_in_tx,
        _chat_out: chat_out_rx,
        _chat_in: chat_in_tx,
        _request_drop: request_drop_rx,
        _session_start: session_start_tx,
        _connectivity: connectivity_tx,
    };

    let turn_state = TurnState::new_sessionless(channels, local_user_id, has_computers);
    if let Some(mut guard) = SESSION.lock() {
        *guard = Some(NetcodeV2Session {
            link: SessionLink::Sessionless(parked),
            turn_state,
        });
    }
}

/// Dials one relay, trying its candidate addresses in preference order (v6 then v4, per
/// [`RelayTarget`]). Returns the link and the address that connected (so a later reconnect can
/// redial that same address rather than re-running the whole family fallback) on the first address
/// that connects; errors only if all of them fail.
async fn connect_relay(
    endpoint: &ClientEndpoint,
    relay: &RelayTarget,
    identity: &Identity,
) -> Result<(Link, SocketAddr), SessionError> {
    let mut last_err = None;
    for &addr in &relay.addrs {
        match endpoint.connect(addr, &relay.server_name, identity).await {
            Ok(link) => return Ok((link, addr)),
            Err(e) => {
                debug!("netcode v2 dial to {addr} failed: {e}");
                last_err = Some(e);
            }
        }
    }
    // `RelayTarget::addrs` is guaranteed non-empty by `resolve_relay`, so a failure always has a
    // recorded cause.
    Err(SessionError::Dial(
        last_err.expect("a relay target always has at least one address"),
    ))
}

/// Runs `f` against the current game's [`TurnState`], if one is live.
///
/// Returns `None` when there is no turn state stored (a replay) or when the turn-state mutex is
/// already held by this thread — a re-entrant hook call, which the caller treats the same as "no
/// turn state" and runs BW's original behavior. Keep `f` short: it runs with the BW sync thread
/// holding the lock, and it must not call back into native code that can re-enter a turn hook (see
/// the IN-hook lock discipline in the module docs).
pub fn with_turn_state<R>(f: impl FnOnce(&mut TurnState) -> R) -> Option<R> {
    let mut guard = SESSION.lock()?;
    let session = guard.as_mut()?;
    Some(f(&mut session.turn_state))
}

/// Transitions the current game's turn state to local-only for a locally-decided game (see
/// [`TurnState::begin_local_only`]).
///
/// Unlike [`with_turn_state`], this distinguishes its two `None` cases instead of collapsing them:
/// no turn state stored (a replay — the hooks never find a turn state here either) stays a silent
/// no-op, but the lock already held re-entrantly is warned, because this call fires from the
/// dialog hook rather than one of the three turn hooks — if it ever raced one of them, losing the
/// transition silently would leave the game networked when it should have gone local-only.
pub fn begin_local_only() {
    let Some(mut guard) = SESSION.lock() else {
        warn!("begin_local_only skipped: turn state locked re-entrantly");
        return;
    };
    if let Some(session) = guard.as_mut() {
        session.turn_state.begin_local_only();
    }
}

/// Hands the current game's serialized end-of-game result report to a relay driver, which delivers
/// it over the relay's reliable control stream (see [`TurnState::submit_result_report`]). Returns
/// whether a relay-backed session took the report.
///
/// `true` means the report was handed to a relay driver and the caller must NOT also POST it over
/// HTTP. `false` means there is no relay driver — a solo game (whose sessionless turn state has no
/// relay to deliver over), or a replay (no turn state at all), or the re-entrant-lock case (which
/// can't actually happen here, since this fires from the async result handler well off the turn
/// hooks, but is warned rather than silently mis-reporting) — so the caller falls back to the HTTP
/// result path.
pub fn submit_result_report(report: Vec<u8>) -> bool {
    let Some(mut guard) = SESSION.lock() else {
        warn!("submit_result_report skipped: turn state locked re-entrantly");
        return false;
    };
    match guard.as_mut() {
        Some(session) => match session.link {
            SessionLink::Relay(_) => {
                session.turn_state.submit_result_report(report);
                true
            }
            // A sessionless solo game has no relay to deliver over, so it does not take the report;
            // the caller POSTs it over HTTP just as a native game would.
            SessionLink::Sessionless(_) => false,
        },
        None => false,
    }
}

/// Tears down the current session (game over / teardown). Idempotent.
pub fn clear_session() {
    if let Some(mut guard) = SESSION.lock() {
        *guard = None;
    }
    clear_lobby_session_seed();
}

/// The inputs the `storm_join_game` replacement hook needs to build a peer's Storm session state
/// itself, in place of the native network join handshake. Staged on the async side before the
/// native lobby join runs, and read by the hook on BW's thread mid-join.
///
/// While this is unset (the default), the hook falls through to the native `storm_join_game` and
/// nothing here changes any behavior.
pub struct LobbySessionSeed {
    /// The Storm session (game) name, passed through to `storm_create_game`.
    pub game_name: CString,
    /// This client's own player name.
    pub local_name: CString,
    /// The session's total slot count, passed through to `storm_create_game`.
    pub slot_count: u32,
    /// The local player's storm session slot (the roster slot this client occupies).
    pub local_slot: u8,
    /// Every OTHER session member (the local player is not listed).
    pub members: Vec<StormMemberSeed>,
}

/// One other session member the join replacement seeds into Storm's session-player list, standing in
/// for the peer-admit that would normally happen as its network join packet arrives.
pub struct StormMemberSeed {
    /// The member's storm session slot.
    pub slot: u8,
    /// The member's player name.
    pub name: CString,
    /// The member's 12-byte Storm net key (see [`storm_net_key`](super::storm_net_key)).
    pub net_key: [u8; 12],
}

/// The staged join-replacement inputs, reached from the BW/sync thread via
/// [`with_lobby_session_seed`]. Recurse-checked like [`SESSION`]: a re-entrant read returns `None`,
/// which the hook treats identically to "no seed staged" (fall through to native join).
static LOBBY_SESSION_SEED: Mutex<Option<LobbySessionSeed>> = Mutex::new(None);

/// Stages the inputs the `storm_join_game` replacement hook builds a peer's session state from.
/// Call before the native lobby join runs. Replaces any previously-staged seed.
pub fn set_lobby_session_seed(seed: LobbySessionSeed) {
    if let Some(mut guard) = LOBBY_SESSION_SEED.lock() {
        *guard = Some(seed);
    }
}

/// Clears any staged join-replacement inputs (tied to [`clear_session`]'s lifecycle).
pub fn clear_lobby_session_seed() {
    if let Some(mut guard) = LOBBY_SESSION_SEED.lock() {
        *guard = None;
    }
}

/// Runs `f` against the staged join-replacement inputs, if any are staged.
///
/// Returns `None` when nothing is staged (the default — the join hook then runs native
/// `storm_join_game`) or when the seed mutex is already held by this thread (a re-entrant read,
/// treated the same as "not staged").
pub fn with_lobby_session_seed<R>(f: impl FnOnce(&LobbySessionSeed) -> R) -> Option<R> {
    let guard = LOBBY_SESSION_SEED.lock()?;
    let seed = guard.as_ref()?;
    Some(f(seed))
}
