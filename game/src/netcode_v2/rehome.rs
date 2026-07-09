//! The DLL's [`RehomeProvider`]: SB-server-mediated relay failover for an in-game session.
//!
//! When the home relay's process dies it comes back with a fresh keypair, and the client's
//! fail-closed pinned-cert trust refuses it forever — so a same-relay retry can never succeed. The
//! `rally-point-client` driver escalates that case to this provider, which asks the **ShieldBattery
//! server** (not the coordinator directly) to re-home the session: `POST
//! /api/1/games/:gameId/netcodeV2Rehome`. The server is the only party that talks to the
//! coordinator (tenant-signed, exactly as at session create); it verifies the request the same way
//! the results/replay endpoints do — the caller proves it's the slot's owner by presenting the
//! `resultCode` the server minted for this (game, user). The server does the coordinator round trip
//! and, for a move, hands back the replacement relay as the standard [`NetcodeV2Relay`] shape
//! (address + pinned cert + TLS server name), so this provider consumes it through the *same*
//! credential path the home relay's descriptor went through at session establish.
//!
//! No client-held coordinator credentials, no signing: the SB endpoint's `resultCode` auth is the
//! whole trust story on the client side.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rally_point_client::{RehomeFuture, RehomeOutcome, RehomeProvider};
use reqwest::header::ORIGIN;
use serde::{Deserialize, Serialize};

use super::credentials;
use crate::app_messages::{NetcodeV2Relay, SbUserId};

/// The `ORIGIN` header the game process stamps on its server API calls (matches
/// `api_request_headers` in `game_state.rs`); the SB API distinguishes game-client requests by it.
const GAME_ORIGIN: &str = "shieldbattery://game";

/// The SB-server round-trip timeout. Must cover the server's own coordinator round trip (the SB
/// service gives the coordinator 10s), so the DLL doesn't bail — and let the driver re-escalate a
/// duplicate — before the server can even answer. Still comfortably under BW's native stall-drop so
/// a genuinely hung server degrades to `Unavailable` rather than wedging failover.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);

/// Minimum spacing between failure warnings, so a server/coordinator that keeps failing (re-asked
/// on the driver's escalation cadence) doesn't spam the log.
const WARN_INTERVAL: Duration = Duration::from_secs(30);

/// The launch-time context the re-home provider authenticates its SB-server requests with — the
/// same (gameId, userId, resultCode) triple the results/replay submission uses, plus the server's
/// base URL. `result_code` is `None` for a game the server never assigned one to; re-home is
/// disabled in that case (nothing to authenticate with).
pub struct RehomeContext {
    pub server_url: String,
    pub game_id: String,
    pub user_id: SbUserId,
    pub result_code: Option<String>,
}

/// The `POST /api/1/games/:gameId/netcodeV2Rehome` request body (JSON, camelCase). Mirrors the
/// results/replay endpoints' `userId` + `resultCode` auth pair, plus the relay this client believes
/// dead.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RehomeRequest<'a> {
    user_id: u32,
    result_code: &'a str,
    dead_relay_id: u64,
}

/// The `POST /api/1/games/:gameId/netcodeV2Rehome` response body (JSON, camelCase). The server
/// hands back the replacement relay as the very same [`NetcodeV2Relay`] descriptor shape the launch
/// handoff carried for the home relay (`relayId`/`address4`/`address6`/`port`/`serverName`/`cert`),
/// so a move reuses the home-relay credential path verbatim.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RehomeResponse {
    decision: String,
    #[serde(default)]
    relay: Option<NetcodeV2Relay>,
}

/// A re-home response validated down to the branch the driver acts on. Kept separate from the
/// (impure) endpoint build so the decision mapping is unit-testable without the network.
#[derive(Debug)]
enum RehomeDecision {
    Stay,
    Unavailable,
    /// Move to the replacement relay this descriptor names.
    NewTarget(NetcodeV2Relay),
}

/// Maps a decoded response to a decision. A `newTarget` missing its relay descriptor degrades to
/// `Unavailable` (better to keep retrying than to act on nothing), as does any decision string this
/// client doesn't recognize.
fn decision_from_response(resp: RehomeResponse) -> RehomeDecision {
    match resp.decision.as_str() {
        "stay" => RehomeDecision::Stay,
        "newTarget" => match resp.relay {
            Some(relay) => RehomeDecision::NewTarget(relay),
            None => RehomeDecision::Unavailable,
        },
        // "unavailable", or anything the server/coordinator adds later that this client doesn't know.
        _ => RehomeDecision::Unavailable,
    }
}

/// The SB-server-mediated [`RehomeProvider`] the driver calls when its home relay looks dead.
pub(crate) struct ServerRehome {
    /// `{server_url}/api/1/games/{game_id}/netcodeV2Rehome`, built once.
    url: String,
    user_id: u32,
    result_code: String,
    http: reqwest::Client,
    /// When the last failure warning was emitted, for rate limiting (see [`WARN_INTERVAL`]).
    last_warn: Mutex<Option<Instant>>,
}

impl ServerRehome {
    /// `dead_relay_id` is supplied by the driver, which now owns the current-relay identity: it's
    /// the relay the driver was homed on when the link died, so this provider no longer guesses it.
    async fn do_rehome(&self, dead_relay_id: u64) -> RehomeOutcome {
        info!(
            "netcode v2 re-home: asking the server to move the session off relay {dead_relay_id}"
        );

        let request = RehomeRequest {
            user_id: self.user_id,
            result_code: &self.result_code,
            dead_relay_id,
        };
        let response = match self
            .http
            .post(&self.url)
            .header(ORIGIN, GAME_ORIGIN)
            .json(&request)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                self.warn_rate_limited(&format!("re-home request failed: {err}"));
                return RehomeOutcome::Unavailable;
            }
        };
        if !response.status().is_success() {
            self.warn_rate_limited(&format!("re-home returned HTTP {}", response.status()));
            return RehomeOutcome::Unavailable;
        }
        let body: RehomeResponse = match response.json().await {
            Ok(body) => body,
            Err(err) => {
                self.warn_rate_limited(&format!("re-home response was malformed: {err}"));
                return RehomeOutcome::Unavailable;
            }
        };

        match decision_from_response(body) {
            RehomeDecision::Stay => {
                info!("netcode v2 re-home: server says relay {dead_relay_id} is still live");
                RehomeOutcome::Stay
            }
            RehomeDecision::Unavailable => {
                info!("netcode v2 re-home: no relay can take the session over yet");
                RehomeOutcome::Unavailable
            }
            RehomeDecision::NewTarget(relay) => {
                let relay_id = relay.relay_id;
                // Build the replacement's endpoint + dial target through the same fail-closed pinning
                // path the home relay's descriptor went through at session establish.
                let (endpoint, target) = match credentials::endpoint_for_relay(&relay) {
                    Ok(built) => built,
                    Err(err) => {
                        self.warn_rate_limited(&format!(
                            "re-home replacement relay {relay_id} could not be prepared: {err}"
                        ));
                        return RehomeOutcome::Unavailable;
                    }
                };
                // The re-home descriptor names one address (the coordinator's single relay_addr,
                // converted to one family server-side), so `resolve_relay` yields exactly one entry;
                // take the first as the dial target.
                let Some(relay_addr) = target.addrs.into_iter().next() else {
                    self.warn_rate_limited(&format!(
                        "re-home replacement relay {relay_id} had no dial address"
                    ));
                    return RehomeOutcome::Unavailable;
                };
                info!("netcode v2 re-home: moving the session to relay {relay_id} at {relay_addr}");
                // The driver adopts `relay_id` as its new current relay, so a later death names the
                // replacement rather than the original — no DLL-side current-relay tracking.
                RehomeOutcome::NewTarget {
                    relay_id,
                    endpoint,
                    relay_addr,
                    server_name: target.server_name,
                }
            }
        }
    }

    /// Emits a warning at most once per [`WARN_INTERVAL`], swallowing the rest so a persistently
    /// failing server (re-asked every escalation cycle) can't flood the log.
    fn warn_rate_limited(&self, message: &str) {
        let mut last = self.last_warn.lock().expect("rehome warn mutex poisoned");
        let now = Instant::now();
        if last.is_none_or(|prev| now.duration_since(prev) >= WARN_INTERVAL) {
            *last = Some(now);
            warn!("netcode v2 {message}");
        }
    }
}

impl RehomeProvider for ServerRehome {
    fn rehome(&self, dead_relay_id: u64) -> RehomeFuture<'_> {
        Box::pin(async move { self.do_rehome(dead_relay_id).await })
    }
}

/// Builds the re-home provider from the launch context, or `None` when re-home is disabled — no
/// `resultCode` to authenticate the SB-server request with (a game the server assigned none to).
/// The driver supplies the dead relay id at call time (it owns the current-relay identity), so this
/// no longer needs the home relay id.
pub(crate) fn build_provider(context: &RehomeContext) -> Option<Arc<dyn RehomeProvider>> {
    let result_code = context.result_code.clone()?;
    let url = format!(
        "{}/api/1/games/{}/netcodeV2Rehome",
        context.server_url, context.game_id
    );
    Some(Arc::new(ServerRehome {
        url,
        user_id: context.user_id.0,
        result_code,
        http: reqwest::Client::new(),
        last_warn: Mutex::new(None),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response(json: &str) -> RehomeResponse {
        serde_json::from_str(json).expect("test response should deserialize")
    }

    #[test]
    fn stay_decision_maps_to_stay() {
        assert!(matches!(
            decision_from_response(response(r#"{"decision":"stay"}"#)),
            RehomeDecision::Stay
        ));
    }

    #[test]
    fn unavailable_decision_maps_to_unavailable() {
        assert!(matches!(
            decision_from_response(response(r#"{"decision":"unavailable"}"#)),
            RehomeDecision::Unavailable
        ));
    }

    #[test]
    fn unknown_decision_maps_to_unavailable() {
        assert!(matches!(
            decision_from_response(response(r#"{"decision":"somethingNew"}"#)),
            RehomeDecision::Unavailable
        ));
    }

    #[test]
    fn new_target_carries_the_relay_descriptor() {
        // The relay descriptor is the standard NetcodeV2RelayInfo shape (camelCase).
        let decision = decision_from_response(response(
            r#"{"decision":"newTarget","relay":{"relayId":9,"address4":"203.0.113.7","port":14900,"serverName":"relay.example","cert":"AAAA"}}"#,
        ));
        match decision {
            RehomeDecision::NewTarget(relay) => {
                assert_eq!(relay.relay_id, 9);
                assert_eq!(relay.address4.as_deref(), Some("203.0.113.7"));
                assert_eq!(relay.port, 14900);
                assert_eq!(relay.server_name, "relay.example");
                assert_eq!(relay.cert, "AAAA");
            }
            other => panic!("expected NewTarget, got {other:?}"),
        }
    }

    #[test]
    fn new_target_missing_relay_degrades_to_unavailable() {
        assert!(matches!(
            decision_from_response(response(r#"{"decision":"newTarget"}"#)),
            RehomeDecision::Unavailable
        ));
    }

    #[test]
    fn request_body_serializes_camel_case() {
        let body = serde_json::to_value(RehomeRequest {
            user_id: 5,
            result_code: "abc",
            dead_relay_id: 7,
        })
        .unwrap();
        assert_eq!(
            body,
            serde_json::json!({ "userId": 5, "resultCode": "abc", "deadRelayId": 7 })
        );
    }
}
