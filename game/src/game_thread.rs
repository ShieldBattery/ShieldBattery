//! Hooks and other code that is running on the game/main thread (As opposed to async threads).

use std::sync::mpsc::Receiver;
use std::sync::Mutex;

use lazy_static::lazy_static;

use crate::bw::{self, with_bw};
use crate::forge;
use crate::snp;

lazy_static! {
    pub static ref SEND_FROM_GAME_THREAD: Mutex<Option<tokio::sync::mpsc::UnboundedSender<GameThreadMessage>>> =
        Mutex::new(None);
    pub static ref GAME_RECEIVE_REQUESTS: Mutex<Option<Receiver<GameThreadRequest>>> =
        Mutex::new(None);
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
        request_type: GameThreadRequestType,
    ) -> (GameThreadRequest, tokio::sync::oneshot::Receiver<()>) {
        let (done, wait_done) = tokio::sync::oneshot::channel();
        (GameThreadRequest { request_type, done }, wait_done)
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
    /// Storm player id (which stays stable) -> game player id mapping.
    /// Once this message is sent, any game player ids used so far should be
    /// considered invalid and updated to match this mappin
    PlayersRandomized([Option<u8>; bw::MAX_STORM_PLAYERS]),
    Results(GameThreadResults),
}

/// Sends a message from game thread to the async system.
pub fn send_game_msg_to_async(message: GameThreadMessage) {
    let send_global = SEND_FROM_GAME_THREAD.lock().unwrap();
    if let Some(ref send) = *send_global {
        let _ = send.send(message);
    } else {
        debug!("Game thread messaging not active");
    }
}

pub fn run_event_loop() -> ! {
    debug!("Main thread reached event loop");
    let mut receive_requests = GAME_RECEIVE_REQUESTS.lock().unwrap();
    let receive_requests = receive_requests
        .take()
        .expect("Channel to receive requests not set?");
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
            with_bw(|bw| bw.run_game_loop());
            debug!("Game loop ended");
            let results = game_results();
            send_game_msg_to_async(GameThreadMessage::Results(results));
            forge::hide_window();
        }
        // Saves registry settings etc.
        ExitCleanup => {
            with_bw(|bw| bw.clean_up_for_exit());
        }
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
    let game = with_bw(|bw| bw.game());
    GameThreadResults {
        victory_state: (*game).victory_state,
        player_has_left: {
            let mut arr = [false; 8];
            for i in 0..8 {
                arr[i] = (*game).player_has_left[i] != 0;
            }
            arr
        },
        player_lose_type: match (*game).player_lose_type {
            1 => Some(PlayerLoseType::UnknownChecksumMismatch),
            2 => Some(PlayerLoseType::UnknownDisconnect),
            _ => None,
        },
        // Assuming fastest speed
        time_ms: (*game).frame_count.saturating_mul(42),
    }
}

// Does the rest of initialization that is being done in main thread before running forge's
// window proc.
unsafe fn init_bw() {
    with_bw(|bw| {
        bw.init_sprites();
        (*bw.game()).is_bw = 1;
    });
    debug!("Process initialized");
}

/// Bw impl is expected to hook the point after init_game_data and call this.
pub unsafe fn after_init_game_data() {
    // Let async thread know about player randomization.
    // The function that bw_1161/bw_scr refer to as init_game_data mainly initializes global
    // data structures used in a game. Player randomization seems to have been done before that,
    // so if it ever in future ends up being the case that the async thread has a point where it
    // uses wrong game player ids, a more exact point for this hook should be decided.
    //
    // But for now it should be fine, and this should also be late enough in initialization that
    // any possible alternate branches for save/replay/ums randomization should have been executed
    // as well.
    with_bw(|bw| {
        let mut mapping = [None; bw::MAX_STORM_PLAYERS];
        let players = bw.players();
        for i in 0..8 {
            let storm_id = (*players.add(i)).storm_id;
            if let Some(out) = mapping.get_mut(storm_id as usize) {
                *out = Some(i as u8);
            }
        }
        send_game_msg_to_async(GameThreadMessage::PlayersRandomized(mapping));
    });
}
