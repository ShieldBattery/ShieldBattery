//! Async-side setup for the netcode v2 turn transport: turning the stashed launch handoff
//! ([`NetcodeV2Setup`]) into a live QUIC session, and the global handoff by which the BW-thread
//! hooks reach the game-thread-owned [`TurnState`].
//!
//! [`establish_session`] runs on the DLL's Tokio runtime: it builds the pinned-trust credentials,
//! dials the home relay (falling back across its address families), spawns the
//! [`LinkDriver`] that services the link, and stores the resulting [`TurnState`] where the three BW
//! hooks (installed in `bw_scr.rs`) can reach it via [`with_turn_state`]. With no live session the
//! hooks find nothing here and fall through to the native transport.

use quick_error::quick_error;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::transport::Link;
use rally_point_client::{ClientEndpoint, DialError, Identity, LinkDriver};

use super::TurnState;
use super::credentials::{self, CredentialError, RelayTarget, SessionCredentials};
use crate::app_messages::NetcodeV2Setup;
use crate::recurse_checked_mutex::Mutex;

/// The latency floor to start the pipe at (the built-in latency is natively 2). A due
/// [`BufferDirective`](rally_point_client::proto::messages::BufferDirective) from the relay resizes
/// it from there.
const INITIAL_LATENCY_TURNS: u32 = 2;

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
/// Holds the QUIC endpoint alive for the whole session (it owns the UDP socket the link runs on)
/// and the game-thread-owned [`TurnState`] the three BW hooks operate on.
pub struct NetcodeV2Session {
    /// Keeps the client endpoint — and thus its UDP socket — alive for the session's lifetime; the
    /// link the driver runs on borrows from it. Never touched again after construction.
    _endpoint: ClientEndpoint,
    turn_state: TurnState,
}

/// The current game's session, reached from the BW/sync thread via [`with_turn_state`] and created on the
/// async thread by [`establish_session`]. Recurse-checked so a hook that re-enters (the IN hook's
/// leave pass can reach the OUT hook) gets `None` instead of deadlocking — but the lock discipline
/// is to not hold it across such calls in the first place.
static SESSION: Mutex<Option<NetcodeV2Session>> = Mutex::new(None);

/// Builds the QUIC session from the launch handoff and stores it for the hooks. Call on the Tokio
/// runtime (it dials and spawns the driver). Replaces any previous session.
pub async fn establish_session(setup: &NetcodeV2Setup) -> Result<(), SessionError> {
    let SessionCredentials {
        identity,
        home,
        roots,
    } = SessionCredentials::from_setup(setup)?;
    // The slot is the one the coordinator signed into the token, not a separately-sent value.
    let local_slot = identity.token().claims.slot;
    let endpoint = credentials::bind_endpoint(roots)?;

    // Dial the home relay, trying its candidate addresses in preference order (v6 then v4).
    let link = connect_relay(&endpoint, &home, &identity).await?;

    let (driver, channels) = LinkDriver::new(link);
    // Service the link on the DLL's async runtime. `run` returning `Err` means the link failed,
    // which is effectively this player dropping; reconnect/failover is deferred, so for now the
    // session just ends and the hooks stop finding a turn state (the caller falls back to native).
    tokio::spawn(async move {
        match driver.run().await {
            Ok(()) => debug!("netcode v2 link closed cleanly"),
            Err(e) => error!("netcode v2 link failed: {e}"),
        }
    });

    let roster = setup
        .roster
        .iter()
        .map(|entry| (SlotId(entry.slot), entry.user_id))
        .collect();
    let turn_state = TurnState::new(channels, local_slot, INITIAL_LATENCY_TURNS, roster);
    if let Some(mut guard) = SESSION.lock() {
        *guard = Some(NetcodeV2Session {
            _endpoint: endpoint,
            turn_state,
        });
    }
    Ok(())
}

/// Dials one relay, trying its candidate addresses in preference order (v6 then v4, per
/// [`RelayTarget`]). Returns on the first address that connects; errors only if all of them fail.
async fn connect_relay(
    endpoint: &ClientEndpoint,
    relay: &RelayTarget,
    identity: &Identity,
) -> Result<Link, SessionError> {
    let mut last_err = None;
    for &addr in &relay.addrs {
        match endpoint.connect(addr, &relay.server_name, identity).await {
            Ok(link) => return Ok(link),
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
/// Returns `None` when there is no active netcode v2 session (the legacy transport path) or when
/// the turn-state mutex is already held by this thread — a re-entrant hook call, which the caller
/// treats the same as "no turn state" and falls back to native behavior. Keep `f` short: it runs
/// with the BW sync thread holding the lock, and it must not call back into native code that can
/// re-enter a turn hook (see the IN-hook lock discipline in the module docs).
pub fn with_turn_state<R>(f: impl FnOnce(&mut TurnState) -> R) -> Option<R> {
    let mut guard = SESSION.lock()?;
    let session = guard.as_mut()?;
    Some(f(&mut session.turn_state))
}

/// Transitions the current game's turn state to local-only for a locally-decided game (see
/// [`TurnState::begin_local_only`]).
///
/// Unlike [`with_turn_state`], this distinguishes its two `None` cases instead of collapsing them:
/// no live session (legacy game or replay — the hooks never find a turn state here either) stays a
/// silent no-op, but the lock already held re-entrantly is warned, because this call fires from the
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

/// Hands the current game's serialized end-of-game result report to the driver, which delivers it
/// over the relay's reliable control stream (see [`TurnState::submit_result_report`]). Returns
/// whether a live netcode v2 session took the report.
///
/// `true` means the report was handed to the driver and the caller must NOT also POST it over HTTP.
/// `false` means there is no v2 session (a legacy game or replay), and the caller falls back to the
/// HTTP result path — the same fallback taken on the re-entrant-lock case, which can't actually
/// happen here (this fires from the async result handler, well off the turn hooks) but is warned
/// rather than silently dropping the report.
pub fn submit_result_report(report: Vec<u8>) -> bool {
    let Some(mut guard) = SESSION.lock() else {
        warn!("submit_result_report skipped: turn state locked re-entrantly");
        return false;
    };
    match guard.as_mut() {
        Some(session) => {
            session.turn_state.submit_result_report(report);
            true
        }
        None => false,
    }
}

/// Tears down the current session (game over / teardown). Idempotent.
pub fn clear_session() {
    if let Some(mut guard) = SESSION.lock() {
        *guard = None;
    }
}
