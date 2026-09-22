use std::time::Duration;

use futures::prelude::*;
use quick_error::{ResultExt, quick_error};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::select;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::tungstenite::handshake::client::Response as HandshakeResponse;

use crate::cancel_token::SharedCanceler;
use crate::game_state::{self, GameStateMessage};

pub type SendMessages = mpsc::Sender<WsMessage>;

type WebSocketStream<S> = tokio_tungstenite::WebSocketStream<S>;

fn app_request(url: &str) -> Result<http::Request<()>, tungstenite::Error> {
    use http::header::HeaderValue;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let args = crate::parse_args();
    let mut request = url.into_client_request()?;
    let headers = request.headers_mut();
    headers.reserve(2);
    headers.insert("Origin", HeaderValue::from_static("BROODWARS"));
    headers.insert(
        "x-game-id",
        HeaderValue::from_str(&args.game_id).expect("Invalid game id"),
    );
    Ok(request)
}

async fn connect_to_app() -> Result<
    (
        WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
        HandshakeResponse,
    ),
    tungstenite::Error,
> {
    let args = crate::parse_args();
    let url = format!("ws://127.0.0.1:{}", args.server_port);
    info!("Connecting to {url} ...");
    tokio_tungstenite::connect_async(app_request(&url)?).await
}

async fn connect_to_local_app(
    pipe_name: &str,
) -> Result<(WebSocketStream<NamedPipeClient>, HandshakeResponse), tungstenite::Error> {
    info!("Connecting to local ShieldBattery app pipe ...");
    let pipe = ClientOptions::new()
        .open(pipe_name)
        .map_err(tungstenite::Error::Io)?;
    tokio_tungstenite::client_async(app_request("ws://localhost/")?, pipe).await
}
#[derive(Eq, PartialEq, Copy, Clone, Debug)]
enum ConnectionEndReason {
    SocketClosed,
    MpscChannelClosed,
}

/// Executes a single connection until it is closed for whatever reason.
/// All errors are handled before the future resolves, and either the
/// stream or message channel being closed will cause the future to
/// resolve to a success.
async fn app_websocket_connection<S>(
    client: WebSocketStream<S>,
    recv_messages: mpsc::Receiver<WsMessage>,
    game_send: &game_state::SendMessages,
    async_stop: SharedCanceler,
) -> ConnectionEndReason
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut ws_sink, mut ws_stream) = client.split();
    let mut recv_messages = recv_messages;
    'handle_messages: loop {
        let message = select! {
            x = recv_messages.recv() => match x {
                Some(s) => MessageResult::WebSocket(s),
                None => return ConnectionEndReason::MpscChannelClosed,
            },
            x = ws_stream.next() => match x {
                Some(Ok(message)) => match message {
                    WsMessage::Text(text) => match handle_app_message(text.to_string()) {
                        Ok(o) => o,
                        Err(e) => {
                            error!("Error handling message: {e}");
                            continue 'handle_messages;
                        }
                    },
                    WsMessage::Ping(ping) => MessageResult::WebSocket(WsMessage::Pong(ping)),
                    WsMessage::Close(e) => MessageResult::WebSocket(WsMessage::Close(e)),
                    _ => continue 'handle_messages,
                },
                Some(Err(e)) => {
                    error!("Error reading websocket stream: {e}");
                    return ConnectionEndReason::SocketClosed;
                }
                None => return ConnectionEndReason::SocketClosed,
            },
        };
        match message {
            MessageResult::WebSocket(ws) => {
                debug!("Sending message: {ws:?}");
                if let Err(e) = ws_sink.send(ws).await {
                    error!("Error sending to websocket sink: {e}");
                    return ConnectionEndReason::SocketClosed;
                }
            }
            MessageResult::Game(msg) => {
                if game_send.send(msg).await.is_err() {
                    return ConnectionEndReason::MpscChannelClosed;
                }
            }
            MessageResult::Stop => {
                async_stop.cancel();
            }
        }
    }
}

pub async fn websocket_connection_future(
    game_send: game_state::SendMessages,
    async_stop: SharedCanceler,
    recv_messages: mpsc::Receiver<WsMessage>,
) {
    if let Some(pipe_name) = crate::local_app_pipe() {
        let mut retries = 30;
        loop {
            let (client, _response) = match connect_to_local_app(pipe_name).await {
                Ok(connection) => connection,
                Err(error) => {
                    error!("Couldn't connect to local ShieldBattery app pipe: {error}");
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                    retries -= 1;
                    if retries == 0 {
                        async_stop.cancel();
                        return;
                    }
                    continue;
                }
            };
            app_websocket_connection(client, recv_messages, &game_send, async_stop.clone()).await;
            // A local game's owner is its supervisor. Keep no orphaned visible or background SC:R
            // process alive after that private app connection closes.
            async_stop.cancel();
            return;
        }
    }

    let mut retries = 30;
    loop {
        let (client, _response) = match connect_to_app().await {
            Ok(connection) => connection,
            Err(error) => {
                error!("Couldn't connect to Shieldbattery: {error}");
                tokio::time::sleep(Duration::from_millis(1000)).await;
                retries -= 1;
                if retries == 0 {
                    error!("Didn't manage to connect to app, exiting");
                    async_stop.cancel();
                }
                continue;
            }
        };
        info!("Connected to Shieldbattery app");
        app_websocket_connection(client, recv_messages, &game_send, async_stop).await;
        let _ = game_send.send(GameStateMessage::QuitIfNotStarted).await;
        return;
    }
}
enum MessageResult {
    WebSocket(WsMessage),
    Game(GameStateMessage),
    Stop,
}

/// Commands whose payloads carry secrets (e.g. `netcodeV2Setup`'s per-session private key or
/// `setupGame`'s local-session secret).
/// For these, neither the raw message text nor serde's own error output (which can embed
/// mistyped field *values*) may reach a log line or error string. Add any new secret-bearing
/// command here and redaction applies everywhere in `handle_app_message` automatically.
const SENSITIVE_COMMANDS: &[&str] = &["netcodeV2Setup", "setupGame"];

const REDACTED: &str = "<payload redacted>";

/// Reduces a serde error to its category and position, dropping the message body. serde errors
/// embed the unexpected *value* (e.g. `invalid type: string "..."`), which for a sensitive
/// payload can be the secret itself (a misplaced key string echoed back verbatim).
fn sanitize_serde_error(e: serde_json::Error) -> serde_json::Error {
    use serde::de::Error;
    serde_json::Error::custom(format!(
        "{:?} error at line {} column {}",
        e.classify(),
        e.line(),
        e.column(),
    ))
}

/// Parses one command's payload, redacting both the raw input and serde's error message for
/// sensitive commands.
fn parse_payload<T: serde::de::DeserializeOwned>(
    payload: serde_json::Value,
    context: &'static str,
    err_input: &str,
    sensitive: bool,
) -> Result<T, HandleMessageError> {
    Ok(serde_json::from_value(payload)
        .map_err(|e| {
            if sensitive {
                sanitize_serde_error(e)
            } else {
                e
            }
        })
        .context((context, err_input))?)
}

fn handle_app_message(text: String) -> Result<MessageResult, HandleMessageError> {
    // The command isn't known until the envelope parses, so redact the envelope-parse error for
    // any text that even mentions a sensitive command (over-redacting a message that merely
    // contains the name is fine; leaking a secret is not).
    let text_sensitive = SENSITIVE_COMMANDS.iter().any(|&c| text.contains(c));
    let message: Message = serde_json::from_str(&text)
        .map_err(|e| {
            if text_sensitive {
                sanitize_serde_error(e)
            } else {
                e
            }
        })
        .context((
            "Invalid message",
            if text_sensitive { REDACTED } else { &*text },
        ))?;
    let sensitive = SENSITIVE_COMMANDS.contains(&&*message.command);
    let err_input: &str = if sensitive { REDACTED } else { &text };
    let payload = message.payload.unwrap_or(serde_json::Value::Null);
    if sensitive {
        debug!("Received message: '{}' ({REDACTED})", message.command);
    } else {
        debug!("Received message: '{}':\n'{}'", message.command, payload);
    }
    match &*message.command {
        "settings" => {
            let settings = parse_payload(payload, "Invalid settings", err_input, sensitive)?;
            Ok(MessageResult::Game(GameStateMessage::SetSettings(settings)))
        }
        "localUser" => {
            let user = parse_payload(payload, "Invalid local user", err_input, sensitive)?;
            Ok(MessageResult::Game(GameStateMessage::SetLocalUser(user)))
        }
        "blockedUsers" => {
            let blocked_users =
                serde_json::from_value(payload).context(("Invalid blocked users", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetBlockedUsers(
                blocked_users,
            )))
        }
        "serverConfig" => {
            let config = parse_payload(payload, "Invalid server config", err_input, sensitive)?;
            Ok(MessageResult::Game(GameStateMessage::SetServerConfig(
                config,
            )))
        }
        "netcodeV2Setup" => {
            let setup = parse_payload(payload, "Invalid netcode v2 setup", err_input, sensitive)
                .map(Box::new)?;
            Ok(MessageResult::Game(GameStateMessage::SetNetcodeV2Setup(
                setup,
            )))
        }
        "setupGame" => {
            let setup = parse_payload(payload, "Invalid game setup", err_input, sensitive)?;
            Ok(MessageResult::Game(GameStateMessage::SetupGame(setup)))
        }
        "quit" => Ok(MessageResult::Stop),
        "cleanup_and_quit" => Ok(MessageResult::Game(GameStateMessage::CleanupQuit)),
        #[cfg(debug_assertions)]
        "debugControl" => {
            let cmd = parse_payload(
                payload,
                "Invalid debug control command",
                err_input,
                sensitive,
            )?;
            Ok(MessageResult::Game(GameStateMessage::DebugControl(cmd)))
        }
        _ => Err(HandleMessageError::UnknownCommand(message.command)),
    }
}

quick_error! {
    #[derive(Debug)]
    pub enum HandleMessageError {
        Serde(error: serde_json::Error, context: &'static str, input: String) {
            context(c: (&'static str, &str), e: serde_json::Error) -> (e, c.0, c.1.into())
            display("{} '{}': {}", context, input, error)
        }
        UnknownCommand(cmd: String) {
            display("Unknown command '{}'", cmd)
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Message {
    command: String,
    payload: Option<serde_json::Value>,
}

pub fn encode_message<T: Serialize>(command: &str, data: T) -> Option<WsMessage> {
    fn inner<T: Serialize>(command: &str, data: T) -> Result<WsMessage, serde_json::Error> {
        let payload = serde_json::to_value(data)?;
        let message = Message {
            command: command.into(),
            payload: Some(payload),
        };
        let string = serde_json::to_string(&message)?;
        Ok(WsMessage::Text(string.into()))
    }
    match inner(command, data) {
        Ok(o) => Some(o),
        Err(e) => {
            error!("JSON encode error: {e}");
            None
        }
    }
}

pub fn send_message<'a, T: serde::Serialize>(
    send: &'a mpsc::Sender<WsMessage>,
    command: &str,
    data: T,
) -> impl Future<Output = Result<(), ()>> + 'a + use<'a, T> {
    let message = encode_message(command, data);
    async move {
        match message {
            Some(o) => send.send(o).await.map_err(|_| ()),
            None => Err(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_control::DebugControlCommand;

    #[test]
    fn debug_control_ping_dispatches_to_game_state() {
        let result =
            handle_app_message(r#"{"command":"debugControl","payload":{"type":"ping"}}"#.into());
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::Ping
            )))
        ));
    }

    #[test]
    fn debug_control_query_state_dispatches_to_game_state() {
        let result = handle_app_message(
            r#"{"command":"debugControl","payload":{"type":"queryState"}}"#.into(),
        );
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::QueryState
            )))
        ));
    }

    #[test]
    fn debug_control_force_unsynced_leave_dispatches_to_game_state() {
        let result = handle_app_message(
            r#"{"command":"debugControl","payload":{"type":"forceUnsyncedLeave","slot":2}}"#.into(),
        );
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::ForceUnsyncedLeave { slot: 2 }
            )))
        ));
    }

    #[test]
    fn debug_control_force_desync_dispatches_to_game_state() {
        let result = handle_app_message(
            r#"{"command":"debugControl","payload":{"type":"forceDesync"}}"#.into(),
        );
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::ForceDesync
            )))
        ));
    }

    #[test]
    fn debug_control_screenshot_dispatches_to_game_state() {
        let result = handle_app_message(
            r#"{"command":"debugControl","payload":{"type":"screenshot"}}"#.into(),
        );
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::Screenshot
            )))
        ));
    }

    #[test]
    fn debug_control_send_chat_dispatches_to_game_state() {
        let result = handle_app_message(
            r#"{"command":"debugControl","payload":{"type":"sendChat","text":"gg"}}"#.into(),
        );
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::SendChat { text, target }
            ))) if text == "gg" && target == crate::debug_control::DebugChatTarget::All
        ));
    }

    #[test]
    fn debug_control_request_drop_dispatches_to_game_state() {
        let result = handle_app_message(
            r#"{"command":"debugControl","payload":{"type":"requestDrop","slot":1}}"#.into(),
        );
        assert!(matches!(
            result,
            Ok(MessageResult::Game(GameStateMessage::DebugControl(
                DebugControlCommand::RequestDrop { slot: 1 }
            )))
        ));
    }

    #[test]
    fn unknown_command_still_errors() {
        let result = handle_app_message(r#"{"command":"notARealCommand","payload":null}"#.into());
        assert!(matches!(result, Err(HandleMessageError::UnknownCommand(_))));
    }

    #[test]
    fn setup_game_parse_errors_redact_the_local_session_secret() {
        let secret = "this-local-session-secret-must-not-appear-in-errors";
        let result = handle_app_message(format!(
            r#"{{"command":"setupGame","payload":{{"localSession":{{"secret":"{secret}"}}}}}}"#
        ));
        let error = match result {
            Err(error) => error.to_string(),
            Ok(_) => panic!("malformed setupGame payload unexpectedly succeeded"),
        };

        assert!(error.contains(REDACTED));
        assert!(!error.contains(secret));
    }
}
