//! Async-side setup for the netcode v2 turn transport: turning the stashed launch handoff
//! ([`NetcodeV2Setup`]) into a live QUIC session, and the global handoff by which the BW-thread
//! hooks reach the game-thread-owned [`TurnState`].
//!
//! [`establish_session`] runs on the DLL's Tokio runtime: it builds the pinned-trust credentials,
//! dials the home relay (racing its address families, preferred first, redialing failed candidates
//! until a deadline), spawns the [`LinkDriver`] that
//! services the link — re-dialing itself on a link drop, without tearing the turn channels down —
//! and stores the resulting [`TurnState`] where the three BW hooks (installed in `bw_scr.rs`) can
//! reach it via [`with_turn_state`]. [`establish_sessionless`] stores a driverless [`TurnState`] the
//! same way for a solo game. With no turn state stored (a replay), the hooks find nothing here and
//! run BW's original turn handling unchanged.

use std::ffi::CString;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use futures::StreamExt;
use futures::stream::FuturesUnordered;
use quick_error::quick_error;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::proto::messages::{LeaveDirective, Payload};
use rally_point_client::transport::Link;
use rally_point_client::{
    ChatOut, ClientEndpoint, DialError, Identity, LinkDriver, PhaseStatus, Reconnect, TurnChannels,
};
use tokio::sync::{mpsc, watch};

use super::TurnState;
use super::credentials::{self, CredentialError, RelayTarget, SessionCredentials};
use super::rehome::{self, RehomeContext};
use crate::app_messages::{NetcodeV2Setup, SbUserId};
use crate::recurse_checked_mutex::Mutex;
use crate::windows::wifi::WifiLowLatencyLease;

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
    /// Flips to `true` when the [`LinkDriver`] task ends — which, on a clean leave, happens exactly
    /// when the relay closes the link after processing our `LeaveIntent`. Awaited (bounded) by
    /// [`wait_for_driver_shutdown`] before the process is allowed to exit, so the announcement is
    /// actually on the wire and processed rather than stranded in a dying process. `None` for a
    /// sessionless game (no driver, nothing to flush).
    driver_done: Option<watch::Receiver<bool>>,
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
    _skin_out: mpsc::Receiver<Vec<u8>>,
    _skin_in: mpsc::Sender<(SlotId, Vec<u8>)>,
    _request_drop: mpsc::Receiver<SlotId>,
    _session_start: mpsc::Sender<Option<u32>>,
    _connectivity: mpsc::Sender<(SlotId, bool)>,
    _region_labels: mpsc::Sender<Vec<(u64, String)>>,
    _phase_status: watch::Sender<PhaseStatus>,
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
/// Returns the receiver end of the relay's session-start directive: the driver forwards its payload
/// on it once every expected slot has connected, session-wide. The payload is the session's computed
/// initial latency-buffer depth — `Some(turns)` when the authoring relay sized one, `None` when it
/// sized none. The init path awaits it once to gate the game start (applying any carried depth before
/// the first frame); the turn state never reads it, so it is lifted out of the turn channels here.
pub async fn establish_session(
    setup: &NetcodeV2Setup,
    has_computers: bool,
    rehome_context: RehomeContext,
) -> Result<mpsc::Receiver<Option<u32>>, SessionError> {
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

    // Background Wi-Fi scans can interrupt packet delivery for long enough to stall a real-time
    // session. Acquire immediately before the first relay dial so the lobby is covered too. The
    // lease is moved into the reconnecting driver below; a failed or cancelled dial drops it here.
    // Sessionless games and replays never call this function.
    let wifi_low_latency = WifiLowLatencyLease::acquire();

    // Dial the home relay, racing its candidate addresses (preference order, v6 first, each next
    // candidate staggered in behind the last).
    let (link, relay_addr) = connect_relay(&endpoint, &home, &identity).await?;

    // The SB-server-mediated failover hook: when the home relay's process dies (fresh cert ⇒ pinned
    // trust refuses it), the driver escalates to this to move the whole group to a replacement
    // relay. `None` (no result code to authenticate the server request) keeps the pre-failover
    // same-relay-only behavior. The driver owns the current-relay identity and hands it to the
    // provider at escalation time, so the provider no longer needs seeding here. The winning
    // address's family seeds the provider's replacement-relay pick: it's the family this client's
    // connectivity demonstrably reaches.
    let has_result_code = rehome_context.result_code.is_some();
    let rehome = rehome::build_provider(&rehome_context, relay_addr.is_ipv6());

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
    let (driver_done_tx, driver_done_rx) = watch::channel(false);
    tokio::spawn(async move {
        let result = if let Some(lease) = wifi_low_latency {
            lease
                .maintain_while(driver.run_reconnecting(reconnect))
                .await
        } else {
            driver.run_reconnecting(reconnect).await
        };
        match result {
            Ok(()) => debug!("netcode v2 link closed cleanly"),
            Err(e) => error!("netcode v2 link failed: {e}"),
        }
        // Either way the driver is done with the link; the shutdown path only needs to know
        // nothing more will be written, not whether the close was clean.
        let _ = driver_done_tx.send(true);
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
    // A client with no server-issued result code (an observer) can never build a result report, so
    // the driver must not hold its leave intent waiting for one — see `expect_result_report`.
    turn_state.set_result_report_possible(has_result_code);
    if let Some(mut guard) = SESSION.lock() {
        *guard = Some(NetcodeV2Session {
            link: SessionLink::Relay(endpoint),
            turn_state,
            driver_done: Some(driver_done_rx),
        });
    }
    Ok(session_start)
}

/// Waits (bounded by `timeout`) for the relay driver task to end. On a clean leave the driver ends
/// exactly when the relay closes the link after processing our `LeaveIntent` — so awaiting this
/// before process teardown guarantees the announcement was actually delivered, not stranded in a
/// dying process (which would leave the surviving players stalled on the drop path instead of
/// getting the prompt "player left"). Returns immediately when there is no session or no driver
/// (sessionless/replay), and the timeout bounds a driver stuck re-dialing a dead relay.
pub async fn wait_for_driver_shutdown(timeout: Duration) {
    // Clone the receiver out under the lock, await outside it: holding the session lock across the
    // await would block the game thread's hooks for up to the whole timeout.
    let rx = SESSION
        .lock()
        .and_then(|guard| guard.as_ref().and_then(|s| s.driver_done.clone()));
    let Some(mut rx) = rx else {
        return;
    };
    // An `Err` from `wait_for` means the sender dropped, which only happens when the driver task
    // ended — the same fact a `true` reports.
    match tokio::time::timeout(timeout, rx.wait_for(|&done| done)).await {
        Ok(_) => debug!("netcode v2: relay driver shut down; leave announcement delivered"),
        Err(_) => warn!(
            "netcode v2: relay driver still running after {timeout:?}; proceeding with shutdown"
        ),
    }
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
    let (skin_out_tx, skin_out_rx) = mpsc::channel(32);
    let (skin_in_tx, skin_in_rx) = mpsc::channel(32);
    let (request_drop_tx, request_drop_rx) = mpsc::channel(1);
    let (session_start_tx, session_start_rx) = mpsc::channel(16);
    let (connectivity_tx, connectivity_rx) = mpsc::channel(16);
    let (region_labels_tx, region_labels_rx) = mpsc::channel(4);
    let (phase_status_tx, phase_status_rx) = watch::channel(PhaseStatus::default());

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
        skin_out: skin_out_tx,
        skin_in: skin_in_rx,
        request_drop: request_drop_tx,
        session_start: session_start_rx,
        connectivity: connectivity_rx,
        region_labels: region_labels_rx,
        phase_status: phase_status_rx,
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
        _skin_out: skin_out_rx,
        _skin_in: skin_in_tx,
        _request_drop: request_drop_rx,
        _session_start: session_start_tx,
        _connectivity: connectivity_tx,
        _region_labels: region_labels_tx,
        _phase_status: phase_status_tx,
    };

    let turn_state = TurnState::new_sessionless(channels, local_user_id, has_computers);
    if let Some(mut guard) = SESSION.lock() {
        *guard = Some(NetcodeV2Session {
            link: SessionLink::Sessionless(parked),
            turn_state,
            driver_done: None,
        });
    }
}

/// How long the preferred candidate's dial runs alone before the next candidate is started
/// alongside it (and so on down the list). Short enough that a client whose preferred family is
/// black-holed — a dial that only dies at its own ~10s deadline — reaches a working family after
/// about this delay; long enough that when the preferred family answers at all, it wins outright
/// and later candidates rarely even start.
const DIAL_STAGGER: Duration = Duration::from_millis(250);

/// How long a candidate that failed rests before it is redialed. Long enough not to hammer a
/// relay that is refusing us (every refused dial still costs it a QUIC handshake), short enough
/// that the first redial lands after a transient failure — a dial racing the coordinator's
/// session provisioning to the relay, a momentary path drop — has likely passed.
const DIAL_RETRY_BACKOFF: Duration = Duration::from_secs(1);

/// How long past the start of the race new redials keep being scheduled; dials already in flight
/// at the cutoff still run to their own deadlines. A single failed dial must not fail the whole
/// game load — a game-launch dial happens right when the session was provisioned, and the server
/// holds the load open far longer than this — but the race must still conclude comfortably inside
/// the server's load window, so a genuinely unreachable relay surfaces as this client's load
/// failure with time to spare for releasing the other players.
const DIAL_RETRY_WINDOW: Duration = Duration::from_secs(30);

/// Whether a failed dial is worth redialing. True for failures that involved actually reaching
/// (or losing) the network: lost or refused connections, handshake I/O failures, and dial
/// deadlines. A fresh dial cannot tell a deliberate relay refusal from a transient one — the
/// relay closes the connection the same way for a token it will never accept and for one whose
/// session provisioning simply hasn't arrived yet — so refusals retry too, bounded by
/// [`DIAL_RETRY_WINDOW`]. False for local failures (a malformed address, framing/crypto errors),
/// which repeat identically on every attempt.
fn dial_worth_retrying(error: &DialError) -> bool {
    matches!(
        error,
        DialError::Connection(_)
            | DialError::Write(_)
            | DialError::Read(_)
            | DialError::TimedOut { .. }
    )
}

/// Formats `error` followed by the root of its `source()` chain when the display text doesn't
/// already show it — nested error displays often stop short (quinn's "connection lost" hides the
/// peer's close code and reason a level deeper), and for a failed relay dial that hidden detail
/// is frequently the only clue to *why* the relay dropped us.
pub fn error_with_root_cause(error: &dyn std::error::Error) -> String {
    let mut msg = error.to_string();
    let mut root: &dyn std::error::Error = error;
    while let Some(source) = root.source() {
        root = source;
    }
    let root_msg = root.to_string();
    if !msg.contains(&root_msg) {
        msg.push_str(&format!(" ({root_msg})"));
    }
    msg
}

/// Dials one relay by racing its candidate addresses ([`RelayTarget::addrs`], preference order):
/// the first candidate starts immediately, each later one after [`DIAL_STAGGER`] — or as soon as
/// an earlier candidate fails outright — and the first dial to complete its handshake wins.
/// A candidate whose failure is [worth retrying](dial_worth_retrying) redials (after
/// [`DIAL_RETRY_BACKOFF`] of rest) until [`DIAL_RETRY_WINDOW`] closes, so one transient failure
/// on an address family cannot fail the whole game load while a later attempt would succeed —
/// which matters doubly for a client whose other family is unusable and has no second candidate
/// to fall back to. Losing dials are dropped, which closes their connections; the relay refuses
/// a second live connection for a slot it already holds, so a near-simultaneous loser cannot
/// displace the winner. Every candidate handshakes against the same pinned certificate and
/// server name, so the race picks which *address* wins, never which identity is trusted.
///
/// Returns the link and the address that won (so a later reconnect redials the address that
/// demonstrably works for this client rather than re-running the race); errors only once every
/// candidate has failed with no redial pending, reporting the failure that says the most — one
/// where the network answered over a bare deadline expiry.
async fn connect_relay(
    endpoint: &ClientEndpoint,
    relay: &RelayTarget,
    identity: &Identity,
) -> Result<(Link, SocketAddr), SessionError> {
    connect_relay_with_timing(
        endpoint,
        relay,
        identity,
        DIAL_RETRY_WINDOW,
        DIAL_RETRY_BACKOFF,
    )
    .await
}

/// [`connect_relay`] with the retry timing as parameters, so tests can run the race against
/// short windows instead of the production ~30s.
async fn connect_relay_with_timing(
    endpoint: &ClientEndpoint,
    relay: &RelayTarget,
    identity: &Identity,
    retry_window: Duration,
    retry_backoff: Duration,
) -> Result<(Link, SocketAddr), SessionError> {
    let retry_cutoff = tokio::time::Instant::now() + retry_window;
    // `delay` lets a redial carry its own rest into the race: a resting redial is just another
    // in-flight future, so the select needs no separate retry queue.
    let dial = |addr: SocketAddr, delay: Duration| async move {
        tokio::time::sleep(delay).await;
        match endpoint.connect(addr, &relay.server_name, identity).await {
            Ok(link) => Ok((link, addr)),
            Err(e) => Err((addr, e)),
        }
    };
    let mut in_flight = FuturesUnordered::new();
    // `RelayTarget::addrs` is guaranteed non-empty by `resolve_relay`.
    in_flight.push(dial(relay.addrs[0], Duration::ZERO));
    let mut next_idx = 1;
    let stagger = tokio::time::sleep(DIAL_STAGGER);
    tokio::pin!(stagger);
    // The failures kept for the race's last word, split by how much they say: a failure where
    // the network answered (`last_answered`) names how the far side behaved, while a bare
    // deadline expiry (`last_timeout`) only says nothing did — and a black-holed family's
    // timeout tends to be the *latest* failure precisely because it takes the longest, so
    // "most recent" alone would routinely bury the informative one.
    let mut last_answered: Option<DialError> = None;
    let mut last_timeout: Option<DialError> = None;
    // Invariant: `in_flight` is non-empty at the top of every iteration (a failure either starts
    // another dial — the next candidate, its own redial — or, with none left in flight, returns),
    // so the select always has a live branch.
    loop {
        tokio::select! {
            Some(result) = in_flight.next() => match result {
                Ok(won) => return Ok(won),
                Err((addr, e)) => {
                    debug!("netcode v2 dial to {addr} failed: {}", error_with_root_cause(&e));
                    if next_idx < relay.addrs.len() {
                        // A candidate failing outright is a stronger signal than the stagger
                        // elapsing: start the next one now and push the stagger out behind it.
                        in_flight.push(dial(relay.addrs[next_idx], Duration::ZERO));
                        next_idx += 1;
                        stagger.as_mut().reset(tokio::time::Instant::now() + DIAL_STAGGER);
                    }
                    if dial_worth_retrying(&e)
                        && tokio::time::Instant::now() + retry_backoff < retry_cutoff
                    {
                        in_flight.push(dial(addr, retry_backoff));
                    }
                    match e {
                        DialError::TimedOut { .. } => last_timeout = Some(e),
                        _ => last_answered = Some(e),
                    }
                    if in_flight.is_empty() {
                        // This failure emptied the race — nothing left worth retrying, or the
                        // retry window has closed — so the race reports its most informative
                        // failure.
                        let e = last_answered
                            .or(last_timeout)
                            .expect("a failure just emptied the race");
                        return Err(SessionError::Dial(e));
                    }
                }
            },
            _ = stagger.as_mut(), if next_idx < relay.addrs.len() => {
                in_flight.push(dial(relay.addrs[next_idx], Duration::ZERO));
                next_idx += 1;
                stagger.as_mut().reset(tokio::time::Instant::now() + DIAL_STAGGER);
            }
        }
    }
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
/// `true` means the report was handed to a relay driver. `false` means there is no relay driver —
/// a solo game (whose sessionless turn state has no relay to deliver over), or a replay (no turn
/// state at all), or the re-entrant-lock case (which can't actually happen here, since this fires
/// from the async result handler well off the turn hooks, but is warned rather than silently
/// mis-reporting). A `false` return means no one reports this game's result; a sessionless
/// single-human game is results-exempt by design.
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
            // A sessionless solo game has no relay to deliver over, so it does not take the report
            // and no one reports its result.
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

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, Ipv6Addr, UdpSocket};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    use rally_point_client::proto::handshake;
    use rally_point_client::proto::token::{CHALLENGE_LEN, SIGNATURE_LEN};
    use rally_point_client::transport::rustls::RootCertStore;
    use rally_point_client::transport::rustls::pki_types::{CertificateDer, PrivateKeyDer};
    use rally_point_client::transport::{quic, quinn};

    use super::*;

    /// Runs one relay-side authorization handshake against the client's
    /// [`ClientEndpoint::connect`]: accept the client's bidirectional stream, read
    /// (and discard) the token frame, answer with a dummy challenge, read (and
    /// discard) the signature and resume-cursor frame, then acknowledge. It
    /// validates nothing — the race under test decides which *address* wins, not
    /// which identity is trusted — so the challenge bytes are arbitrary and the
    /// signature is never checked.
    ///
    /// Returns the still-open handshake streams so the caller can keep them (and
    /// thus the connection) alive.
    async fn run_relay_handshake(
        conn: &quinn::Connection,
    ) -> Result<(quinn::SendStream, quinn::RecvStream), Box<dyn std::error::Error + Send + Sync>>
    {
        let (mut send, mut recv) = conn.accept_bi().await?;

        // Token frame: a u16-LE length prefix, then that many token bytes.
        let mut len_buf = [0u8; handshake::TOKEN_LEN_PREFIX_LEN];
        recv.read_exact(&mut len_buf).await?;
        let token_len = handshake::decode_token_len(len_buf)?;
        let mut token = vec![0u8; token_len];
        recv.read_exact(&mut token).await?;

        // The relay's connection-binding challenge. The client signs whatever we
        // send, and we never verify the result, so the bytes here are arbitrary.
        send.write_all(&[0u8; CHALLENGE_LEN]).await?;

        // The client's 64-byte challenge signature, discarded.
        let mut signature = [0u8; SIGNATURE_LEN];
        recv.read_exact(&mut signature).await?;

        // Resume-cursor frame: a u16-LE entry count, then that many fixed-width
        // `(slot, cursor)` entries. A fresh dial sends a zero count; read it
        // generally so a non-empty frame would drain correctly too.
        let mut count_buf = [0u8; handshake::RESUME_CURSOR_COUNT_PREFIX_LEN];
        recv.read_exact(&mut count_buf).await?;
        let count = handshake::decode_resume_cursor_count(count_buf)?;
        for _ in 0..count {
            let mut entry = [0u8; handshake::RESUME_CURSOR_ENTRY_LEN];
            recv.read_exact(&mut entry).await?;
        }

        // Acknowledge the connection as routable — the byte the client waits for.
        send.write_all(&[handshake::HANDSHAKE_OK]).await?;

        Ok((send, recv))
    }

    /// Spawns a fake relay: a QUIC server on a loopback IPv4 port that completes the
    /// authorization handshake for every incoming connection and then holds each
    /// connection open, so a winning client's [`Link`] stays usable. Returns the
    /// address to dial, the self-signed leaf certificate to pin, and the endpoint —
    /// which the caller keeps alive for as long as the relay must answer.
    async fn spawn_fake_relay() -> (SocketAddr, CertificateDer<'static>, quinn::Endpoint) {
        spawn_fake_relay_refusing(0).await
    }

    /// [`spawn_fake_relay`], but the first `refuse_first` connections are refused the
    /// way a real relay refuses authorization: the QUIC handshake completes, then the
    /// relay closes the connection without answering the authorization exchange.
    /// `usize::MAX` refuses every connection.
    async fn spawn_fake_relay_refusing(
        refuse_first: usize,
    ) -> (SocketAddr, CertificateDer<'static>, quinn::Endpoint) {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()]).unwrap();
        let cert_der = cert.cert.der().clone();
        let key_der = PrivateKeyDer::try_from(cert.signing_key.serialize_der()).unwrap();
        let server_config = quic::server_config(vec![cert_der.clone()], key_der).unwrap();

        let bind: SocketAddr = (Ipv4Addr::LOCALHOST, 0).into();
        let endpoint = quinn::Endpoint::server(server_config, bind).unwrap();
        let addr = endpoint.local_addr().unwrap();

        let refusals_left = Arc::new(AtomicUsize::new(refuse_first));
        let accept_endpoint = endpoint.clone();
        tokio::spawn(async move {
            while let Some(incoming) = accept_endpoint.accept().await {
                let refusals_left = refusals_left.clone();
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else {
                        return;
                    };
                    let refuse = refusals_left
                        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                        .is_ok();
                    if refuse {
                        conn.close(quinn::VarInt::from_u32(1), b"refused");
                        return;
                    }
                    let Ok(_streams) = run_relay_handshake(&conn).await else {
                        return;
                    };
                    // Hold the connection and its handshake streams open for the
                    // rest of the test; nothing here ever closes them.
                    std::future::pending::<()>().await;
                });
            }
        });

        (addr, cert_der, endpoint)
    }

    /// A dual-stack client endpoint (the production bind) trusting exactly `cert`.
    fn client_endpoint(cert: &CertificateDer<'static>) -> ClientEndpoint {
        let mut roots = RootCertStore::empty();
        roots.add(cert.clone()).unwrap();
        credentials::bind_endpoint(roots).expect("client endpoint binds")
    }

    /// A relay target for `addrs` whose TLS server name matches the fake relay's
    /// `localhost` certificate.
    fn relay_target(addrs: Vec<SocketAddr>) -> RelayTarget {
        RelayTarget {
            addrs,
            server_name: "localhost".to_owned(),
        }
    }

    #[tokio::test]
    async fn a_black_holed_preferred_candidate_loses_to_the_staggered_fallback() {
        let (relay_addr, cert, _relay_endpoint) = spawn_fake_relay().await;
        let endpoint = client_endpoint(&cert);
        let identity = credentials::test_identity();

        // A v6 socket we bind and never read from: packets to it are swallowed, so
        // a dial to it can neither complete nor error until its own ~10s deadline —
        // a black-holed route. Held open for the whole test so the port stays bound
        // (a closed port would bounce the dial with an error and fail it fast).
        let silent = UdpSocket::bind((Ipv6Addr::LOCALHOST, 0)).unwrap();
        let silent_addr = silent.local_addr().unwrap();

        // Preference order: the black-holed v6 candidate first, the working v4 relay
        // second.
        let relay = relay_target(vec![silent_addr, relay_addr]);

        let start = Instant::now();
        let (_link, winner) = connect_relay(&endpoint, &relay, &identity)
            .await
            .expect("the staggered v4 candidate wins the race");
        let elapsed = start.elapsed();

        assert_eq!(winner, relay_addr, "the working v4 candidate must win");
        assert!(
            elapsed >= DIAL_STAGGER,
            "the preferred candidate gets its full head start before the fallback \
             starts, and it can never complete, so the win cannot precede the \
             stagger (elapsed {elapsed:?})",
        );
        assert!(
            elapsed < Duration::from_secs(5),
            "the stagger must rescue the dial well before the ~10s dial deadline \
             (elapsed {elapsed:?})",
        );

        // The silent socket must outlive the dial so its port stays black-holed.
        drop(silent);
    }

    #[tokio::test]
    async fn an_outright_failure_advances_to_the_next_candidate_at_once() {
        let (relay_addr, cert, _relay_endpoint) = spawn_fake_relay().await;
        let endpoint = client_endpoint(&cert);
        let identity = credentials::test_identity();

        // Port 0 is an invalid remote: `quinn::Endpoint::connect` rejects it inside
        // `connect` itself, before any wait, so this candidate fails outright rather
        // than stalling — which advances the race to the next candidate immediately
        // instead of after the stagger.
        let dead: SocketAddr = (Ipv4Addr::LOCALHOST, 0).into();
        let relay = relay_target(vec![dead, relay_addr]);

        let start = Instant::now();
        let (_link, winner) = connect_relay(&endpoint, &relay, &identity)
            .await
            .expect("the second candidate wins after the first fails fast");
        let elapsed = start.elapsed();

        assert_eq!(winner, relay_addr);
        // Advancing on an outright failure skips the stagger, so the dial completes
        // in about a handshake. The bound stays generous against machine noise;
        // the point is that it does not wait the stagger out.
        assert!(
            elapsed < Duration::from_secs(2),
            "advancing on failure should not wait out the stagger (elapsed {elapsed:?})",
        );
    }

    #[tokio::test]
    async fn every_candidate_failing_returns_a_dial_error() {
        let endpoint =
            credentials::bind_endpoint(RootCertStore::empty()).expect("client endpoint binds");
        let identity = credentials::test_identity();

        // Two invalid remotes (port 0): both are rejected synchronously in
        // `connect`, so the race exhausts its candidates and reports the last
        // failure rather than hanging.
        let dead_a: SocketAddr = (Ipv4Addr::LOCALHOST, 0).into();
        let dead_b: SocketAddr = (Ipv4Addr::new(127, 0, 0, 2), 0).into();
        let relay = relay_target(vec![dead_a, dead_b]);

        let start = Instant::now();
        let result = connect_relay(&endpoint, &relay, &identity).await;
        let elapsed = start.elapsed();

        assert!(
            matches!(result, Err(SessionError::Dial(_))),
            "every candidate failing must yield a Dial error",
        );
        assert!(
            elapsed < Duration::from_secs(1),
            "synchronous failures should return promptly (elapsed {elapsed:?})",
        );
    }

    #[tokio::test]
    async fn a_single_candidate_connects() {
        let (relay_addr, cert, _relay_endpoint) = spawn_fake_relay().await;
        let endpoint = client_endpoint(&cert);
        let identity = credentials::test_identity();

        let relay = relay_target(vec![relay_addr]);

        let (_link, winner) = connect_relay(&endpoint, &relay, &identity)
            .await
            .expect("the sole candidate connects");
        assert_eq!(winner, relay_addr);
    }

    #[tokio::test]
    async fn a_refused_dial_is_redialed_until_it_succeeds() {
        // The relay refuses the first two connections after their QUIC handshakes —
        // the shape of an authorization refusal, which on a fresh dial is
        // indistinguishable from a transient one — then serves normally.
        let (relay_addr, cert, _relay_endpoint) = spawn_fake_relay_refusing(2).await;
        let endpoint = client_endpoint(&cert);
        let identity = credentials::test_identity();

        let relay = relay_target(vec![relay_addr]);

        let backoff = Duration::from_millis(100);
        let start = Instant::now();
        let (_link, winner) = connect_relay_with_timing(
            &endpoint,
            &relay,
            &identity,
            Duration::from_secs(20),
            backoff,
        )
        .await
        .expect("the third attempt connects");
        let elapsed = start.elapsed();

        assert_eq!(winner, relay_addr);
        assert!(
            elapsed >= 2 * backoff,
            "two refusals rest out two backoffs before the winning attempt \
             (elapsed {elapsed:?})",
        );
        assert!(
            elapsed < Duration::from_secs(10),
            "the redials must succeed promptly, not ride out a dial deadline \
             (elapsed {elapsed:?})",
        );
    }

    #[tokio::test]
    async fn redials_stop_when_the_retry_window_closes() {
        // A relay that refuses every connection: each attempt fails fast, so the race
        // keeps redialing until the window closes, then reports the refusal.
        let (relay_addr, cert, _relay_endpoint) = spawn_fake_relay_refusing(usize::MAX).await;
        let endpoint = client_endpoint(&cert);
        let identity = credentials::test_identity();

        let relay = relay_target(vec![relay_addr]);

        let start = Instant::now();
        let result = connect_relay_with_timing(
            &endpoint,
            &relay,
            &identity,
            Duration::from_millis(500),
            Duration::from_millis(100),
        )
        .await;
        let elapsed = start.elapsed();

        let Err(SessionError::Dial(e)) = result else {
            panic!("every attempt refused must yield a Dial error");
        };
        assert!(
            !matches!(e, DialError::TimedOut { .. }),
            "the reported failure must be the relay's refusal, not a bare deadline \
             expiry (got: {e})",
        );
        assert!(
            elapsed < Duration::from_secs(5),
            "the race must conclude promptly once the window closes (elapsed {elapsed:?})",
        );
    }

    /// A two-level error whose display hides its source, exercising the root-cause
    /// append; [`TransparentOuter`]'s display *includes* its source, exercising the
    /// skip.
    #[derive(Debug, thiserror::Error)]
    #[error("outer failed")]
    struct OpaqueOuter(#[source] std::io::Error);

    #[derive(Debug, thiserror::Error)]
    #[error("outer failed: {0}")]
    struct TransparentOuter(#[source] std::io::Error);

    #[test]
    fn root_cause_is_appended_only_when_hidden() {
        let hidden = OpaqueOuter(std::io::Error::other("inner detail"));
        assert_eq!(
            error_with_root_cause(&hidden),
            "outer failed (inner detail)"
        );

        let shown = TransparentOuter(std::io::Error::other("inner detail"));
        assert_eq!(error_with_root_cause(&shown), "outer failed: inner detail");

        let sourceless = std::io::Error::other("just this");
        assert_eq!(error_with_root_cause(&sourceless), "just this");
    }
}
