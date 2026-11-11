use std::sync::Mutex;
use std::time::{Duration, Instant};

use winapi::um::errhandlingapi::GetLastError;
use winapi::um::winuser::{PostMessageW, WM_CLOSE};

static LEAVE_CONFIRMATION: Mutex<Option<Instant>> = Mutex::new(None);

/// Requests SC:R's normal in-game close path without touching BW state from the async runtime.
///
/// The game thread is busy inside the native game loop while a game is running, so this uses its
/// window message queue rather than a [`crate::game_thread::GameThreadRequest`]. The native window
/// procedure clears the normal game-loop exit flag; the IN hook then releases a stalled netcode-v2
/// step, if needed, and the ordinary loop-return path saves results and any tracked upload replay.
pub fn request_leave_game() {
    if !crate::bw::get_bw().has_game_started() {
        warn!("Leave requested before game started; ignoring");
        return;
    }
    let Some(window) = crate::forge::game_window_handle() else {
        warn!("Leave requested without a game window; ignoring");
        return;
    };

    *LEAVE_CONFIRMATION.lock().unwrap() = Some(Instant::now());
    if unsafe { PostMessageW(window, WM_CLOSE, 0, 0) } == 0 {
        *LEAVE_CONFIRMATION.lock().unwrap() = None;
        warn!("Failed to post native leave request: {}", unsafe {
            GetLastError()
        });
    } else {
        info!("Posted native leave request");
    }
}

/// Confirms a Quit dialog opened by a recent leave request after native initialization.
/// Runs on the game thread. Button -2 invokes the normal menu selection callback, including
/// game-loop teardown.
pub fn confirm_leave_dialog(dialog: bw_dat::dialog::Dialog) {
    let requested = LEAVE_CONFIRMATION.lock().unwrap().take();
    if !requested.is_some_and(|time| time.elapsed() < Duration::from_secs(5)) {
        return;
    }
    if let Some(button) = dialog.child_by_id(-2) {
        info!("Confirming native Quit dialog");
        button.send_ext_event(2);
    } else {
        warn!("Quit dialog has no affirmative button");
    }
}
