use std::time::{Duration};

use futures::select;
use futures::prelude::*;
use quick_error::{quick_error, ResultExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite;
use tokio_tungstenite::tungstenite::handshake::client::Response as HandshakeResponse;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::cancel_token::SharedCanceler;
use crate::game_state::{self, GameStateMessage};

pub type SendMessages = mpsc::Sender<WsMessage>;

type WebSocketStream = tokio_tungstenite::WebSocketStream<TcpStream>;

async fn connect_to_app() -> Result<(WebSocketStream, HandshakeResponse), tungstenite::Error> {
    let args = crate::parse_args();
    let url = url::Url::parse(&format!("ws://127.0.0.1:{}", args.server_port)).unwrap();
    info!("Connecting to {} ...", url);
    tokio_tungstenite::connect_async(tungstenite::handshake::client::Request {
        url,
        extra_headers: Some(vec![
            ("Origin".into(), "BROODWARS".into()),
            ("x-game-id".into(), args.game_id.into()),
        ]),
    }).await
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
async fn app_websocket_connection(
    client: WebSocketStream,
    recv_messages: mpsc::Receiver<WsMessage>,
    mut game_send: game_state::SendMessages,
    async_stop: SharedCanceler,
) -> ConnectionEndReason {
    let (mut ws_sink, ws_stream) = client.split();
    let mut ws_stream = ws_stream.fuse();
    let mut recv_messages = recv_messages.fuse();
    'handle_messages: loop {
        let message = select! {
            x = recv_messages.next() => match x {
                Some(s) => MessageResult::WebSocket(s),
                None => return ConnectionEndReason::MpscChannelClosed,
            },
            x = ws_stream.next() => match x {
                Some(Ok(message)) => match message {
                    WsMessage::Text(text) => match handle_app_message(text) {
                        Ok(o) => o,
                        Err(e) => {
                            error!("Error handling message: {}", e);
                            continue 'handle_messages;
                        }
                    },
                    WsMessage::Ping(ping) => MessageResult::WebSocket(WsMessage::Pong(ping)),
                    WsMessage::Close(e) => MessageResult::WebSocket(WsMessage::Close(e)),
                    _ => continue 'handle_messages,
                },
                Some(Err(e)) => {
                    error!("Error reading websocket stream: {}", e);
                    return ConnectionEndReason::SocketClosed;
                }
                None => return ConnectionEndReason::SocketClosed,
            },
        };
        match message {
            MessageResult::WebSocket(ws) => {
                debug!("Sending message: {:?}", ws);
                if let Err(e) = ws_sink.send(ws).await {
                    error!("Error sending to websocket sink: {}", e);
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
    // Retry as long as this fails to connect.
    // Return once connection succeeds once (even if it ends prematurely).
    // The app cannot handle reconnections at the moment, trying to
    // start again from game init phase, following by killing the process
    // if this tells that the game is already ininited.
    // So better to just let this task die than the entire process die
    // if the connection between two local processes drops for some
    // inexplicable reason.
    loop {
        let (client, _response) = match connect_to_app().await {
            Ok(o) => o,
            Err(e) => {
                error!("Couldn't connect to Shieldbattery: {}", e);
                tokio::time::delay_for(Duration::from_millis(1000)).await;
                continue;
            }
        };
        info!("Connected to Shieldbattery app");
        app_websocket_connection(client, recv_messages, game_send, async_stop).await;
        return;
    }
}

enum MessageResult {
    WebSocket(WsMessage),
    Game(GameStateMessage),
    Stop,
}

fn handle_app_message<'a>(text: String) -> Result<MessageResult, HandleMessageError> {
    let message: Message = serde_json::from_str(&text).context(("Invalid message", &*text))?;
    let payload = message.payload.unwrap_or_else(|| serde_json::Value::Null);
    debug!("Received message: '{}':\n'{}'", message.command, payload);
    match &*message.command {
        "settings" => {
            let settings = serde_json::from_value(payload).context(("Invalid settings", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetSettings(settings)))
        }
        "localUser" => {
            let user = serde_json::from_value(payload).context(("Invalid local user", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetLocalUser(user)))
        }
        "routes" => {
            let routes = serde_json::from_value(payload).context(("Invalid routes", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetRoutes(routes)))
        }
        "setupGame" => {
            let setup = serde_json::from_value(payload).context(("Invalid game setup", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetupGame(setup)))
        }
        "quit" => Ok(MessageResult::Stop),
        "cleanup_and_quit" => Ok(MessageResult::Game(GameStateMessage::CleanupQuit)),
        _ => Err(HandleMessageError::UnknownCommand(message.command)),
    }
}

quick_error! {
    #[derive(Debug)]
    pub enum HandleMessageError {
        Serde(error: serde_json::Error, context: &'static str, input: String) {
            context(c: (&'static str, &str), e: serde_json::Error) -> (e, c.0, c.1.into())
            description("JSON decode error")
            display("{} '{}': {}", context, input, error)
        }
        UnknownCommand(cmd: String) {
            description("Unknown command")
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
        Ok(WsMessage::Text(string))
    }
    match inner(command, data) {
        Ok(o) => Some(o),
        Err(e) => {
            error!("JSON encode error: {}", e);
            None
        }
    }
}

pub fn send_message<'a, T: serde::Serialize>(
    send: &'a mut mpsc::Sender<WsMessage>,
    command: &str,
    data: T,
) -> impl Future<Output = Result<(), ()>> + 'a {
    let message = encode_message(command, data);
    async move {
        match message {
            Some(o) => send.send(o).await.map_err(|_| ()),
            None => Err(()),
        }
    }
}
