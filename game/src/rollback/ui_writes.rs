//! Writes the UI makes into the simulation's memory between logic steps, in answer to the player:
//! the order confirmation marker placed on a right click, and the blink of a clicked target's
//! selection circle.
//!
//! Both live in state the snapshot holds (the marker is a sprite, the blink a sprite field), so a
//! restore to before the click undoes them, and a re-simulation never makes them again since no
//! step made them the first time. Each is logged with the frame the simulation was on when the UI
//! made it, and a tick that restores to that frame or earlier makes it again right before stepping
//! from that frame, as the player's click did. Making one again on a state that already has it
//! changes nothing, so a snapshot taken after a write is replayed over safely.

use parking_lot::Mutex;

use crate::bw_scr::BwScr;

use super::snapshot::SNAPSHOTS;

/// One write the UI made.
#[derive(Copy, Clone)]
pub(crate) enum UiWrite {
    /// `show_cursor_marker_at(x, y)`: the marker a right click on the ground places.
    CursorMarker { x: i32, y: i32 },
    /// `set_sprite_selection_flash_timer(object, timer)`: the blink of a unit (or fog sprite)
    /// that a right click targeted.
    SelectionFlash { object: usize, timer: u32 },
}

/// The writes a restore can still undo, each with the frame the simulation was on when it was made.
static LOG: Mutex<Vec<(u32, UiWrite)>> = Mutex::new(Vec::new());

/// Logs a write the UI is about to make. Called from the hooks on the functions that make them;
/// calls made by a logic step (triggers make selection circles blink too) are part of the
/// simulation, which a re-simulation repeats by itself, so only calls between steps are logged,
/// and only while the rollback engine holds snapshots that could undo them.
pub(crate) fn record(bw: &BwScr, write: UiWrite) {
    if super::tick_running() || SNAPSHOTS.lock().is_none() {
        return;
    }
    let Some(frame) = (unsafe { super::position(bw) }) else {
        return;
    };
    LOG.lock().push((frame, write));
}

/// Makes the logged writes of `frame` again. Called by a tick that restored a snapshot, right
/// before the step from `frame`.
pub(super) unsafe fn replay(bw: &BwScr, frame: u32) {
    unsafe {
        let writes = LOG
            .lock()
            .iter()
            .filter(|x| x.0 == frame)
            .map(|x| x.1)
            .collect::<Vec<_>>();
        for write in writes {
            bw.rollback_replay_ui_write(write);
        }
    }
}

/// Forgets the writes of frames before `settled_through`, which no restore can reach back past.
/// Writes of `settled_through` itself are kept, since the snapshot of that frame may have been
/// taken before them. One taken after them already holds them, and making a write again from the
/// same state changes nothing.
pub(super) fn prune(settled_through: u32) {
    LOG.lock().retain(|x| x.0 >= settled_through);
}

pub(super) fn reset() {
    LOG.lock().clear();
}
