//! Debug/verification control surface for the game DLL.
//!
//! This entire module — and its dispatch arms in `app_socket` / `game_state` — is compiled out of
//! release DLLs via `#[cfg(debug_assertions)]`. Anything that lets the app (or, transitively, any
//! external tooling talking to the app) query or drive a running game session MUST live here and
//! nowhere else: keeping the whole risky surface in one module makes it trivially auditable, and
//! more importantly means a release build simply does not contain the code. A runtime `if
//! cfg!(debug_assertions)` guard would NOT be sufficient — the code would still ship in the
//! release binary and remain a viable patch target for anyone willing to flip the check in-memory.

use std::mem;
use std::ptr::null_mut;
use std::slice;

use base64::prelude::{BASE64_STANDARD, Engine as _};
use image::ImageEncoder;
use serde::{Deserialize, Serialize};
use winapi::shared::windef::{HGDIOBJ, RECT};
use winapi::um::wingdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BitBlt, CreateCompatibleDC, CreateDIBSection,
    DIB_RGB_COLORS, DeleteDC, DeleteObject, GdiFlush, RGBQUAD, SRCCOPY, SelectObject,
};
use winapi::um::winuser::{GetDC, GetWindowRect, PW_RENDERFULLCONTENT, PrintWindow, ReleaseDC};

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
    /// Force a synced leave of a mapped slot on THIS client. Writes the slot's
    /// `pending_leave_reason` on the game thread so the native synced-leave pass applies it like a
    /// real drop, and drops the slot from the readiness set so a stalled step can proceed.
    ForceLeave { slot: u8 },
    /// Deliberately diverge THIS client's simulation from its peers by adding a large amount to the
    /// local player's minerals on the game thread. A resource-state change that only one client
    /// makes desyncs BW's lockstep once the diverged value is spent or otherwise checked, so this is
    /// a trigger for observing how a desync propagates through the transport. No reply.
    ForceDesync,
    /// Capture this client's own game window via GDI/PrintWindow and reply on
    /// `/game/debug/screenshot` with a base64-encoded PNG.
    Screenshot,
    /// Send a chat message over the active netcode-v2 session as this client, through the same
    /// send path the in-game chat box uses: submit it to the relay's chat channel, then locally
    /// echo it so it renders immediately on this client too (see `bw_scr::send_chat_message`).
    /// `target` selects the receiver scope; omitted, it defaults to [`DebugChatTarget::All`]. No
    /// reply — verify via a peer's rendered chat, or this client's own via `queryState`'s
    /// `chatLog`.
    SendChat {
        text: String,
        #[serde(default)]
        target: DebugChatTarget,
    },
}

/// The chat scope for [`DebugControlCommand::SendChat`], a serde-friendly mirror of
/// [`crate::netcode_v2::ChatTarget`] (which isn't itself `Deserialize` — production code only
/// ever builds one from the in-game `MsgFltr` dialog's live state, never from JSON).
#[derive(Debug, Deserialize, Default, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DebugChatTarget {
    #[default]
    All,
    Allies,
    Observers,
    Player {
        slot: u8,
    },
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
    /// The last `CHAT_LOG_CAPACITY` chat lines this client has rendered (its own, and any peer's),
    /// oldest first. See [`crate::netcode_v2::TurnState::record_chat`].
    pub chat_log: Vec<DebugChatLogEntry>,
}

/// One rendered chat line, recorded at injection time for [`DebugControlCommand::QueryState`]
/// verification. Captures what the classic chat record actually carried, not the raw wire
/// message, so it reflects the sender id and text exactly as the overlay/replay saw them —
/// truncation included.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugChatLogEntry {
    /// The player id (0-7; see `bw_scr::chat::ChatManager::handle_message`'s player-id ranges)
    /// the message was attributed to.
    pub sender_game_id: u8,
    /// The message text as injected (already truncated to the classic chat record's capacity).
    pub text: String,
    /// Whether this client authored the message (`true`) or received it from a peer (`false`).
    pub own: bool,
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

/// Reply payload for [`DebugControlCommand::Screenshot`], sent on `/game/debug/screenshot`.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScreenshotResponse {
    /// `None` when capture failed; `error` then says why.
    pub screenshot: Option<DebugScreenshot>,
    pub error: Option<String>,
}

/// A single captured frame of the game window.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScreenshot {
    pub width: u32,
    pub height: u32,
    /// The captured frame, encoded as a base64 PNG.
    pub png_base64: String,
}

/// Captures this client's own game window and returns it as a PNG, or an error message
/// describing why the capture failed.
///
/// This is a blocking call meant to run on a worker thread (`tokio::task::spawn_blocking`), never
/// on the game thread: it only reads pixels back from the window through GDI/DWM and never
/// touches BW memory, unlike [`DebugControlCommand::ForceLeave`], which has to run on the game
/// thread to touch native state safely.
pub fn capture_screenshot() -> DebugScreenshotResponse {
    match try_capture_screenshot() {
        Ok(screenshot) => DebugScreenshotResponse {
            screenshot: Some(screenshot),
            error: None,
        },
        Err(message) => DebugScreenshotResponse {
            screenshot: None,
            error: Some(message),
        },
    }
}

fn try_capture_screenshot() -> Result<DebugScreenshot, String> {
    let hwnd = crate::forge::debug_window_handle()
        .ok_or_else(|| "game window not created yet".to_string())?;

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err(format!("GetWindowRect failed: {}", last_error()));
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return Err(format!(
            "game window has no visible area ({width}x{height})"
        ));
    }

    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            // Negative height requests a top-down DIB, so the pixel rows we read back are
            // already in top-to-bottom order.
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD {
            rgbBlue: 0,
            rgbGreen: 0,
            rgbRed: 0,
            rgbReserved: 0,
        }],
    };

    let mem_dc = unsafe { CreateCompatibleDC(null_mut()) };
    if mem_dc.is_null() {
        return Err(format!("CreateCompatibleDC failed: {}", last_error()));
    }
    scopeguard::defer! {
        unsafe { DeleteDC(mem_dc); }
    }

    let mut bits: *mut winapi::ctypes::c_void = null_mut();
    let bitmap = unsafe {
        CreateDIBSection(
            mem_dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            null_mut(),
            0,
        )
    };
    if bitmap.is_null() || bits.is_null() {
        return Err(format!("CreateDIBSection failed: {}", last_error()));
    }
    scopeguard::defer! {
        unsafe { DeleteObject(bitmap as HGDIOBJ); }
    }

    let previous_object = unsafe { SelectObject(mem_dc, bitmap as HGDIOBJ) };
    scopeguard::defer! {
        unsafe { SelectObject(mem_dc, previous_object); }
    }

    let printed = unsafe { PrintWindow(hwnd, mem_dc, PW_RENDERFULLCONTENT) };
    if printed == 0 {
        // Fall back to a plain BitBlt from the window's own DC. This won't capture
        // DWM-composited content correctly on all configurations, but it's better than nothing
        // if PrintWindow's newer flag isn't supported.
        let window_dc = unsafe { GetDC(hwnd) };
        if window_dc.is_null() {
            return Err("PrintWindow failed and GetDC fallback returned null".to_string());
        }
        scopeguard::defer! {
            unsafe { ReleaseDC(hwnd, window_dc); }
        }

        let blitted = unsafe { BitBlt(mem_dc, 0, 0, width, height, window_dc, 0, 0, SRCCOPY) };
        if blitted == 0 {
            return Err(format!(
                "PrintWindow and BitBlt fallback both failed: {}",
                last_error()
            ));
        }
    }

    unsafe { GdiFlush() };

    let width = width as u32;
    let height = height as u32;
    let pixel_count = (width as usize) * (height as usize);
    // Safety: `bits` was populated by `CreateDIBSection` for a top-down 32bpp DIB of exactly
    // `width * height` pixels, and `GdiFlush` above ensures the GDI writes into it are visible to
    // this thread before we read it back.
    let bgra = unsafe { slice::from_raw_parts(bits as *const u8, pixel_count * 4) };

    let mut rgba = Vec::with_capacity(bgra.len());
    for pixel in bgra.chunks_exact(4) {
        // 32bpp BI_RGB stores each pixel as B, G, R, then a fourth byte GDI leaves undefined, so
        // reorder to RGB and force full opacity rather than trusting that byte as alpha.
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 0xFF]);
    }

    let mut png_bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png_bytes)
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("PNG encode failed: {e}"))?;

    Ok(DebugScreenshot {
        width,
        height,
        png_base64: BASE64_STANDARD.encode(&png_bytes),
    })
}

fn last_error() -> std::io::Error {
    std::io::Error::last_os_error()
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
    fn force_leave_command_parses_camel_case_with_slot() {
        let cmd: DebugControlCommand =
            serde_json::from_str(r#"{"type":"forceLeave","slot":2}"#).unwrap();
        assert_eq!(cmd, DebugControlCommand::ForceLeave { slot: 2 });
    }

    #[test]
    fn force_desync_command_parses_camel_case() {
        let cmd: DebugControlCommand = serde_json::from_str(r#"{"type":"forceDesync"}"#).unwrap();
        assert_eq!(cmd, DebugControlCommand::ForceDesync);
    }

    #[test]
    fn screenshot_command_parses_camel_case() {
        let cmd: DebugControlCommand = serde_json::from_str(r#"{"type":"screenshot"}"#).unwrap();
        assert_eq!(cmd, DebugControlCommand::Screenshot);
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
                chat_log: vec![DebugChatLogEntry {
                    sender_game_id: 0,
                    text: "gg".to_string(),
                    own: true,
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
                    "chatLog": [{
                        "senderGameId": 0,
                        "text": "gg",
                        "own": true,
                    }],
                },
            })
        );
    }

    #[test]
    fn send_chat_command_parses_camel_case_with_default_target() {
        let cmd: DebugControlCommand =
            serde_json::from_str(r#"{"type":"sendChat","text":"gl hf"}"#).unwrap();
        assert_eq!(
            cmd,
            DebugControlCommand::SendChat {
                text: "gl hf".to_string(),
                target: DebugChatTarget::All,
            }
        );
    }

    #[test]
    fn send_chat_command_parses_camel_case_with_explicit_target() {
        let cmd: DebugControlCommand =
            serde_json::from_str(r#"{"type":"sendChat","text":"gg","target":{"kind":"allies"}}"#)
                .unwrap();
        assert_eq!(
            cmd,
            DebugControlCommand::SendChat {
                text: "gg".to_string(),
                target: DebugChatTarget::Allies,
            }
        );

        let cmd: DebugControlCommand = serde_json::from_str(
            r#"{"type":"sendChat","text":"hi","target":{"kind":"player","slot":3}}"#,
        )
        .unwrap();
        assert_eq!(
            cmd,
            DebugControlCommand::SendChat {
                text: "hi".to_string(),
                target: DebugChatTarget::Player { slot: 3 },
            }
        );
    }

    #[test]
    fn screenshot_response_serializes_camel_case_on_success() {
        let response = DebugScreenshotResponse {
            screenshot: Some(DebugScreenshot {
                width: 1280,
                height: 720,
                png_base64: "abc123".to_string(),
            }),
            error: None,
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "screenshot": {
                    "width": 1280,
                    "height": 720,
                    "pngBase64": "abc123",
                },
                "error": null,
            })
        );
    }

    #[test]
    fn screenshot_response_serializes_camel_case_on_failure() {
        let response = DebugScreenshotResponse {
            screenshot: None,
            error: Some("game window not created yet".to_string()),
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "screenshot": null,
                "error": "game window not created yet",
            })
        );
    }
}
