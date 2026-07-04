//! Debug/verification control surface for the game DLL.
//!
//! This entire module — and its dispatch arms in `app_socket` / `game_state` — is compiled out of
//! release DLLs via `#[cfg(debug_assertions)]`. Anything that lets the app (or, transitively, any
//! external tooling talking to the app) query or drive a running game session MUST live here and
//! nowhere else: keeping the whole risky surface in one module makes it trivially auditable, and
//! more importantly means a release build simply does not contain the code. A runtime `if
//! cfg!(debug_assertions)` guard would NOT be sufficient — the code would still ship in the
//! release binary and remain a viable patch target for anyone willing to flip the check in-memory.

use serde::Deserialize;

/// Commands the app can send down the `debugControl` websocket command (debug builds only).
#[derive(Debug, Deserialize, Eq, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DebugControlCommand {
    /// Round-trip liveness probe; the DLL replies on `/game/debug/pong`.
    Ping,
}
