#[macro_use]
extern crate log;
#[macro_use]
extern crate whack;

mod app_messages;
mod app_socket;
mod bw;
mod cancel_token;
mod chat;
mod forge;
mod game_state;
mod game_thread;
mod network_manager;
mod observing;
mod rally_point;
mod snp;
mod storm;
mod udp;
mod windows;

use std::ffi::{CStr, OsStr};
use std::fs::File;
use std::io;
use std::path::PathBuf;
use std::ptr::null_mut;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use lazy_static::lazy_static;
use libc::c_void;
use tokio::prelude::*;
use winapi::um::processthreadsapi::{GetCurrentProcess, TerminateProcess};
use winapi::um::winnt::HANDLE;

use crate::game_state::GameStateMessage;
use crate::game_thread::GameThreadMessage;

const WAIT_DEBUGGER: bool = false;

fn remove_lines(file: &mut File, limit: usize, truncate_to: usize) -> io::Result<()> {
    use io::{BufRead, BufReader, Seek, SeekFrom};

    assert!(limit >= truncate_to);
    // This implementation is obviously somewhat inefficient but does the job.
    // Maybe there's a library to do this?
    let mut buffered = BufReader::new(&mut *file);
    buffered.seek(SeekFrom::Start(0))?;
    let line_count = buffered.lines().take_while(|x| x.is_ok()).count();
    if line_count > limit {
        let mut buffered = BufReader::new(&mut *file);
        buffered.seek(SeekFrom::Start(0))?;
        let mut buf = String::new();
        for _ in 0..(line_count - truncate_to) {
            buffered.read_line(&mut buf)?;
        }
        // Read the remaining lines and write them back after clearing the file
        let mut rest = Vec::new();
        // Sanity limit at 16MB to not read some dumb 2GB log file to memory at once
        buffered.take(16_000_000).read_to_end(&mut rest)?;
        file.seek(SeekFrom::Start(0))?;
        file.set_len(0)?;
        file.write_all(&rest)?;
    }
    file.seek(SeekFrom::End(0))?;
    Ok(())
}

fn log_file() -> File {
    use std::os::windows::fs::OpenOptionsExt;
    let args = parse_args();
    let dir = args.user_data_path.join("logs");
    let mut options = std::fs::OpenOptions::new();
    let options = options.read(true).write(true).create(true).share_mode(1); // FILE_SHARE_READ
    for i in 0..20 {
        let filename = dir.join(format!("shieldbattery.{}.log", i));
        if let Ok(mut file) = options.open(filename) {
            let result = remove_lines(&mut file, 10000, 5000);
            // Add blank lines to make start of the session a bit clearer.
            let _ = write!(
                &mut file,
                "\n--------------------------------------------\n"
            );
            if let Err(e) = result {
                let _ = writeln!(&mut file, "Couldn't truncate lines: {}", e);
            }
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
pub extern "C" fn OnInject() {
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
        .level_for("tokio_reactor", log::LevelFilter::Warn) // Too spammy otherwise
        .chain(log_file())
        .apply();

    info!("Logging started");
    std::panic::set_hook(Box::new(panic_hook));
    unsafe {
        patch_game();
    }
}

#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "stdcall" fn SnpBind(index: u32, functions: *mut *const bw::SnpFunctions) -> u32 {
    // we only have one provider, so any index over that is an error
    if index > 0 || functions.is_null() {
        return 0;
    }
    *functions = &snp::SNP_FUNCTIONS;
    1
}

lazy_static! {
    static ref PATCHER: Mutex<whack::Patcher> = Mutex::new(whack::Patcher::new());
}

unsafe fn patch_game() {
    use observing::with_replay_flag_if_obs;

    whack_export!(pub extern "system" CreateEventA(*mut c_void, u32, u32, *const i8) -> *mut c_void);
    whack_export!(pub extern "system" DeleteFileA(*const i8) -> u32);
    whack_export!(pub extern "system"
        CreateFileA(*const i8, u32, u32, *mut c_void, u32, u32, *mut c_void) -> HANDLE
    );

    let mut active_patcher = PATCHER.lock().unwrap();
    forge::init_hooks(&mut active_patcher);
    snp::init_hooks(&mut active_patcher);

    let mut exe = active_patcher.patch_exe(0x0040_0000);
    bw::init_funcs(&mut exe);
    bw::init_vars(&mut exe);
    exe.hook_opt(bw::WinMain, entry_point_hook);
    exe.hook(bw::GameInit, process_init_hook);
    exe.hook_opt(bw::OnSNetPlayerJoined, game_thread::player_joined);
    exe.hook_opt(bw::ChatCommand, chat::chat_command_hook);
    exe.hook_opt(bw::ScrollScreen, scroll_screen);
    // Rendering during InitSprites is useless and wastes a bunch of time, so we no-op it
    exe.replace(bw::INIT_SPRITES_RENDER_ONE, &[0x90, 0x90, 0x90, 0x90, 0x90]);
    exe.replace(bw::INIT_SPRITES_RENDER_TWO, &[0x90, 0x90, 0x90, 0x90, 0x90]);

    exe.hook_closure(bw::MinimapCtrl_InitButton, |a, orig| {
        with_replay_flag_if_obs(|| orig(a))
    });
    exe.hook_closure(bw::MinimapCtrl_ShowAllianceDialog, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    exe.hook_closure(bw::DrawMinimap, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    // Bw force refreshes the minimap every second?? why
    // And of course the DrawMinimap call in it is inlined so it has to be hooked separately.
    exe.hook_closure(bw::Minimap_TimerRefresh, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    exe.hook_closure(bw::RedrawScreen, |orig| {
        with_replay_flag_if_obs(|| orig())
    });
    exe.hook_closure(
        bw::AllianceDialog_EventHandler,
        |a, b, orig| with_replay_flag_if_obs(|| orig(a, b)),
    );
    exe.hook_closure(bw::GameScreenLeftClick, |a, orig| {
        with_replay_flag_if_obs(|| orig(a))
    });
    exe.hook_closure(bw::PlaySoundAtPos, |a, b, c, d, orig| {
        with_replay_flag_if_obs(|| orig(a, b, c, d))
    });
    exe.hook_closure(bw::DrawResourceCounts, |a, b, orig| {
        with_replay_flag_if_obs(|| orig(a, b))
    });
    exe.hook_opt(bw::ProcessCommands, observing::process_commands_hook);
    exe.hook_opt(bw::Command_Sync, observing::sync_command_hook);
    exe.hook_opt(bw::ChatMessage, observing::chat_message_hook);
    exe.hook_opt(bw::LoadDialog, observing::load_dialog_hook);
    exe.hook_opt(bw::InitUiVariables, observing::init_ui_variables_hook);
    exe.hook_opt(bw::UpdateCommandCard, observing::update_command_card_hook);
    exe.hook_opt(
        bw::CmdBtn_EventHandler,
        observing::cmdbtn_event_handler_hook,
    );
    exe.hook_opt(bw::DrawCommandButton, observing::draw_command_button_hook);
    exe.hook_opt(bw::GetGluAllString, observing::get_gluall_string_hook);
    exe.hook_opt(
        bw::UpdateNetTimeoutPlayers,
        observing::update_net_timeout_players,
    );
    exe.hook_opt(
        bw::CenterScreenOnOwnStartLocation,
        observing::center_screen_on_start_location,
    );

    exe.import_hook_opt(&b"kernel32"[..], CreateEventA, create_event_hook);
    exe.import_hook_opt(&b"kernel32"[..], DeleteFileA, delete_file_hook);
    exe.import_hook_opt(&b"kernel32"[..], CreateFileA, create_file_hook);

    // Check for a rare-but-dumb storm bug where the codegen for unrolled memcpy/blitting
    // does an OOB string read and ends up generating broken code.
    // (This data is initialized in storm's DllMain, so it has run already)
    let surface_copy_code_ptr = *bw::storm::surface_copy_code;
    if !surface_copy_code_ptr.is_null() {
        let surface_copy_code = (*surface_copy_code_ptr).code_offsets[0xa0];
        if *surface_copy_code.add(1) != 6 {
            for i in 0..0xa0 {
                *surface_copy_code.add(i * 0x10 + 0x1) = 0x6;
                *surface_copy_code.add(i * 0x10 + 0x9) = 0x7;
            }
        }
    }
}

fn scroll_screen(orig: unsafe extern fn()) {
    if !forge::input_disabled() {
        unsafe {
            orig();
        }
    }
}

unsafe fn create_event_hook(
    security: *mut c_void,
    init_state: u32,
    manual_reset: u32,
    name: *const i8,
    orig: unsafe extern fn(*mut c_void, u32, u32, *const i8) -> *mut c_void,
) -> *mut c_void {
    use winapi::um::errhandlingapi::SetLastError;
    if !name.is_null() {
        if CStr::from_ptr(name).to_str() == Ok("Starcraft Check For Other Instances") {
            // BW just checks last error to be ERROR_ALREADY_EXISTS
            SetLastError(0);
            return null_mut();
        }
    }
    orig(security, init_state, manual_reset, name)
}

fn ascii_path_filename(val: &[u8]) -> &[u8] {
    val.rsplit(|&x| x == b'/' || x == b'\\')
        .skip_while(|x| x.is_empty())
        .next()
        .unwrap_or_else(|| &[])
}

#[test]
fn test_ascii_path_filename() {
    assert_eq!(ascii_path_filename(b"asd/qwe/zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"asd/qwe/z/c/"), b"c");
    assert_eq!(ascii_path_filename(b"asd/qwe\\zxc.rep"), b"zxc.rep");
    assert_eq!(ascii_path_filename(b"asd\\qwe//zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"\\zxc"), b"zxc");
    assert_eq!(ascii_path_filename(b"zxc///\\"), b"zxc");
    assert_eq!(ascii_path_filename(b"\\zxc\\"), b"zxc");
    assert_eq!(ascii_path_filename(b"\\/\\"), b"");
}

unsafe fn delete_file_hook(filename: *const i8, orig: unsafe extern fn(*const i8) -> u32) -> u32 {
    if ascii_path_filename(CStr::from_ptr(filename).to_bytes()) == b"LastReplay.rep" {
        // Before saving the last replay BW first tries to delete it, which can fail.
        // We no-op it since we're saving the last replay ourselves.
        1
    } else {
        orig(filename)
    }
}

fn get_documents_path() -> Result<PathBuf, io::Error> {
    use winapi::um::combaseapi::CoTaskMemFree;
    use winapi::um::knownfolders::FOLDERID_Documents;
    use winapi::um::shlobj::SHGetKnownFolderPath;

    unsafe {
        let mut path = null_mut();
        let error = SHGetKnownFolderPath(&FOLDERID_Documents, 0, null_mut(), &mut path);
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error));
        }
        let len = (0..).find(|&x| *path.add(x) == 0).unwrap();
        let slice = std::slice::from_raw_parts(path, len);
        let result = windows::os_string_from_winapi(slice);
        CoTaskMemFree(path as *mut _);
        Ok(result.into())
    }
}

fn initial_number(path: &OsStr) -> u32 {
    use std::os::windows::ffi::OsStrExt;
    // Trickery to parse the initial number without assuming UTF-8 filename..
    path.encode_wide()
        .take_while(|&x| x >= b'0' as u16 && x <= b'9' as u16)
        .fold(0, |old, new| {
            old.wrapping_mul(10)
                .wrapping_add((new - b'0' as u16) as u32)
        })
}

#[test]
fn test_initial_number() {
    assert_eq!(initial_number(OsStr::new("123asdhk")), 123);
    assert_eq!(initial_number(OsStr::new("asd")), 0);
    assert_eq!(initial_number(OsStr::new("a234sd")), 0);
    assert_eq!(initial_number(OsStr::new("1")), 1);
    assert_eq!(initial_number(OsStr::new("001241.rep")), 1241);
    assert_ne!(
        initial_number(OsStr::new("100000000000000000001241.rep")),
        0
    );
}

unsafe fn create_file_hook(
    filename: *const i8,
    access: u32,
    share_mode: u32,
    security_attributes: *mut c_void,
    creation_disposition: u32,
    flags: u32,
    template: *mut c_void,
    orig: unsafe extern fn(*const i8, u32, u32, *mut c_void, u32, u32, *mut c_void) -> HANDLE,
) -> HANDLE {
    use winapi::um::fileapi::CreateFileW;
    use winapi::um::handleapi::INVALID_HANDLE_VALUE;

    if ascii_path_filename(CStr::from_ptr(filename).to_bytes()) != b"LastReplay.rep" {
        return orig(
            filename,
            access,
            share_mode,
            security_attributes,
            creation_disposition,
            flags,
            template,
        );
    }

    let documents_path = match get_documents_path() {
        Ok(o) => o,
        Err(e) => {
            error!("Couldn't retrieve user's document folder path: {}", e);
            return INVALID_HANDLE_VALUE;
        }
    };
    let replay_folder = documents_path.join("Starcraft\\maps\\replays\\Auto");
    if !replay_folder.is_dir() {
        if let Err(e) = std::fs::create_dir_all(&replay_folder) {
            error!(
                "Couldn't create replay folder '{}': {}",
                replay_folder.display(),
                e
            );
            return INVALID_HANDLE_VALUE;
        }
    }

    let entries = match std::fs::read_dir(&replay_folder) {
        Ok(o) => o,
        Err(e) => {
            error!(
                "Couldn't read replay folder '{}': {}",
                replay_folder.display(),
                e
            );
            return INVALID_HANDLE_VALUE;
        }
    };
    let mut count = 0;
    for entry in entries {
        let entry = match entry {
            Ok(o) => o,
            Err(e) => {
                error!(
                    "Couldn't read replay folder '{}': {}",
                    replay_folder.display(),
                    e
                );
                return INVALID_HANDLE_VALUE;
            }
        };
        let path = entry.path();
        if path.extension() == Some(OsStr::new("rep")) {
            if let Some(file_stem) = path.file_stem() {
                count = count.max(initial_number(file_stem));
            }
        }
    }
    let filename = format!(
        "{:04}_{}.rep",
        count + 1,
        chrono::Local::now().format("%Y-%m-%d")
    );
    CreateFileW(
        windows::winapi_str(replay_folder.join(filename)).as_ptr(),
        access,
        share_mode,
        security_attributes as *mut _,
        creation_disposition,
        flags,
        template,
    )
}

unsafe fn entry_point_hook(
    a1: *mut c_void,
    a2: *mut c_void,
    a3: *const u8,
    a4: i32,
    orig: unsafe extern fn(*mut c_void, *mut c_void, *const u8, i32) -> i32,
) -> i32 {
    if WAIT_DEBUGGER {
        let start = Instant::now();
        while winapi::um::debugapi::IsDebuggerPresent() == 0 {
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
    game_thread::run_event_loop()
}

type BoxedFuture<I, E> = Box<dyn Future<Item = I, Error = E> + Send + 'static>;

// When Box<dyn Future> is needed, type inference works nicer when going through this function
fn box_future<F, I, E>(future: F) -> BoxedFuture<I, E>
where
    F: Future<Item = I, Error = E> + Send + 'static,
{
    Box::new(future)
}

// Decide what to do with events from game thread.
fn handle_messages_from_game_thread(
    ws_send: app_socket::SendMessages,
    game_send: game_state::SendMessages,
) -> impl Future<Item = (), Error = ()> {
    use crate::app_messages::WindowMove;
    use futures::future::Either;

    enum ReplyType {
        WebSocket(websocket::OwnedMessage),
        Game(GameStateMessage),
    }

    let (send, recv) = tokio::sync::mpsc::unbounded_channel();
    *crate::game_thread::SEND_FROM_GAME_THREAD.lock().unwrap() = Some(send);
    recv.map_err(|_| ())
        .filter_map(|message| match message {
            GameThreadMessage::WindowMove(x, y) => {
                app_socket::encode_message("/game/windowMove", WindowMove { x, y })
                    .map(ReplyType::WebSocket)
            }
            GameThreadMessage::Snp(snp) => Some(ReplyType::Game(GameStateMessage::Snp(snp))),
            GameThreadMessage::PlayerJoined => {
                Some(ReplyType::Game(GameStateMessage::PlayerJoined))
            }
            GameThreadMessage::Results(results) => {
                Some(ReplyType::Game(GameStateMessage::Results(results)))
            }
        })
        .fold((ws_send, game_send), |(ws_send, game_send), message| {
            match message {
                ReplyType::WebSocket(msg) => Either::A(ws_send.send(msg).map(|x| (x, game_send))),
                ReplyType::Game(msg) => Either::B(game_send.send(msg).map(|x| (ws_send, x))),
            }
            .map_err(|_| ())
        })
        .map(|_| ())
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
    //
    // The overall way the important tasks communicate is:
    //
    //      recv_game_thread_messages
    //          |                |
    //          |                |
    //          v                v
    //      app_socket ---> game_state ---> network_manager --- rally_point <--- udp_recv
    //                          |                                |      \
    //                          |                                |       ---> udp_send
    //                      send to game_thread (not async)      |
    //                                              \            v
    //                                               \------active network [1]
    //
    //  Some communicate in both ways, the arrows represent that the task gets blocked if
    //  the receiving tasks message buffer is full. This avoids having to spawn tasks and nicely
    //  throttles things if, say, outside world sends data faster than we can handle.
    //  If there were a cycle with blocking, it could lead into all tasks in the cycle getting
    //  stuck, so that has to be avoided. So in cases where two tasks want to send messages
    //  both ways, at least one of them has to spawn a child task every time it wants to send
    //  something.
    //
    //  [1] Rally-point task blocks on sending the received data to anyone who has started
    //  listening to it, which practically is just a child task of the network manager task, but
    //  not the main task which receives messages from game_state.
    //  Not sure if that's the smartest way to do that.
    tokio::run(future::lazy(|| {
        let (websocket_send, websocket_recv) = tokio::sync::mpsc::channel(32);
        let (game_state_send, game_state_recv) = tokio::sync::mpsc::channel(128);
        let (game_requests_send, game_requests_recv) = std::sync::mpsc::channel();
        let (cancel_token, canceler) = cancel_token::CancelToken::new();
        *crate::game_thread::GAME_RECEIVE_REQUESTS.lock().unwrap() = Some(game_requests_recv);
        let canceler = cancel_token::SharedCanceler::new(canceler);
        let websocket_connection =
            app_socket::websocket_connection_future(&game_state_send, &canceler, websocket_recv);
        let game_state = game_state::create_future(
            websocket_send.clone(),
            canceler,
            game_state_recv,
            main_thread,
            game_requests_send,
        );
        let messages_from_game = handle_messages_from_game_thread(websocket_send, game_state_send);
        let main_task = game_state
            .join3(websocket_connection, messages_from_game)
            .map(|_| ());
        cancel_token.bind(main_task).then(|_| {
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
