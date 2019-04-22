#[macro_use] extern crate log;
#[macro_use] extern crate whack;

mod app_socket;
mod app_messages;
mod bw;
mod cancel_token;
mod forge;
mod game_state;
mod network_manager;
mod rally_point;
mod snp;
mod storm;
mod udp;
mod windows;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lazy_static::lazy_static;
use libc::c_void;
use tokio::prelude::*;
use tokio::sync::mpsc::Sender;
use winapi::um::processthreadsapi::{GetCurrentProcess, TerminateProcess};

use crate::game_state::{GameStateMessage};

const WAIT_DEBUGGER: bool = false;

fn log_file() -> std::fs::File {
    use std::os::windows::fs::OpenOptionsExt;
    let args = parse_args();
    let dir = args.user_data_path.join("logs");
    let mut options = std::fs::OpenOptions::new();
    let options = options
        .write(true)
        .create(true)
        .append(true)
        .share_mode(1); // FILE_SHARE_READ
    for i in 0..20 {
        let filename = dir.join(format!("shieldbattery.{}.log", i));
        // TODO shorten long files
        if let Ok(file) = options.open(filename) {
            return file;
        }
    }
    // Maybe shouldn't panic?
    panic!("Unable to start logging");
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
    let _ = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{}[{}:{}][{}] {}",
                chrono::Local::now().format("[%Y-%m-%d][%H:%M:%S%.3f]"),
                record.file().unwrap_or(""),
                record.line().unwrap_or(0),
                record.level(),
                message
            ))
        })
        .level(log::LevelFilter::Debug)
        .chain(log_file())
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
    whack_export!(pub extern "system" CreateEventA(*mut c_void, u32, u32, *const i8) -> *mut c_void);

    let mut active_patcher = PATCHER.lock().unwrap();
    forge::init_hooks(&mut active_patcher);
    snp::init_hooks(&mut active_patcher);

    let mut exe = active_patcher.patch_exe(0x0040_0000);
    bw::init_funcs(&mut exe);
    bw::init_vars(&mut exe);
    exe.hook_opt(bw::WinMain, entry_point_hook);
    exe.hook(bw::GameInit, process_init_hook);
    exe.hook_opt(bw::OnSNetPlayerJoined, player_joined);
    // Rendering during InitSprites is useless and wastes a bunch of time, so we no-op it
    exe.replace(bw::INIT_SPRITES_RENDER_ONE, &[0x90, 0x90, 0x90, 0x90, 0x90]);
    exe.replace(bw::INIT_SPRITES_RENDER_TWO, &[0x90, 0x90, 0x90, 0x90, 0x90]);

    exe.import_hook_opt(&b"kernel32"[..], CreateEventA, create_event_hook);
}

unsafe fn create_event_hook(
    security: *mut c_void,
    init_state: u32,
    manual_reset: u32,
    name: *const i8,
    orig: &Fn(*mut c_void, u32, u32, *const i8) -> *mut c_void,
) -> *mut c_void {
    use winapi::um::errhandlingapi::SetLastError;
    if !name.is_null() {
        if std::ffi::CStr::from_ptr(name).to_str() == Ok("Starcraft Check For Other Instances") {
            // BW just checks last error to be ERROR_ALREADY_EXISTS
            SetLastError(0);
            return std::ptr::null_mut();
        }
    }
    orig(security, init_state, manual_reset, name)
}

fn player_joined(info: *mut c_void, orig: &Fn(*mut c_void)) {
    // We could get storm id from the event info, but it's not used anywhere atm
    game_thread_message(GameThreadMessage::PlayerJoined);
    orig(info);
}

fn entry_point_hook(
    a1: *mut c_void,
    a2: *mut c_void,
    a3: *const u8,
    a4: i32,
    orig: &Fn(*mut c_void, *mut c_void, *const u8, i32) -> i32,
) -> i32 {
    if WAIT_DEBUGGER {
        let start = Instant::now();
        while unsafe { winapi::um::debugapi::IsDebuggerPresent() == 0 } {
            std::thread::sleep(Duration::from_millis(10));
            if start.elapsed().as_secs() > 100 {
                std::process::exit(0);
            }
        }
    }
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
    if let Err(_) = receiver.recv() {
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
        StartGame => {
            forge::game_started();
            *bw::game_state = 3; // Playing
            bw::game_loop();
            let results = game_results();
            game_thread_message(GameThreadMessage::Results(results));
            forge::hide_window();
        }
    }
}

#[derive(Eq, PartialEq, Copy, Clone)]
enum PlayerLoseType {
    UnknownChecksumMismatch,
    UnknownDisconnect,
}

pub struct GameThreadResults {
    // Index by ingame player id
    victory_state: [u8; 8],
    // Index by storm id
    player_has_left: [bool; 8],
    player_lose_type: Option<PlayerLoseType>,
    time_ms: u32,
}

unsafe fn game_results() -> GameThreadResults {
    GameThreadResults {
        victory_state: *bw::victory_state,
        player_has_left: {
            let mut arr = [false; 8];
            for i in 0..8 {
                arr[i] = bw::player_has_left[i] != 0;
            }
            arr
        },
        player_lose_type: match *bw::player_lose_type {
            1 => Some(PlayerLoseType::UnknownChecksumMismatch),
            2 => Some(PlayerLoseType::UnknownDisconnect),
            _ => None,
        },
        // Assuming fastest speed
        time_ms: (*bw::frame_count).saturating_mul(42),
    }
}

// Does the rest of initialization that is being done in main thread before running forge's
// window proc.
unsafe fn init_bw() {
    *bw::is_brood_war = 1;
    bw::init_sprites();
    debug!("Process initialized");
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
    use crate::app_messages::{WindowMove};

    let (send, recv) = tokio::sync::mpsc::unbounded_channel();
    *SEND_FROM_GAME_THREAD.lock().unwrap() = Some(send);
    let senders = senders.clone();
    recv.map_err(|_| ())
        .filter_map(|message| {
            match message {
                GameThreadMessage::WindowMove(x, y) => {
                    app_socket::encode_message("/game/windowMove", WindowMove {
                        x,
                        y,
                    }).map(AsyncMessage::WebSocket)
                }
                GameThreadMessage::Snp(snp) => {
                    Some(AsyncMessage::Game(GameStateMessage::Snp(snp)))
                }
                GameThreadMessage::PlayerJoined => {
                    Some(AsyncMessage::Game(GameStateMessage::PlayerJoined))
                }
                GameThreadMessage::Results(results) => {
                    Some(AsyncMessage::Game(GameStateMessage::Results(results)))
                }
            }
        })
        .fold(senders, |senders, message| {
            senders.send(message)
        }).map(|_| ())
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
        let (game_state_send, game_state_recv) = tokio::sync::mpsc::channel(128);
        let (game_requests_send, game_requests_recv) = std::sync::mpsc::channel();
        let (cancel_token, canceler) = cancel_token::CancelToken::new();
        *GAME_RECEIVE_REQUESTS.lock().unwrap() = Some(game_requests_recv);
        let senders = AsyncSenders {
            game_state: game_state_send,
            websocket: websocket_send,
            canceler: Arc::new(Mutex::new(Some(canceler))),
        };
        let websocket_connection =
            app_socket::websocket_connection_future(&senders, websocket_recv);
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
    Snp(snp::SnpMessage),
    PlayerJoined,
    Results(GameThreadResults),
}

// Async tasks request game thread to do some work
pub struct GameThreadRequest {
    request_type: GameThreadRequestType,
    // These requests probably won't have any reason to return values on success.
    // If a single one does, it can send a GameThreadMessage.
    done: tokio::sync::oneshot::Sender<()>,
}

enum GameThreadRequestType {
    Initialize,
    RunWndProc,
    StartGame,
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
