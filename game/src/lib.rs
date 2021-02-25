#![recursion_limit="1024"] // Required for futures::select

#[macro_use]
extern crate log;
#[macro_use]
extern crate whack;

#[macro_use]
mod hook_macro;

mod app_messages;
mod app_socket;
mod bw;
mod bw_1161;
mod bw_scr;
mod cancel_token;
mod chat;
mod crash_dump;
mod forge;
mod game_state;
mod game_thread;
mod network_manager;
mod rally_point;
mod replay;
mod snp;
mod udp;
mod windows;

use std::fs::File;
use std::io;
use std::mem;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use lazy_static::lazy_static;
use libc::c_void;
use parking_lot::Mutex;
use winapi::um::processthreadsapi::{GetCurrentProcess, GetCurrentProcessId, TerminateProcess};
use winapi::um::winnt::EXCEPTION_POINTERS;

use crate::game_state::GameStateMessage;
use crate::game_thread::GameThreadMessage;

const WAIT_DEBUGGER: bool = false;

fn remove_lines(file: &mut File, limit: usize, truncate_to: usize) -> io::Result<()> {
    use io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};

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
    use std::io::Write;
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

    static ALREADY_PANICKING: AtomicBool = AtomicBool::new(false);

    fn backtrace() -> String {
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

    let already_panicking = ALREADY_PANICKING.swap(true, Ordering::Relaxed);
    if already_panicking {
        // Another thread is already panicking. This may either mean that
        // a) Two threads happened to panic simultaneously
        // or
        // b) the minidump thread started below panicked.
        // Wait a bit in case this is case a), and if the process is still alive,
        // log this panic and abort (Without writing minidump so that we don't get
        // recursive case `b`s)
        std::thread::sleep(std::time::Duration::from_millis(5000));
        debug!("Another thread panicked after the first panic:");
        return;
    }

    let mut msg = String::new();
    let location = match info.location() {
        Some(s) => format!("{}:{}", s.file(), s.line()),
        None => format!("unknown location"),
    };
    writeln!(msg, "Panic at {}", location).unwrap();
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
    if !already_panicking {
        // Write minidump in a separate thread so that this thread's stack will be accurate.
        let result = std::thread::spawn(move || {
            unsafe {
                crash_dump::write_minidump_to_default_path(std::ptr::null_mut())
            }
        }).join();
        match result {
            Ok(Ok(())) => (),
            Ok(Err(e)) => {
                error!("Unable to write minidump: {}", e);
            }
            Err(_) => {
                // This should be unreachable, as this dll is being compiled to abort on panics
                error!("Minidump writing thread panicked");
            }
        }
    }
    // TODO Probs tell how to report, where to get log file etc
    windows::message_box("Shieldbattery crash :(", &format!("{}\n{}", location, panic_msg));
    unsafe {
        TerminateProcess(GetCurrentProcess(), 0x4230daef);
    }
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn OnInject() {
    std::panic::set_hook(Box::new(panic_hook));
    unsafe {
        crash_dump::init_crash_handler();
    }
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

    let process_id = unsafe { GetCurrentProcessId() };
    info!("Logging started. Process id {} (0x{:x})", process_id, process_id);
    let args = parse_args();
    if args.is_scr {
        unsafe {
            let init_helper = load_init_helper().expect("Unable to load sb_init.dll");
            init_helper(scr_init, crash_dump::cdecl_crash_dump);
        }
    } else {
        let bw = Box::leak(Box::new(bw_1161::Bw1161));
        unsafe {
            bw.patch_game();
        }
        bw::set_bw_impl(bw);
    }
}

unsafe extern "C" fn scr_init(image: *mut u8) {
    if WAIT_DEBUGGER {
        debug!("Waiting for debugger");
        let start = std::time::Instant::now();
        while winapi::um::debugapi::IsDebuggerPresent() == 0 {
            std::thread::sleep(std::time::Duration::from_millis(10));
            if start.elapsed().as_secs() > 100 {
                std::process::exit(0);
            }
        }
        debug!("Debugger ok");
    }
    debug!("SCR init");
    let bw = match bw_scr::BwScr::new() {
        Ok(o) => Box::leak(Box::new(o)),
        Err(e) => panic!("StarCraft version not supported: Couldn't find '{}'", e),
    };
    bw.patch_game(image);
    bw::set_bw_impl(bw);
}

static SELF_HANDLE: AtomicUsize = AtomicUsize::new(0);

#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "system" fn DllMain(
    instance: usize,
    ul_reason_for_call: u32,
    _reserved: *mut c_void,
) -> u32
{
    // DLL_PROCESS_ATTACH
    if ul_reason_for_call == 1 {
        SELF_HANDLE.store(instance, Ordering::Relaxed);
    }
    1
}

type InitHelperOnDone = unsafe extern "C" fn(*mut u8);
type InitHelperOnCrash = unsafe extern "C" fn(*mut EXCEPTION_POINTERS) -> !;
type InitHelperFn = unsafe extern "C" fn(InitHelperOnDone, InitHelperOnCrash);
unsafe fn load_init_helper() -> Result<InitHelperFn, io::Error> {
    let self_handle = SELF_HANDLE.load(Ordering::Relaxed);
    assert_ne!(self_handle, 0);
    let dll_path = windows::module_name(self_handle as *mut _)
        .and_then(|path| {
            Path::new(&path).parent()
                .map(|path| path.join("sb_init.dll"))
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "Unable to get DLL path"))?;
    let dll = windows::load_library(&dll_path)?;
    let address = dll.proc_address("sb_init")?;
    // Leak the DLL as it should be kept alive for entire process
    mem::forget(dll);
    Ok(mem::transmute(address))
}

/// 1.16.1 calls LoadLibrary + GetProcAddress(SnpBind) on this dll to get networking functions.
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
    static ref ASYNC_RUNTIME: Mutex<Option<tokio::runtime::Handle>> = Mutex::new(None);
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

/// Task that registers itself to receive messages from game thread and forwards them
/// to the arguments given to function.
async fn handle_messages_from_game_thread(
    mut ws_send: app_socket::SendMessages,
    mut game_send: game_state::SendMessages,
) {
    use crate::app_messages::WindowMove;
    use futures::prelude::*;

    let (send, mut recv) = tokio::sync::mpsc::unbounded_channel();
    *crate::game_thread::SEND_FROM_GAME_THREAD.lock().unwrap() = Some(send);
    while let Some(message) = recv.next().await {
        let result = match message {
            GameThreadMessage::WindowMove(x, y) => {
                let msg = app_socket::encode_message("/game/windowMove", WindowMove { x, y });
                if let Some(msg) = msg {
                    ws_send.send(msg).await.map_err(|_| ())
                } else {
                    Ok(())
                }
            }
            other => {
                game_send.send(GameStateMessage::GameThread(other)).await.map_err(|_| ())
            }
        };
        if result.is_err() {
            break;
        }
    }
}

fn async_thread(main_thread: std::sync::mpsc::Sender<()>) {
    use futures::prelude::*;
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
    let mut runtime = tokio::runtime::Runtime::new().unwrap();
    let handle = runtime.handle();
    *ASYNC_RUNTIME.lock() = Some(handle.clone());
    runtime.block_on(future::lazy(|_| ()).then(|()| {
        let (websocket_send, websocket_recv) = tokio::sync::mpsc::channel(32);
        let (game_state_send, game_state_recv) = tokio::sync::mpsc::channel(128);
        let (game_requests_send, game_requests_recv) = std::sync::mpsc::channel();
        let (cancel_token, canceler) = cancel_token::CancelToken::new();
        *crate::game_thread::GAME_RECEIVE_REQUESTS.lock().unwrap() = Some(game_requests_recv);
        let canceler = cancel_token::SharedCanceler::new(canceler);
        let websocket_connection = app_socket::websocket_connection_future(
            game_state_send.clone(),
            canceler.clone(),
            websocket_recv,
        );
        let game_state = game_state::create_future(
            websocket_send.clone(),
            canceler,
            game_state_recv,
            main_thread,
            game_requests_send,
        );
        let messages_from_game = handle_messages_from_game_thread(websocket_send, game_state_send);
        let main_task = future::join3(game_state, websocket_connection, messages_from_game)
            .map(|_| ());
        cancel_token.bind(main_task.boxed()).inspect(|_| {
            debug!("Main async task ended");
        }).map(|_| ())
    }));
    drop(runtime);
    info!("Async thread end");
    std::process::exit(0);
}

/// Obtains a handle to async runtime, which can be used to spawn additional tasks
/// that would block on sync I/O.
/// Currently this is used to eagerly open some filesystem files to speed up SCR loading.
fn async_handle() -> tokio::runtime::Handle {
    ASYNC_RUNTIME.lock().as_ref().expect("Async runtime was not initialized").clone()
}

struct Args {
    game_id: String,
    server_port: u16,
    user_data_path: PathBuf,
    is_scr: bool,
}

// TODO: This function should probably cache the result instead of recomputing
// it several times. It's not really slow relative to anything but unnecessary
// work is unnecessary.
fn parse_args() -> Args {
    try_parse_args().unwrap_or_else(|| {
        let args = std::env::args_os().collect::<Vec<_>>();
        panic!("Couldn't parse the following args {:?}", args);
    })
}

fn try_parse_args() -> Option<Args> {
    let mut args = std::env::args_os();
    // Skip over exe path
    args.next()?;
    let game_id = args.next()?.into_string().ok()?;
    let server_port = args.next()?.into_string().ok()?.parse::<u16>().ok()?;
    let user_data_path = args.next()?.into();
    let is_scr = args.next()
        .and_then(|x| x.into_string().ok())
        .filter(|x| x == "-launch")
        .is_some();

    Some(Args {
        game_id,
        server_port,
        user_data_path,
        is_scr,
    })
}
