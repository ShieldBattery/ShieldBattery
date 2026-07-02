//! Async-side setup for the netcode v2 seam: turning the stashed launch handoff
//! ([`NetcodeV2Setup`]) into a live QUIC session, and the global handoff by which the BW-thread
//! hooks reach the game-thread-owned [`SeamState`].
//!
//! [`establish_session`] runs on the DLL's Tokio runtime: it builds the pinned-trust credentials,
//! dials the home relay (falling back across address families and to the backup relay), spawns the
//! [`LinkDriver`] that services the link, and stores the resulting [`SeamState`] where the three BW
//! hooks can reach it via [`with_seam`]. Nothing installs those hooks yet — until they do, a live
//! session simply sits here unused (the legacy transport still runs).

use quick_error::quick_error;
use rally_point_client::transport::Link;
use rally_point_client::{ClientEndpoint, DialError, Identity, LinkDriver};

use super::SeamState;
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
/// and the game-thread-owned [`SeamState`] the three BW hooks operate on.
pub struct NetcodeV2Session {
    /// Keeps the client endpoint — and thus its UDP socket — alive for the session's lifetime; the
    /// link the driver runs on borrows from it. Never touched again after construction.
    _endpoint: ClientEndpoint,
    seam: SeamState,
}

/// The current game's session, reached from the BW/sync thread via [`with_seam`] and created on the
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
        backup,
        roots,
    } = SessionCredentials::from_setup(setup)?;
    // The slot is the one the coordinator signed into the token, not a separately-sent value.
    let local_slot = identity.token().claims.slot;
    let endpoint = credentials::bind_endpoint(roots)?;

    // Dial the home relay; fall back to the backup only if the home relay is unreachable on every
    // one of its addresses. Surface the home relay's error if the backup also fails — it's the more
    // useful diagnostic.
    let link = match connect_relay(&endpoint, &home, &identity).await {
        Ok(link) => link,
        Err(home_err) => match &backup {
            Some(backup) => connect_relay(&endpoint, backup, &identity)
                .await
                .map_err(|_| home_err)?,
            None => return Err(home_err),
        },
    };

    let (driver, channels) = LinkDriver::new(link);
    // Service the link on the DLL's async runtime. `run` returning `Err` means the link failed,
    // which is effectively this player dropping; reconnect/failover is deferred, so for now the
    // session just ends and the hooks stop finding a seam (the caller falls back to native).
    tokio::spawn(async move {
        match driver.run().await {
            Ok(()) => debug!("netcode v2 link closed cleanly"),
            Err(e) => error!("netcode v2 link failed: {e}"),
        }
    });

    let seam = SeamState::new(channels, local_slot, INITIAL_LATENCY_TURNS);
    if let Some(mut guard) = SESSION.lock() {
        *guard = Some(NetcodeV2Session {
            _endpoint: endpoint,
            seam,
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

/// Runs `f` against the current game's [`SeamState`], if one is live.
///
/// Returns `None` when there is no active netcode v2 session (the legacy transport path) or when
/// the seam mutex is already held by this thread — a re-entrant hook call, which the caller treats
/// the same as "no seam" and falls back to native behavior. Keep `f` short: it runs with the BW
/// sync thread holding the lock, and it must not call back into native code that can re-enter a
/// seam hook (see the IN-hook lock discipline in the module docs).
pub fn with_seam<R>(f: impl FnOnce(&mut SeamState) -> R) -> Option<R> {
    let mut guard = SESSION.lock()?;
    let session = guard.as_mut()?;
    Some(f(&mut session.seam))
}

/// Tears down the current session (game over / teardown). Idempotent.
pub fn clear_session() {
    if let Some(mut guard) = SESSION.lock() {
        *guard = None;
    }
}
