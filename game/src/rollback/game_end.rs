//! The victory and defeat dialogs. The simulation's trigger step opens one when the local player's
//! game has been decided, and with it the game reports its result and, on a victory, ends the
//! network session. A frame simulated on predicted inputs can decide a game that the real inputs
//! don't, so inside a tick an opening is only noted against the frame whose step asked for it.
//! Every simulation of that frame replaces what earlier ones noted, and once the frame is
//! confirmed the driver opens the dialog its final simulation asked for.
//!
//! The openers change nothing the simulation reads: they latch the dialog as open, play the end
//! of game sound and open the dialog, so opening one after the step instead of during it only
//! moves when the player sees it.

use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

/// Which of the dialogs a step asked for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MissionDialog {
    Defeat,
    Victory,
}

/// Openings asked for by steps inside a tick, with the frame each step produced.
static PENDING: Mutex<Vec<(u32, MissionDialog)>> = Mutex::new(Vec::new());

/// Whether a dialog has been opened this game. The trigger step asks again every time its check
/// comes round, and the game opens only the first dialog, so later ones are dropped here.
static OPENED: AtomicBool = AtomicBool::new(false);

/// Called by the opener hooks. Notes the opening against the frame being stepped and returns
/// `true` when a tick is running, so the caller skips opening the dialog now; returns `false`
/// outside a tick, when nothing will simulate the frame again and the dialog opens as usual.
pub(crate) fn defer(dialog: MissionDialog) -> bool {
    if !super::tick_running() {
        return false;
    }
    PENDING.lock().push((super::step_frame(), dialog));
    true
}

/// Forgets the openings earlier simulations of `frame` asked for, before the step that produces
/// it runs again.
pub(crate) fn begin_step(frame: u32) {
    PENDING.lock().retain(|&(x, _)| x != frame);
}

/// Takes the first opening asked for by a frame up to `confirmed`, whose simulation is final,
/// unless a dialog has been opened already.
pub(crate) fn take_confirmed(confirmed: u32) -> Option<MissionDialog> {
    let mut pending = PENDING.lock();
    let dialog = pending
        .iter()
        .filter(|x| x.0 <= confirmed)
        .min_by_key(|x| x.0)
        .map(|x| x.1);
    pending.retain(|&(frame, _)| frame > confirmed);
    dialog.filter(|_| !OPENED.swap(true, Ordering::Relaxed))
}

pub(super) fn reset() {
    PENDING.lock().clear();
    OPENED.store(false, Ordering::Relaxed);
}
