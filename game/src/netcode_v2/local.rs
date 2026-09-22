//! Private named-pipe driver for an Electron-supervised local game.
//!
//! The Electron main process owns the hub and authenticates each process to an assigned roster
//! slot. This module only bridges that hub to the existing [`TurnChannels`] seam: the game thread
//! remains unaware of pipe I/O, and never blocks on it.

use std::io;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use base64::Engine;
use bytes::Bytes;
use quick_error::quick_error;
use rally_point_client::proto::ids::SlotId;
use rally_point_client::proto::messages::Payload;
use rally_point_client::{ChatOut, PhaseStatus, TurnChannels};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::{mpsc, watch};

use super::TurnState;
use crate::app_messages::{LocalSessionSetup, SbUserId};
use crate::bw;

const MAX_PIPE_LINE_BYTES: usize = 1024 * 1024;
const CHANNEL_CAPACITY: usize = 1024;
const CONTROL_CHANNEL_CAPACITY: usize = 256;
const CONNECT_RETRY_DELAY: Duration = Duration::from_millis(50);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

quick_error! {
    #[derive(Debug)]
    pub enum LocalSessionError {
        InvalidSetup(message: String) {
            display("invalid local session setup: {message}")
        }
        Pipe(error: io::Error) {
            from()
            display("local session pipe error: {error}")
            source(error)
        }
        Json(error: serde_json::Error) {
            from()
            display("local session protocol error: {error}")
            source(error)
        }
        Hub(message: String) {
            display("local session hub rejected the connection: {message}")
        }
        Timeout {
            display("timed out connecting to the local session hub")
        }
    }
}

/// Connects to the app-owned local hub, waits until every expected client has joined, and installs
/// a regular [`TurnState`] backed by named-pipe channels. This deliberately does not use a relay or
/// create a UDP endpoint.
pub async fn establish_local_session(
    setup: &LocalSessionSetup,
    has_computers: bool,
) -> Result<mpsc::Receiver<Option<u32>>, LocalSessionError> {
    let roster = validate_setup(setup)?;
    let pipe = connect_and_handshake(setup).await?;
    let initial_buffer_turns = setup.initial_buffer_turns;

    let (outbound_tx, outbound_rx) = mpsc::channel(CHANNEL_CAPACITY);
    let (inbound_tx, inbound_rx) = mpsc::channel(CHANNEL_CAPACITY);
    let (leaves_tx, leaves_rx) = mpsc::channel(16);
    let (leave_intent_tx, leave_intent_rx) = mpsc::channel(1);
    let (result_tx, result_rx) = mpsc::channel(1);
    let (game_started_tx, game_started_rx) = mpsc::channel(1);
    let (lobby_out_tx, lobby_out_rx) = mpsc::channel(CONTROL_CHANNEL_CAPACITY);
    let (lobby_in_tx, lobby_in_rx) = mpsc::channel(CONTROL_CHANNEL_CAPACITY);
    let (chat_out_tx, chat_out_rx) = mpsc::channel(CONTROL_CHANNEL_CAPACITY);
    let (chat_in_tx, chat_in_rx) = mpsc::channel(CONTROL_CHANNEL_CAPACITY);
    let (skin_out_tx, skin_out_rx) = mpsc::channel(32);
    let (skin_in_tx, skin_in_rx) = mpsc::channel(32);
    let (request_drop_tx, request_drop_rx) = mpsc::channel(1);
    let (session_start_tx, session_start_rx) = mpsc::channel(1);
    let (connectivity_tx, connectivity_rx) = mpsc::channel(16);
    let (region_labels_tx, region_labels_rx) = mpsc::channel(1);
    let (phase_status_tx, phase_status_rx) = watch::channel(PhaseStatus::default());

    let mut channels = TurnChannels {
        outbound: outbound_tx,
        inbound: inbound_rx,
        leaves: leaves_rx,
        leave_intent: leave_intent_tx,
        result: result_tx,
        game_started: game_started_tx,
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

    let session_start = std::mem::replace(&mut channels.session_start, mpsc::channel(1).1);

    let mut state = TurnState::new(
        channels,
        SlotId(setup.slot),
        initial_buffer_turns,
        roster,
        has_computers,
    );
    state.populate_identity_slots();
    // Local matches are deliberately untracked: no result is sent across the pipe or uploaded.
    state.set_result_report_possible(false);

    tokio::spawn(async move {
        if let Err(error) = run_driver(
            pipe,
            DriverReceivers {
                outbound: outbound_rx,
                leaves: leaves_tx,
                leave_intent: leave_intent_rx,
                result: result_rx,
                game_started: game_started_rx,
                lobby_out: lobby_out_rx,
                chat_out: chat_out_rx,
                skin_out: skin_out_rx,
                request_drop: request_drop_rx,
                session_start: session_start_tx,
                connectivity: connectivity_tx,
                region_labels: region_labels_tx,
                phase_status: phase_status_tx,
                inbound: inbound_tx,
                lobby_in: lobby_in_tx,
                chat_in: chat_in_tx,
                skin_in: skin_in_tx,
            },
        )
        .await
        {
            error!("local session driver ended: {error}");
        }
    });

    super::store_local_turn_state(state);
    Ok(session_start)
}

fn validate_setup(setup: &LocalSessionSetup) -> Result<Vec<(SlotId, SbUserId)>, LocalSessionError> {
    if !crate::is_local_game() {
        return Err(LocalSessionError::InvalidSetup(
            "localSession was supplied without the -sb-local launch flag".into(),
        ));
    }
    validate_setup_contents(setup)
}

/// Validates the handoff before any named-pipe operation. Keeping the structural checks separate
/// lets malformed app input fail without attempting to contact an endpoint.
fn validate_setup_contents(
    setup: &LocalSessionSetup,
) -> Result<Vec<(SlotId, SbUserId)>, LocalSessionError> {
    if !setup.endpoint.starts_with(r"\\.\pipe\") || setup.endpoint.len() > 240 {
        return Err(LocalSessionError::InvalidSetup(
            "endpoint is not a private Windows named-pipe path".into(),
        ));
    }
    let secret = setup.secret.expose();
    if secret.len() != 64 || !secret.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(LocalSessionError::InvalidSetup(
            "secret must be exactly 32 random bytes encoded as hexadecimal".into(),
        ));
    }
    if !(2..=bw::MAX_STORM_PLAYERS).contains(&setup.roster.len()) {
        return Err(LocalSessionError::InvalidSetup(format!(
            "roster must contain 2..={} participants",
            bw::MAX_STORM_PLAYERS
        )));
    }

    let mut roster = Vec::with_capacity(setup.roster.len());
    for (expected_slot, entry) in setup.roster.iter().enumerate() {
        if entry.slot as usize != expected_slot {
            return Err(LocalSessionError::InvalidSetup(
                "roster slots must be contiguous and start at zero".into(),
            ));
        }
        if roster.iter().any(|&(_, id)| id == entry.user_id) {
            return Err(LocalSessionError::InvalidSetup(
                "roster user ids must be unique".into(),
            ));
        }
        roster.push((SlotId(entry.slot), entry.user_id));
    }
    if !roster.iter().any(|&(slot, _)| slot == SlotId(setup.slot)) {
        return Err(LocalSessionError::InvalidSetup(
            "local slot is absent from the roster".into(),
        ));
    }
    if setup.initial_buffer_turns == 0 {
        return Err(LocalSessionError::InvalidSetup(
            "initial buffer depth must be at least one turn".into(),
        ));
    }
    Ok(roster)
}

async fn connect_and_handshake(
    setup: &LocalSessionSetup,
) -> Result<NamedPipeClient, LocalSessionError> {
    let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    loop {
        match ClientOptions::new().open(&setup.endpoint) {
            Ok(mut pipe) => {
                write_frame(
                    &mut pipe,
                    &ClientFrame::Hello {
                        secret: setup.secret.expose(),
                        slot: setup.slot,
                    },
                )
                .await?;
                return Ok(pipe);
            }
            Err(error) if tokio::time::Instant::now() >= deadline => {
                return Err(LocalSessionError::Pipe(error));
            }
            Err(_) => {}
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(LocalSessionError::Timeout);
        }
        tokio::time::sleep(CONNECT_RETRY_DELAY).await;
    }
}

struct DriverReceivers {
    outbound: mpsc::Receiver<Payload>,
    leaves: mpsc::Sender<rally_point_client::proto::messages::LeaveDirective>,
    leave_intent: mpsc::Receiver<()>,
    result: mpsc::Receiver<Vec<u8>>,
    game_started: mpsc::Receiver<()>,
    lobby_out: mpsc::Receiver<Vec<u8>>,
    chat_out: mpsc::Receiver<ChatOut>,
    skin_out: mpsc::Receiver<Vec<u8>>,
    request_drop: mpsc::Receiver<SlotId>,
    session_start: mpsc::Sender<Option<u32>>,
    connectivity: mpsc::Sender<(SlotId, bool)>,
    region_labels: mpsc::Sender<Vec<(u64, String)>>,
    phase_status: watch::Sender<PhaseStatus>,
    inbound: mpsc::Sender<Payload>,
    lobby_in: mpsc::Sender<(SlotId, Vec<u8>)>,
    chat_in: mpsc::Sender<(SlotId, ChatOut)>,
    skin_in: mpsc::Sender<(SlotId, Vec<u8>)>,
}

async fn run_driver(
    pipe: NamedPipeClient,
    mut channels: DriverReceivers,
) -> Result<(), LocalSessionError> {
    let (read, mut write) = tokio::io::split(pipe);
    let mut lines = BufReader::new(read).lines();
    let mut next_seq = 0u64;
    loop {
        tokio::select! {
            frame = lines.next_line() => {
                let Some(frame) = frame? else { return Ok(()); };
                if frame.len() > MAX_PIPE_LINE_BYTES {
                    return Err(LocalSessionError::Hub("frame exceeded size limit".into()));
                }
                handle_hub_frame(&frame, &channels).await?;
            }
            turn = channels.outbound.recv() => {
                let Some(turn) = turn else { return Ok(()); };
                let frame = ClientFrame::Turn {
                    seq: next_seq.to_string(),
                    commands: base64::engine::general_purpose::STANDARD.encode(&turn.commands),
                    game_frame: turn.game_frame_count,
                    sync_generation: turn.sync_generation.map(|value| value.to_string()),
                };
                next_seq = next_seq.wrapping_add(1);
                write_frame(&mut write, &frame).await?;
            }
            lobby = channels.lobby_out.recv() => {
                let Some(payload) = lobby else { return Ok(()); };
                write_frame(&mut write, &ClientFrame::Lobby { payload: base64::engine::general_purpose::STANDARD.encode(payload) }).await?;
            }
            skin = channels.skin_out.recv() => {
                let Some(payload) = skin else { return Ok(()); };
                write_frame(&mut write, &ClientFrame::Skin { payload: base64::engine::general_purpose::STANDARD.encode(payload) }).await?;
            }
            chat = channels.chat_out.recv() => {
                let Some(chat) = chat else { return Ok(()); };
                write_frame(&mut write, &ClientFrame::Chat { target_kind: chat.target_kind, target_slot: chat.target_slot, text: chat.text }).await?;
            }
            leave = channels.leave_intent.recv() => {
                let Some(()) = leave else { return Ok(()); };
                write_frame(&mut write, &ClientFrame::Leave).await?;
            }
            started = channels.game_started.recv() => {
                let Some(()) = started else { return Ok(()); };
                write_frame(&mut write, &ClientFrame::Started).await?;
            }
            // Local games never report results or use relay-authorized manual drops. Drain these
            // channels so their one-slot senders do not remain permanently full during teardown.
            result = channels.result.recv() => {
                if result.is_none() { return Ok(()); }
            }
            request_drop = channels.request_drop.recv() => {
                if request_drop.is_none() { return Ok(()); }
            }
        }
    }
}

async fn handle_hub_frame(
    frame: &str,
    channels: &DriverReceivers,
) -> Result<(), LocalSessionError> {
    match serde_json::from_str::<HubFrame>(frame)? {
        HubFrame::Turn {
            slot,
            seq,
            commands,
            game_frame,
            sync_generation,
        } => {
            let commands = decode_bytes(&commands)?;
            let seq = parse_u64(&seq, "turn seq")?;
            let sync_generation = sync_generation
                .as_deref()
                .map(|value| parse_u64(value, "sync generation"))
                .transpose()?;
            channels
                .inbound
                .send(Payload {
                    seq,
                    slot: slot as u32,
                    commands: Bytes::from(commands),
                    game_frame_count: game_frame,
                    buffer_directive: None,
                    sync_generation,
                })
                .await
                .map_err(|_| LocalSessionError::Hub("game turn receiver closed".into()))?;
        }
        HubFrame::Lobby { slot, payload } => {
            channels
                .lobby_in
                .send((SlotId(slot), decode_bytes(&payload)?))
                .await
                .map_err(|_| LocalSessionError::Hub("lobby receiver closed".into()))?;
        }
        HubFrame::Skin { slot, payload } => {
            channels
                .skin_in
                .send((SlotId(slot), decode_bytes(&payload)?))
                .await
                .map_err(|_| LocalSessionError::Hub("skin receiver closed".into()))?;
        }
        HubFrame::Chat {
            slot,
            target_kind,
            target_slot,
            text,
        } => {
            channels
                .chat_in
                .send((
                    SlotId(slot),
                    ChatOut {
                        target_kind,
                        target_slot,
                        text,
                    },
                ))
                .await
                .map_err(|_| LocalSessionError::Hub("chat receiver closed".into()))?;
        }
        HubFrame::Ready {
            initial_buffer_turns,
        } if initial_buffer_turns >= 1 => {
            channels
                .session_start
                .send(Some(initial_buffer_turns))
                .await
                .map_err(|_| LocalSessionError::Hub("session-start receiver closed".into()))?;
        }
        HubFrame::Ready { .. } => {
            return Err(LocalSessionError::Hub(
                "hub sent a zero turn buffer depth".into(),
            ));
        }
        HubFrame::Error { message } => return Err(LocalSessionError::Hub(message)),
    }
    Ok(())
}

fn decode_bytes(value: &str) -> Result<Vec<u8>, LocalSessionError> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| LocalSessionError::Hub("invalid base64 payload".into()))
}

fn parse_u64(value: &str, field: &str) -> Result<u64, LocalSessionError> {
    value
        .parse()
        .map_err(|_| LocalSessionError::Hub(format!("invalid {field}")))
}

async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &ClientFrame<'_>,
) -> Result<(), LocalSessionError> {
    let encoded = serde_json::to_string(frame)?;
    if encoded.len() >= MAX_PIPE_LINE_BYTES {
        return Err(LocalSessionError::Hub(
            "outbound frame exceeded size limit".into(),
        ));
    }
    writer.write_all(encoded.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ClientFrame<'a> {
    Hello {
        secret: &'a str,
        slot: u8,
    },
    Turn {
        seq: String,
        commands: String,
        game_frame: Option<u32>,
        sync_generation: Option<String>,
    },
    Lobby {
        payload: String,
    },
    Skin {
        payload: String,
    },
    Chat {
        target_kind: u32,
        target_slot: u32,
        text: String,
    },
    Leave,
    Started,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum HubFrame {
    Ready {
        initial_buffer_turns: u32,
    },
    Turn {
        slot: u8,
        seq: String,
        commands: String,
        game_frame: Option<u32>,
        sync_generation: Option<String>,
    },
    Lobby {
        slot: u8,
        payload: String,
    },
    Skin {
        slot: u8,
        payload: String,
    },
    Chat {
        slot: u8,
        target_kind: u32,
        target_slot: u32,
        text: String,
    },
    Error {
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_messages::{LocalSessionRosterEntry, Secret};

    fn setup(roster: Vec<LocalSessionRosterEntry>) -> LocalSessionSetup {
        LocalSessionSetup {
            endpoint: r"\\.\pipe\shieldbattery-local-test".into(),
            secret: Secret::from_base64_for_test(
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
            slot: 0,
            roster,
            initial_buffer_turns: 1,
        }
    }

    #[test]
    fn turn_wire_uses_camel_case_and_js_safe_integers() {
        let seq = u64::MAX.to_string();
        let sync_generation = (u64::MAX - 1).to_string();
        let wire = serde_json::to_value(ClientFrame::Turn {
            seq: seq.clone(),
            commands: base64::engine::general_purpose::STANDARD.encode([0, 1, 2]),
            game_frame: Some(42),
            sync_generation: Some(sync_generation.clone()),
        })
        .unwrap();

        assert_eq!(wire["type"], "turn");
        assert_eq!(wire["seq"], seq);
        assert_eq!(wire["commands"], "AAEC");
        assert_eq!(wire["gameFrame"], 42);
        assert_eq!(wire["syncGeneration"], sync_generation);
        assert!(wire.get("game_frame").is_none());
        assert!(wire.get("sync_generation").is_none());

        let inbound: HubFrame = serde_json::from_value(serde_json::json!({
            "type": "turn",
            "slot": 1,
            "seq": "18446744073709551615",
            "commands": "AAEC",
            "gameFrame": 42,
            "syncGeneration": "18446744073709551614",
        }))
        .unwrap();
        assert!(matches!(
            inbound,
            HubFrame::Turn {
                slot: 1,
                seq,
                commands,
                game_frame: Some(42),
                sync_generation: Some(sync_generation),
            } if seq == "18446744073709551615"
                && commands == "AAEC"
                && sync_generation == "18446744073709551614"
        ));
    }

    #[test]
    fn validation_rejects_duplicate_roster_user_without_opening_a_pipe() {
        let error = validate_setup_contents(&setup(vec![
            LocalSessionRosterEntry {
                slot: 0,
                user_id: SbUserId(1),
            },
            LocalSessionRosterEntry {
                slot: 1,
                user_id: SbUserId(1),
            },
        ]))
        .unwrap_err();

        assert!(error.to_string().contains("user ids must be unique"));
    }

    #[test]
    fn validation_rejects_sparse_roster_user_without_opening_a_pipe() {
        let error = validate_setup_contents(&setup(vec![
            LocalSessionRosterEntry {
                slot: 0,
                user_id: SbUserId(1),
            },
            LocalSessionRosterEntry {
                slot: 2,
                user_id: SbUserId(2),
            },
        ]))
        .unwrap_err();

        assert!(error.to_string().contains("slots must be contiguous"));
    }
}
