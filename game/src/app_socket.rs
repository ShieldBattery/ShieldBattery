use std::time::{Duration};

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
fn app_websocket_connection(
    client: WebSocketStream,
    recv_messages: mpsc::Receiver<WsMessage>,
    game_send: &game_state::SendMessages,
    async_stop: &SharedCanceler,
) -> impl Future<Output = ConnectionEndReason> {
    // To terminate the select() below, chain errors to both input streams,
    // but we want those errors to be a success for the returned future.
    #[derive(Eq, PartialEq, Copy, Clone, Debug)]
    enum WasCloseErr {
        Yes(ConnectionEndReason),
        No,
    }

    let mut game_send = game_send.clone();
    let async_stop = async_stop.clone();
    future::ready(())
        .then(|()| {
            let recv_messages = recv_messages
                .map(|x| Ok(MessageResult::WebSocket(x)))
                .chain({
                    future::err(WasCloseErr::Yes(ConnectionEndReason::MpscChannelClosed))
                        .into_stream()
                });
            let (mut ws_sink, stream) = client.split();
            let mut streams = stream::select(
                stream
                    .map_err(|e| {
                        error!("Error reading websocket stream: {}", e);
                        WasCloseErr::No
                    })
                    .chain({
                        future::err(WasCloseErr::Yes(ConnectionEndReason::SocketClosed))
                            .into_stream()
                    })
                    .try_filter_map(|message| {
                        let filtered = match message {
                            WsMessage::Text(text) => match handle_app_message(text) {
                                Ok(o) => Some(o),
                                Err(e) => {
                                    error!("Error handling message: {}", e);
                                    None
                                }
                            },
                            WsMessage::Ping(ping) => {
                                Some(MessageResult::WebSocket(WsMessage::Pong(ping)))
                            }
                            WsMessage::Close(e) => {
                                Some(MessageResult::WebSocket(WsMessage::Close(e)))
                            }
                            _ => None,
                        };
                        future::ok(filtered)
                    }),
                recv_messages,
            );
            async move {
                while let Some(message) = streams.next().await {
                    match message? {
                        MessageResult::WebSocket(ws) => {
                            debug!("Sending message: {:?}", ws);
                            if let Err(e) = ws_sink.send(ws).await {
                                error!("Error sending to websocket sink: {}", e);
                                return Err(WasCloseErr::No);
                            }
                        }
                        MessageResult::Game(msg) => {
                            game_send.send(msg).await.map_err(|_| WasCloseErr::No)?;
                        }
                        MessageResult::Stop => {
                            async_stop.cancel();
                        }
                    }
                }
                Ok(())
            }.map(|result| {
                match result {
                    Ok(()) => {
                        // Wait, both input streams closed before either's chained error
                        // was received?? Just tell websocket was first.
                        ConnectionEndReason::SocketClosed
                    }
                    Err(WasCloseErr::Yes(reason)) => reason,
                    Err(WasCloseErr::No) => ConnectionEndReason::MpscChannelClosed,
                }
            }).boxed()
        })
}

pub fn websocket_connection_future(
    game_send: &game_state::SendMessages,
    async_stop: &SharedCanceler,
    recv_messages: mpsc::Receiver<WsMessage>,
) -> impl Future<Output = ()> {
    let game_send = game_send.clone();
    let async_stop = async_stop.clone();
    async move {
        // Retry as long as this fails to connect.
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
            app_websocket_connection(client, recv_messages, &game_send, &async_stop).await;
            return;
        }
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
