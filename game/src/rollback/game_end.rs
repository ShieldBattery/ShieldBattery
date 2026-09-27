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
//!
//! The result report that opening the dialog sends reads who won and lost, the alliances and who
//! was dropped. By then the simulation has run on past the frame, on predictions, so the report
//! takes those from the newest confirmed frame instead ([`confirmed_outcome`]).

use std::collections::BTreeMap;
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

/// The parts of the game state a result report reads.
#[derive(Clone, Copy)]
pub(crate) struct Outcome {
    pub(crate) victory_state: [u8; 8],
    pub(crate) alliances: [[u8; 12]; 12],
    pub(crate) player_was_dropped: [u8; 8],
}

/// The outcome each frame's latest simulation left, from the newest confirmed frame on.
static OUTCOMES: Mutex<BTreeMap<u32, Outcome>> = Mutex::new(BTreeMap::new());

/// The outcome of the newest frame that is confirmed, once one has been recorded.
static CONFIRMED_OUTCOME: Mutex<Option<Outcome>> = Mutex::new(None);

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

/// Records the outcome the step that produced `frame` left, replacing what an earlier simulation
/// of the frame left.
pub(crate) fn record_outcome(frame: u32, outcome: Outcome) {
    OUTCOMES.lock().insert(frame, outcome);
}

/// Makes the outcome of the newest recorded frame up to `confirmed` the one result reports read,
/// and forgets the outcomes of frames before it.
pub(crate) fn confirm_outcomes_through(confirmed: u32) {
    let mut outcomes = OUTCOMES.lock();
    let Some((&frame, &outcome)) = outcomes.range(..=confirmed).next_back() else {
        return;
    };
    *CONFIRMED_OUTCOME.lock() = Some(outcome);
    *outcomes = outcomes.split_off(&frame);
}

/// The outcome of the newest confirmed frame, for a result report in a game that rolls back, or
/// `None` when no frame has been confirmed in a rollback tick.
pub(crate) fn confirmed_outcome() -> Option<Outcome> {
    *CONFIRMED_OUTCOME.lock()
}

pub(super) fn reset() {
    PENDING.lock().clear();
    OPENED.store(false, Ordering::Relaxed);
    OUTCOMES.lock().clear();
    *CONFIRMED_OUTCOME.lock() = None;
}
