//! Debug/verification control surface for the game DLL.
//!
//! This entire module — and its dispatch arms in `app_socket` / `game_state` — is compiled out of
//! release DLLs via `#[cfg(debug_assertions)]`. Anything that lets the app (or, transitively, any
//! external tooling talking to the app) query or drive a running game session MUST live here and
//! nowhere else: keeping the whole risky surface in one module makes it trivially auditable, and
//! more importantly means a release build simply does not contain the code. A runtime `if
//! cfg!(debug_assertions)` guard would NOT be sufficient — the code would still ship in the
//! release binary and remain a viable patch target for anyone willing to flip the check in-memory.

use serde::{Deserialize, Serialize};

use crate::app_messages::SbUserId;

/// Commands the app can send down the `debugControl` websocket command (debug builds only).
#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DebugControlCommand {
    /// Round-trip liveness probe; the DLL replies on `/game/debug/pong`.
    Ping,
    /// Snapshot the current netcode-v2 turn state; the DLL replies on `/game/debug/state` with a
    /// [`DebugStateResponse`].
    QueryState,
}

/// Reply payload for [`DebugControlCommand::QueryState`], sent on `/game/debug/state`.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStateResponse {
    /// `None` when no netcode v2 session is live (native/legacy transport, or the turn state is gone).
    pub turn_state: Option<TurnStateSnapshot>,
}

/// A point-in-time read of [`crate::netcode_v2::TurnState`], for verification tooling.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStateSnapshot {
    /// This client's own rp2 slot.
    pub local_slot: u8,
    /// The latency buffer (in turns) currently in force.
    pub latency_turns: u32,
    /// Local turns handed to the driver but not yet executed by the sim.
    pub outstanding_turns: u32,
    /// One entry per session-roster slot.
    pub slots: Vec<TurnSlotSnapshot>,
}

/// Per-slot detail within a [`TurnStateSnapshot`].
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSlotSnapshot {
    /// The rally-point2 slot this entry describes.
    pub slot: u8,
    /// The SB user occupying this slot, per the session roster.
    pub user_id: SbUserId,
    /// The BW storm id this slot maps to. `None` until the slot↔storm mapping solidifies during
    /// join (serialized as `null`, never omitted, so the app can distinguish "not yet mapped"
    /// from "field absent").
    pub storm_id: Option<u8>,
    /// Whether this slot currently gates step readiness; cleared by a synced leave.
    pub required: bool,
    /// Inbound FIFO depth for this slot's storm id.
    pub queued_turns: usize,
    /// Whether a turn for this slot is currently sitting in the dispatch buffers.
    pub has_dispatch: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_state_command_parses_camel_case() {
        let cmd: DebugControlCommand = serde_json::from_str(r#"{"type":"queryState"}"#).unwrap();
        assert_eq!(cmd, DebugControlCommand::QueryState);
    }

    #[test]
    fn state_response_serializes_camel_case_with_null_storm_id() {
        let response = DebugStateResponse {
            turn_state: Some(TurnStateSnapshot {
                local_slot: 0,
                latency_turns: 2,
                outstanding_turns: 1,
                slots: vec![TurnSlotSnapshot {
                    slot: 1,
                    user_id: SbUserId(22),
                    storm_id: None,
                    required: false,
                    queued_turns: 0,
                    has_dispatch: false,
                }],
            }),
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "turnState": {
                    "localSlot": 0,
                    "latencyTurns": 2,
                    "outstandingTurns": 1,
                    "slots": [{
                        "slot": 1,
                        "userId": 22,
                        "stormId": null,
                        "required": false,
                        "queuedTurns": 0,
                        "hasDispatch": false,
                    }],
                },
            })
        );
    }
}
