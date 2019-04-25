/// Hooks and other code that is running on the game/main thread (As opposed to async threads).

use std::sync::Mutex;
use std::sync::mpsc::Receiver;

use lazy_static::lazy_static;
use libc::c_void;

use crate::bw;
use crate::forge;
use crate::snp;

lazy_static! {
    pub static ref SEND_FROM_GAME_THREAD:
        Mutex<Option<tokio::sync::mpsc::UnboundedSender<GameThreadMessage>>> = Mutex::new(None);
    pub static ref GAME_RECEIVE_REQUESTS:
        Mutex<Option<Receiver<GameThreadRequest>>> = Mutex::new(None);
}

// Async tasks request game thread to do some work
pub struct GameThreadRequest {
    request_type: GameThreadRequestType,
    // These requests probably won't have any reason to return values on success.
    // If a single one does, it can send a GameThreadMessage.
    done: tokio::sync::oneshot::Sender<()>,
}

impl GameThreadRequest {
    pub fn new(
        request_type: GameThreadRequestType
    ) -> (GameThreadRequest, tokio::sync::oneshot::Receiver<()>) {
        let (done, wait_done) = tokio::sync::oneshot::channel();
        (GameThreadRequest {
            request_type,
            done,
        }, wait_done)
    }
}

pub enum GameThreadRequestType {
    Initialize,
    RunWndProc,
    StartGame,
    ExitCleanup,
}

// Game thread sends something to async tasks
pub enum GameThreadMessage {
    WindowMove(i32, i32),
    Snp(snp::SnpMessage),
    PlayerJoined,
    Results(GameThreadResults),
}

pub fn player_joined(info: *mut c_void, orig: &Fn(*mut c_void)) {
    // We could get storm id from the event info, but it's not used anywhere atm
    game_thread_message(GameThreadMessage::PlayerJoined);
    orig(info);
}

/// Sends a message from game thread to the async system.
pub fn game_thread_message(message: GameThreadMessage) {
    use futures::{Future, Sink};
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

pub fn run_event_loop() -> ! {
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
    crate::wait_async_exit();
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
        // Saves registry settings etc.
        ExitCleanup => bw::clean_up_for_exit(0),
    }
}

#[derive(Eq, PartialEq, Copy, Clone)]
pub enum PlayerLoseType {
    UnknownChecksumMismatch,
    UnknownDisconnect,
}

pub struct GameThreadResults {
    // Index by ingame player id
    pub victory_state: [u8; 8],
    // Index by storm id
    pub player_has_left: [bool; 8],
    pub player_lose_type: Option<PlayerLoseType>,
    pub time_ms: u32,
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
