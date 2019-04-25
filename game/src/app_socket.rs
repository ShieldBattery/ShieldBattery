use std::time::{Instant, Duration};

use futures::future::{self, Either};
use quick_error::{quick_error, ResultExt};
use serde::{Serialize, Deserialize};
use tokio::prelude::*;
use tokio::sync::mpsc;
use tokio::timer::Delay;
use websocket::{self, OwnedMessage};
use websocket::r#async::client::{ClientNew, TcpStream};

use crate::{box_future};
use crate::cancel_token::SharedCanceler;
use crate::game_state::{self, GameStateMessage};

pub type SendMessages = mpsc::Sender<websocket::OwnedMessage>;

fn connect_to_app() -> ClientNew<TcpStream> {
    let args = crate::parse_args();
    let url = format!("ws://127.0.0.1:{}", args.server_port);
    info!("Connecting to {} ...", url);
    let mut headers = websocket::header::Headers::new();
    headers.append_raw("x-game-id", args.game_id.into());
    websocket::ClientBuilder::new(&url).unwrap()
        .origin("BROODWARS".into())
        .custom_headers(&headers)
        .async_connect_insecure()
}

// Executes a single connection until it is closed for whatever reason.
// All errors are handled before the future resolves.
fn app_websocket_connection(
    recv_messages: mpsc::Receiver<OwnedMessage>,
    game_send: &game_state::SendMessages,
    async_stop: &SharedCanceler,
) -> impl Future<Item = (), Error = ()> {
    let game_send = game_send.clone();
    let async_stop = async_stop.clone();
    connect_to_app()
        .or_else(|e| {
            error!("Couldn't connect to Shieldbattery: {}", e);
            box_future(
                Delay::new(Instant::now() + Duration::from_millis(1000))
                    .then(|_| Err(())) // We don't care about timer errors?
            )
        })
        .and_then(move |(client, _headers)| {
            info!("Connected to Shieldbattery app");
            let recv_messages = recv_messages
                .map(|x| MessageResult::WebSocket(x))
                .map_err(|_| ());
            let (ws_sink, stream) = client.split();
            let stream_done = stream
                .map_err(|e| {
                    error!("Error reading websocket stream: {}", e);
                })
                .filter_map(|message| {
                    match message {
                        OwnedMessage::Text(text) => {
                            match handle_app_message(text) {
                                Ok(o) => Some(o),
                                Err(e) => {
                                    error!("Error handling message: {}", e);
                                    None
                                }
                            }
                        }
                        OwnedMessage::Ping(ping) => {
                            Some(MessageResult::WebSocket(OwnedMessage::Pong(ping)))
                        }
                        OwnedMessage::Close(e) => {
                            Some(MessageResult::WebSocket(OwnedMessage::Close(e)))
                        }
                        _ => None,
                    }
                })
                .select(recv_messages)
                .fold((game_send, ws_sink), move |(game_send, ws_sink), message| {
                    match message {
                        MessageResult::WebSocket(ws) => {
                            debug!("Sending message: {:?}", ws);
                            let future = ws_sink.send(ws)
                                .map_err(|e| error!("Error sending to websocket sink: {}", e))
                                .map(move |x| (game_send, x));
                            Either::A(future)
                        }
                        MessageResult::Game(msg) => {
                            let future = game_send.send(msg)
                                .map_err(|_| ())
                                .map(move |x| (x, ws_sink));
                            Either::B(box_future(future))
                        }
                        MessageResult::Stop => {
                            async_stop.cancel();
                            Either::B(box_future(future::ok((game_send, ws_sink))))
                        }
                    }
                })
                .map(|_| ());
            stream_done
        })
}

pub fn websocket_connection_future(
    game_send: &game_state::SendMessages,
    async_stop: &SharedCanceler,
    recv_messages: mpsc::Receiver<OwnedMessage>,
) -> impl Future<Item = (), Error = ()> {
    // Reconnect if the connection gets lost.
    // This ends up being pretty bad anyway, since
    // 1) We just connect to another process on the local system, so ideally the connection
    // never drops.
    // 2) We cannot tell if the messages that were sent right before connection was lost were
    // received, so this just ends up hoping they were (though they likely were not).
    // 3) A realistic reason for the reconnection would be user closing and reopening the client
    // program, but at that point we have no way to know what port it binds to, and it would
    // just tell us quit as it doesn't know about us/doesn't track game state across
    // closing/reopening.
    //
    // Point 2) could be solved by resending what didn't end up being sent succesfully -
    // maybe messages should have an seq/id field so the receiving end doesn't handle them twice,
    // but for now let's just keep hoping that the connection during stateful part (init) is
    // stable, and sending window move/etc misc info is less important.
    //
    // Implementing this just by using future combinators as is done below ends up being ugly,
    // we have to create one subtask that creates connections, and another which sits between it
    // and the outer world, as there isn't a ready-made way to rescue mspc::Sender from a task
    // which ends due to receiving end being dropped. (It kind of does make sense for future
    // APIs to not expose any way to do that, considering that there again isn't any guarantee
    // how many of the sent messages got handled).
    //
    // The better solution would be to create a proper
    // ReconnectingWebSocketStream: futures::Stream<OwnedMessage> + futures::Sink<OwnedMessage>
    // (And a stream combinator that does buffering/forwarding/doesn't lose messages that
    // weren't confirmed flushed), but I'm hoping Rust async libraries improve/stabilize before
    // that, and for now this should do and have same guarantees as the older c++/js code.

    let game_send = game_send.clone();
    let async_stop = async_stop.clone();
    let (send1, send2) = futures::sync::BiLock::new(None);
    let repeat_connection = futures::stream::repeat(())
        .fold(send1, move |send, ()| {
            let (current_send, current_recv) = mpsc::channel(8);
            let current_send = current_send
                .with_flat_map(|vec: Vec<OwnedMessage>| {
                    futures::stream::iter_ok(vec)
                });

            let game_send = game_send.clone();
            let async_stop = async_stop.clone();
            send.lock()
                .and_then(move |mut locked| {
                    *locked = Some(current_send);
                    let lock = locked.unlock();
                    let connection =
                        app_websocket_connection(current_recv, &game_send, &async_stop);
                    connection.map(|()| lock)
                })
        })
        .map(|_| ());
    // Buffer messages if there isn't a connection active
    let buffer = Vec::new();
    let forward_messages_to_current_connection = recv_messages
        .map_err(|_| ())
        .fold((send2, buffer), move |(send, mut buffer), msg| {
            send.lock()
                .and_then(move |mut locked| {
                    if let Some(send) = locked.take() {
                        buffer.push(msg);
                        let future = send.send(buffer)
                            .then(|result| {
                                match result {
                                    Ok(send) => *locked = Some(send),
                                    Err(_) => *locked = None,
                                };
                                Ok((locked.unlock(), Vec::new()))
                            });
                        Either::A(future)
                    } else {
                        Either::B(Ok((locked.unlock(), buffer)).into_future())
                    }
                })
        })
        .map(|_| ());
    repeat_connection.select(forward_messages_to_current_connection)
        .map(|_| ())
        .map_err(|_| ())
}

enum MessageResult {
    WebSocket(websocket::OwnedMessage),
    Game(GameStateMessage),
    Stop,
}

fn handle_app_message<'a>(
    text: String,
) -> Result<MessageResult, HandleMessageError> {
    let message: Message = serde_json::from_str(&text)
        .context(("Invalid message", &*text))?;
    let payload = message.payload
        .unwrap_or_else(|| serde_json::Value::Null);
    debug!("Received message: '{}':\n'{}'", message.command, payload);
    match &*message.command {
        "settings" => {
            let settings = serde_json::from_value(payload)
                .context(("Invalid settings", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetSettings(settings)))
        }
        "localUser" => {
            let user = serde_json::from_value(payload)
                .context(("Invalid local user", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetLocalUser(user)))
        }
        "routes" => {
            let routes = serde_json::from_value(payload)
                .context(("Invalid routes", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetRoutes(routes)))
        }
        "setupGame" => {
            let setup = serde_json::from_value(payload)
                .context(("Invalid game setup", &*text))?;
            Ok(MessageResult::Game(GameStateMessage::SetupGame(setup)))
        }
        "quit" => Ok(MessageResult::Stop),
        _ => {
            Err(HandleMessageError::UnknownCommand(message.command))
        }
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

pub fn encode_message<T: Serialize>(
    command: &str,
    data: T,
) -> Option<OwnedMessage> {
    fn inner<T: Serialize>(
        command: &str,
        data: T,
    ) -> Result<OwnedMessage, serde_json::Error> {
        let payload = serde_json::to_value(data)?;
        let message = Message {
            command: command.into(),
            payload: Some(payload),
        };
        let string = serde_json::to_string(&message)?;
        Ok(OwnedMessage::Text(string))
    }
    match inner(command, data) {
        Ok(o) => Some(o),
        Err(e) => {
            error!("JSON encode error: {}", e);
            None
        }
    }
}

pub fn send_message<T: serde::Serialize>(
    send: mpsc::Sender<OwnedMessage>,
    command: &str,
    data: T,
) -> impl Future<Item = mpsc::Sender<OwnedMessage>, Error = ()> {
    let message = encode_message(command, data);
    match message {
        Some(o) => box_future(send.send(o).map_err(|_| ())),
        None => box_future(Err(()).into_future()),
    }
}
