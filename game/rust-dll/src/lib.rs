#[macro_use] extern crate log;
#[macro_use] extern crate whack;

mod bw;
mod cancel_token;
mod forge;
mod game_state;
mod rally_point;
mod route_manager;
mod snp;
mod windows;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lazy_static::lazy_static;
use libc::c_void;
use quick_error::{quick_error, ResultExt};
use serde::{Deserialize, Serialize};
use tokio::prelude::*;
use tokio::timer::Delay;
use tokio::sync::mpsc::Sender;
use websocket::r#async::client::{ClientNew, TcpStream};
use winapi::um::processthreadsapi::{GetCurrentProcess, TerminateProcess};

use game_state::{GameStateMessage, GameState};

#[derive(Deserialize)]
pub struct Settings {
    local: serde_json::Map<String, serde_json::Value>,
}

fn log_file_path() -> PathBuf {
    let args = parse_args();
    args.user_data_path.join("logs/shieldbattery.log")
}

// Show panic message/backtrace and terminate process before reaching the default panic handling.
// This somewhat just mimics the default Rust panic handler, but logs the error and shows a
// message box instead of trying to print to stderr, which is going to not work properly in a
// Windows GUI program like BW.
fn panic_hook(info: &std::panic::PanicInfo) {
    use std::fmt::Write;

    fn backtrace() -> String {
        use std::path::Path;

        let mut backtrace = String::new();
        backtrace::trace(|frame| {
            let ip = frame.ip();
            let symbol_address = frame.symbol_address();

            backtrace::resolve(ip, |symbol| {
                let mut line = format!("    {:p}", symbol_address);
                if symbol_address != ip {
                    write!(line, " ({:p})", symbol_address).unwrap();
                }
                let module = windows::module_from_address(symbol_address as *mut _);
                if let Some((name, base)) = module {
                    if let Some(fname) = Path::new(&name).file_name() {
                        write!(line, " {:?} {:p}", fname, base).unwrap();
                    } else {
                        write!(line, " {:?} {:p}", name, base).unwrap();
                    }
                }
                if let Some(name) = symbol.name() {
                    write!(line, " -- {}", name).unwrap();
                }
                if let Some(filename) = symbol.filename() {
                    if let Some(lineno) = symbol.lineno() {
                        write!(line, " -- {}:{}", filename.display(), lineno).unwrap();
                    } else {
                        write!(line, " -- {}:???", filename.display()).unwrap();
                    }
                }
                writeln!(backtrace, "{}", line).unwrap();
            });
            true // keep going to the next frame
        });
        backtrace
    }

    let mut msg = String::new();
    match info.location() {
        Some(s) => writeln!(msg, "Panic at {}:{}", s.file(), s.line()).unwrap(),
        None => writeln!(msg, "Panic at unknown location").unwrap(),
    }
    let payload = info.payload();
    let panic_msg = match payload.downcast_ref::<&str>() {
        Some(s) => s,
        None => match payload.downcast_ref::<String>() {
            Some(s) => &s[..],
            None => "(???)",
        },
    };
    writeln!(msg, "{}", panic_msg).unwrap();
    if cfg!(debug_assertions) {
        write!(msg, "Backtrace:\n{}", backtrace()).unwrap();
    }
    error!("{}", msg);
    // TODO Probs remove this once things work
    windows::message_box("Shieldbattery panic", &msg);
    unsafe {
        TerminateProcess(GetCurrentProcess(), 0x4230daef);
    }
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern fn OnInject() {
    // TODO truncate log?
    let _ = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{}[{}:{}][{}] {}",
                chrono::Local::now().format("[%Y-%m-%d][%H:%M:%S]"),
                record.file().unwrap_or(""),
                record.line().unwrap_or(0),
                record.level(),
                message
            ))
        })
        .level(log::LevelFilter::Debug)
        .chain(fern::log_file(log_file_path()).unwrap())
        .apply();

    std::panic::set_hook(Box::new(panic_hook));
    unsafe {
        patch_game();
    }
}

#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "stdcall" fn SnpBind(
    index: u32,
    functions: *mut *const bw::SnpFunctions,
) -> u32 {
    // we only have one provider, so any index over that is an error
    if index > 0 || functions.is_null() {
        return 0;
    }
    *functions = &snp::SNP_FUNCTIONS;
    1
}

lazy_static! {
    static ref PATCHER: whack::Patcher = whack::Patcher::new();
    static ref SEND_FROM_GAME_THREAD:
        Mutex<Option<tokio::sync::mpsc::UnboundedSender<GameThreadMessage>>> = Mutex::new(None);
    static ref GAME_RECEIVE_REQUESTS:
        Mutex<Option<std::sync::mpsc::Receiver<GameThreadRequest>>> = Mutex::new(None);
}

unsafe fn patch_game() {
    let mut active_patcher = PATCHER.lock().unwrap();
    forge::init_hooks(&mut active_patcher);
    snp::init_hooks(&mut active_patcher);

    let mut exe = active_patcher.patch_exe(0x0040_0000);
    bw::init_funcs(&mut exe);
    bw::init_vars(&mut exe);
    exe.hook_opt(bw::WinMain, entry_point_hook);
    exe.hook(bw::GameInit, process_init_hook);
    // Rendering during InitSprites is useless and wastes a bunch of time, so we no-op it
    exe.replace(bw::INIT_SPRITES_RENDER_ONE, &[0x90, 0x90, 0x90, 0x90, 0x90]);
    exe.replace(bw::INIT_SPRITES_RENDER_TWO, &[0x90, 0x90, 0x90, 0x90, 0x90]);
}

fn entry_point_hook(
    a1: *mut c_void,
    a2: *mut c_void,
    a3: *const u8,
    a4: i32,
    orig: &Fn(*mut c_void, *mut c_void, *const u8, i32) -> i32,
) -> i32 {
    // In addition to just setting up a connection to the client,
    // initialize will also get the game settings and wait for startup command from the
    // Shieldbattery client. As such, relatively lot will happen before we let BW execute even a
    // single line of its original code.
    initialize();
    orig(a1, a2, a3, a4)
}

fn initialize() {
    // TODO call SetDllDirectoryW to make sure d3dcompiler_47.dll gets found if needed
    // (Would just using LoadLibrary to load it be better as it doesn't poke with global state?)

    // Spawn a thread to handle the connection to Shieldbattery client.
    // It'll send a message over the channel once shieldbattery setup is done and BW can be let
    // to initialize itself.
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        async_thread(sender);
    });
    if let Err(e) = receiver.recv() {
        // Async thread closed, wait for it to exit the process
        wait_async_exit();
    }
}

// Call from main thread when something (closed channel) implies that async thread is shutting
// down.
fn wait_async_exit() -> ! {
    std::thread::sleep(Duration::from_millis(5000));
    warn!("Async thread exit timed out");
    std::process::exit(0);
}

// This essentially just serves as a stopping point for "general initialization stuff" BW does
// after its entry point. From here on we init the remaining parts ourselves and wait
// for commands from the client.
fn process_init_hook() {
    run_main_thread_event_loop()
}

fn run_main_thread_event_loop() -> ! {
    debug!("Main thread reached event loop");
    let mut receive_requests = GAME_RECEIVE_REQUESTS.lock().unwrap();
    let receive_requests = receive_requests.take().expect("Channel to receive requests not set?");
    while let Ok(msg) = receive_requests.recv() {
        unsafe {
            handle_game_request(msg.request_type);
        }
        let _ = msg.done.send(());
    }
    // We can't return from here, as it would put us back in middle of BW's initialization code
    wait_async_exit();
}

unsafe fn handle_game_request(request: GameThreadRequestType) {
    use self::GameThreadRequestType::*;
    match request {
        Initialize => init_bw(),
        RunWndProc => forge::run_wnd_proc(),
        StartGame => unimplemented!(),
    }
}

// Does the rest of initialization that is being done in main thread before running forge's
// window proc.
unsafe fn init_bw() {
    *bw::is_brood_war = 1;
    bw::init_sprites();
    debug!("Process initialized");
}

fn connect_to_client() -> ClientNew<TcpStream> {
    let args = parse_args();
    let url = format!("ws://127.0.0.1:{}", args.server_port);
    info!("Connecting to {} ...", url);
    let mut headers = websocket::header::Headers::new();
    headers.append_raw("x-game-id", args.game_id.into());
    websocket::ClientBuilder::new(&url).unwrap()
        .origin("BROODWARS".into())
        .custom_headers(&headers)
        .async_connect_insecure()
}

enum AsyncMessage {
    Game(GameStateMessage),
    WebSocket(websocket::OwnedMessage),
    Stop,
}

#[derive(Clone)]
pub struct AsyncSenders {
    game_state: Sender<GameStateMessage>,
    websocket: Sender<websocket::OwnedMessage>,
    canceler: Arc<Mutex<Option<cancel_token::Canceler>>>,
}

type BoxedFuture<I, E> = Box<dyn Future<Item = I, Error = E> + Send + 'static>;

impl AsyncSenders {
    fn send(self, message: AsyncMessage) -> BoxedFuture<AsyncSenders, ()> {
        let AsyncSenders {
            game_state,
            websocket,
            canceler,
        } = self;
        match message {
            AsyncMessage::Game(msg) => {
                Box::new(game_state.send(msg)
                    .map(|game_state| AsyncSenders {
                        game_state,
                        websocket,
                        canceler,
                    })
                    .map_err(|_| ()))
            }
            AsyncMessage::WebSocket(msg) => {
                Box::new(websocket.send(msg)
                    .map(|websocket| AsyncSenders {
                        game_state,
                        websocket,
                        canceler,
                    })
                    .map_err(|_| ()))
            }
            AsyncMessage::Stop => {
                info!("Stopping async thread");
                *canceler.lock().unwrap() = None;
                box_future(Ok(AsyncSenders {
                    game_state,
                    websocket,
                    canceler,
                }).into_future())
            }
        }
    }
}

// When Box<dyn Future> is needed, type inference works nicer when going through this function
fn box_future<F, I, E>(future: F) -> BoxedFuture<I, E>
where F: Future<Item = I, Error = E> + Send + 'static
{
    Box::new(future)
}

// Decide what to do with events from game thread.
fn handle_messages_from_game_thread(senders: &AsyncSenders) -> impl Future<Item = (), Error = ()> {
    let (send, recv) = tokio::sync::mpsc::unbounded_channel();
    *SEND_FROM_GAME_THREAD.lock().unwrap() = Some(send);
    let senders = senders.clone();
    recv.map_err(|_| ())
        .filter_map(|message| {
            match message {
                GameThreadMessage::WindowMove(x, y) => {
                    encode_message("/game/windowMove", WindowMove {
                        x,
                        y,
                    }).map(AsyncMessage::WebSocket)
                }
            }
        })
        .fold(senders, |senders, message| {
            senders.send(message)
        }).map(|_| ())
}

// Executes a single connection until it is closed for whatever reason.
// All errors are handled before the future resolves.
fn client_websocket_connection(
    recv_messages: tokio::sync::mpsc::Receiver<websocket::OwnedMessage>,
    senders: &AsyncSenders,
) -> impl Future<Item = (), Error = ()> {
    use websocket::OwnedMessage;
    let senders = senders.clone();
    connect_to_client()
        .then(|result| {
            match result {
                Ok((client, _headers)) => {
                    info!("Connected to Shieldbattery client");
                    let recv_messages = recv_messages
                        .map(|x| AsyncMessage::WebSocket(x))
                        .map_err(|_| ());
                    let (sink, stream) = client.split();
                    let stream_done = stream
                        .filter_map(|message| {
                            match message {
                                OwnedMessage::Text(text) => {
                                    match handle_client_message(text) {
                                        Ok(o) => Some(o),
                                        Err(e) => {
                                            error!("Error handling message: {}", e);
                                            None
                                        }
                                    }
                                }
                                OwnedMessage::Ping(ping) => {
                                    Some(AsyncMessage::WebSocket(OwnedMessage::Pong(ping)))
                                }
                                OwnedMessage::Close(e) => {
                                    Some(AsyncMessage::WebSocket(OwnedMessage::Close(e)))
                                }
                                _ => None,
                            }
                        })
                        .map_err(|e| {
                            error!("Error reading websocket stream: {}", e);
                        })
                        .select(recv_messages)
                        .fold((senders, sink), |(senders, sink), message| {
                            match message {
                                AsyncMessage::WebSocket(ws) => {
                                    debug!("Sending message: {:?}", ws);
                                    let future = sink.send(ws).map(move |x| (senders, x))
                                        .map_err(|e| {
                                            error!("Error sending to websocket stream: {}", e);
                                        });
                                    Box::new(future) as
                                        Box<dyn Future<Item = _, Error = _> + Send>
                                }
                                other => Box::new({
                                    senders.send(other).map(move |x| (x, sink))
                                }),
                            }
                        })
                        .map(|_| ());
                    Box::new(stream_done)
                }
                Err(e) => {
                    error!("Couldn't connect to Shieldbattery: {}", e);
                    box_future(
                        Delay::new(Instant::now() + Duration::from_millis(1000))
                            .map_err(|_| ()) // We don't care about timer errors?
                    )
                }
            }
        })
}

fn websocket_connection_future(
    senders: &AsyncSenders,
    recv_messages: tokio::sync::mpsc::Receiver<websocket::OwnedMessage>,
) -> impl Future<Item = (), Error = ()> {
    use futures::future::Either;
    use tokio::sync::{mpsc, oneshot};

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

    let senders = senders.clone();
    let (send1, send2) = futures::sync::BiLock::new(None);
    let repeat_connection = futures::stream::repeat(())
        .fold(send1, move |send, ()| {
            let (current_send, current_recv) = mpsc::channel(8);
            let current_send = current_send
                .with_flat_map(|vec: Vec<websocket::OwnedMessage>| {
                    futures::stream::iter_ok(vec)
                });

            let senders = senders.clone();
            send.lock()
                .and_then(move |mut locked| {
                    *locked = Some(current_send);
                    let lock = locked.unlock();
                    let connection = client_websocket_connection(current_recv, &senders);
                    connection.map(|()| lock)
                })
        }).map(|_| ());
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

fn async_thread(main_thread: std::sync::mpsc::Sender<()>) {
    // Main async tasks are:
    //
    // 1) Client program websocket
    // 2) Async game state management
    // 3) Task to receive messages from bw
    //
    // Those tasks all send messages to each other, though the main important logic
    // is in 2), the other ones are pretty straightforward decode-message-and-send-to-other-tasks.
    // Async game state is also the only task that gets access to a way to send requests to
    // BW's main thread (request_loop is at `run_main_thread_event_loop`)

    // Decided to go with RouteManager and RallyPoint spawning their tasks implicitly
    // during construction instead of returning a Future to spawn.
    // That'll however requires being in async context during initialization, so
    // call tokio::run right away.
    // Should not really matter.
    tokio::run(future::lazy(|| {
        let (websocket_send, websocket_recv) = tokio::sync::mpsc::channel(32);
        let (game_state_send, game_state_recv) = tokio::sync::mpsc::channel(32);
        let (game_requests_send, game_requests_recv) = std::sync::mpsc::channel();
        let (cancel_token, canceler) = cancel_token::CancelToken::new();
        *GAME_RECEIVE_REQUESTS.lock().unwrap() = Some(game_requests_recv);
        let senders = AsyncSenders {
            game_state: game_state_send,
            websocket: websocket_send,
            canceler: Arc::new(Mutex::new(Some(canceler))),
        };
        let websocket_connection = websocket_connection_future(&senders, websocket_recv);
        let game_state = game_state::create_future(
            &senders,
            game_state_recv,
            main_thread,
            game_requests_send,
        );
        let messages_from_game = handle_messages_from_game_thread(&senders);
        let main_task = game_state.join3(websocket_connection, messages_from_game)
            .map(|_| ());
        cancel_token.bind(main_task)
            .then(|_| {
                debug!("Main async task ended");
                Ok(())
            })
    }));
    info!("Async thread end");
    std::process::exit(0);
}

#[derive(Serialize, Deserialize)]
struct Message {
    command: String,
    payload: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct WindowMove {
    x: i32,
    y: i32,
}

// app/common/game_status.js
const GAME_STATUS_ERROR: u8 = 7;
#[derive(Serialize)]
struct SetupProgress {
    status: SetupProgressInfo,
}

#[derive(Serialize)]
struct SetupProgressInfo {
    state: u8,
    extra: Option<String>,
}

fn encode_message<T: Serialize>(
    command: &str,
    data: T,
) -> Option<websocket::OwnedMessage> {
    fn inner<T: Serialize>(
        command: &str,
        data: T,
    ) -> Result<websocket::OwnedMessage, serde_json::Error> {
        let payload = serde_json::to_value(data)?;
        let message = Message {
            command: command.into(),
            payload: Some(payload),
        };
        let string = serde_json::to_string(&message)?;
        Ok(websocket::OwnedMessage::Text(string))
    }
    match inner(command, data) {
        Ok(o) => Some(o),
        Err(e) => {
            error!("JSON encode error: {}", e);
            None
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

fn handle_client_message<'a>(
    text: String,
) -> Result<AsyncMessage, HandleMessageError> {
    let message: Message = serde_json::from_str(&text)
        .context(("Invalid message", &*text))?;
    let payload = message.payload
        .unwrap_or_else(|| serde_json::Value::Null);
    debug!("Received message: '{}':\n'{}'", message.command, payload);
    match &*message.command {
        "settings" => {
            let settings = serde_json::from_value(payload)
                .context(("Invalid settings", &*text))?;
            Ok(AsyncMessage::Game(GameStateMessage::SetSettings(settings)))
        }
        "localUser" => {
            let user = serde_json::from_value(payload)
                .context(("Invalid local user", &*text))?;
            Ok(AsyncMessage::Game(GameStateMessage::SetLocalUser(user)))
        }
        "routes" => {
            let routes = serde_json::from_value(payload)
                .context(("Invalid routes", &*text))?;
            Ok(AsyncMessage::Game(GameStateMessage::SetRoutes(routes)))
        }
        "setupGame" => {
            let setup = serde_json::from_value(payload)
                .context(("Invalid game setup", &*text))?;
            Ok(AsyncMessage::Game(GameStateMessage::SetupGame(setup)))
        }
        "quit" => Ok(AsyncMessage::Stop),
        _ => {
            Err(HandleMessageError::UnknownCommand(message.command))
        }
    }
}

struct Args {
    game_id: String,
    server_port: u16,
    user_data_path: PathBuf,
}

fn parse_args() -> Args {
    try_parse_args().unwrap_or_else(|| {
        let args = std::env::args_os().collect::<Vec<_>>();
        panic!("Couldn't parse the following args {:?}", args);
    })
}

fn try_parse_args() -> Option<Args> {
    let mut args = std::env::args_os();
    let game_id = args.next()?.into_string().ok()?;
    let server_port = args.next()?.into_string().ok()?.parse::<u16>().ok()?;
    let user_data_path = args.next()?.into();
    Some(Args {
        game_id,
        server_port,
        user_data_path,
    })
}

// Game thread sends something to async tasks
enum GameThreadMessage {
    WindowMove(i32, i32),
}

// Async tasks request game thread to do some work
pub struct GameThreadRequest {
    request_type: GameThreadRequestType,
    // These requests probably won't have any reason to return values on success.
    // If a single one does, it can send a GameThreadMessage.
    done: tokio::sync::oneshot::Sender<()>,
}

struct GameType {
    primary: u8,
    subtype: u8,
}

enum GameThreadRequestType {
    Initialize,
    RunWndProc,
    StartGame,
}

struct JoinGameInfo {
    name: String,
    num_slots: u8,
    num_players: u8,
    map_name: String,
    map_tileset: u8,
    map_width: u32,
    map_height: u32,
}

/// Sends a message from game thread to the async system.
fn game_thread_message(message: GameThreadMessage) {
    // Hopefully waiting on a future (that should immediatly resolve)
    // on the main thread isn't unnecessarily slow.
    // Could use std::sync::mpsc channel if it is.
    let mut send_global = SEND_FROM_GAME_THREAD.lock().unwrap();
    if let Some(send) = send_global.take() {
        if let Ok(send) = send.send(message).wait() {
            *send_global = Some(send);
        }
    } else {
        debug!("Game thread messaging not active");
    }
}
