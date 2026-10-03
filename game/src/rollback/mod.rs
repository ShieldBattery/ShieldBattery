//! A rollback engine for BW's simulation: takes memcpy snapshots of a fixed list of memory ranges
//! ([`ranges`], [`snapshot`]), and when the simulation turns out to have run without inputs it
//! should have had, restores the newest snapshot from before them and re-simulates forward
//! ([`tick`]).
//!
//! The simulation allocates nothing during play: the object pools are vectors whose storage is
//! sized once at map init and never moves, and the rest of the synced state lives in static
//! globals or in heap blocks whose owning pointer never changes after init. A snapshot is
//! therefore a fixed list of `(address, length)` ranges, captured once per game and copied in
//! place with no pointer rewriting.
//!
//! Whoever drives the engine runs each game loop tick through [`tick::run_tick`], which re-simulates
//! as far back as the driver asks and then steps on to the present. Frames are shown and heard as
//! they are first simulated, and a frame can be simulated again by later ticks until it is
//! confirmed: everything the simulation does that must happen once per frame (sounds, text lines,
//! notifications to the observer UI) is matched against what earlier simulations of the same frames
//! already did, so a re-simulation repeats none of it and only adds what the late inputs changed
//! ([`announcements`], [`sounds`], [`observer_ui`]).
//!
//! Only a game whose session rolls back runs through the engine; everything else steps BW's
//! simulation directly.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use crate::bw_scr::BwScr;

pub(crate) mod announcements;
pub(crate) mod game_end;
pub(crate) mod hash_reports;
pub(crate) mod observer_ui;
pub(crate) mod pacing;
pub(crate) mod ranges;
pub(crate) mod snapshot;
pub(crate) mod sounds;
pub(crate) mod state_hash;
pub(crate) mod tick;
pub(crate) mod ui_writes;

/// Whether a tick's steps are running right now. A step taken outside a tick applies every
/// once-only effect immediately, since nothing will simulate its frame again.
static TICK_RUNNING: AtomicBool = AtomicBool::new(false);

/// Whether the step in progress simulates a confirmed frame, one no later tick simulates again.
static FINAL_STEP: AtomicBool = AtomicBool::new(false);

/// Whether the step in progress simulates a frame the game has already been shown: one before the
/// frame the tick started on, which the tick rolled back past.
static RESIMULATING: AtomicBool = AtomicBool::new(false);

/// Whether the step in progress did something a re-simulation must not do again, set by
/// [`mark_irreversible_step`].
pub(super) static IRREVERSIBLE_STEP: AtomicBool = AtomicBool::new(false);

/// The frame count the step in progress brings the simulation to: the frame it produces.
static STEP_FRAME: AtomicU32 = AtomicU32::new(0);

/// The first frame the tick in progress produces. Earlier ticks may already have produced it and
/// the frames after it, and whatever they did on those frames is what this tick's steps are
/// matched against.
static WINDOW_START: AtomicU32 = AtomicU32::new(0);

/// Whether the engine counts its timeline in network turns rather than simulation frames. A live
/// game takes a turn every step, but a paused one takes turns without advancing a frame, and a
/// rollback that simulates past the pause again has to take every one of those turns again. The
/// turn counter is in the snapshot, so a restore rewinds it with the simulation. Replays have no
/// turns and count frames.
static COUNTS_TURNS: AtomicBool = AtomicBool::new(false);

/// Makes the engine count its timeline in network turns (`true`) or simulation frames (`false`).
/// Everything the engine calls a frame is then a position on that timeline.
pub(crate) fn count_turns(turns: bool) {
    COUNTS_TURNS.store(turns, Ordering::Relaxed);
}

/// Where the simulation is on the engine's timeline: the frame count, or when the engine counts
/// turns, how many turns have been dispatched. `None` when no game is loaded.
pub(crate) unsafe fn position(bw: &BwScr) -> Option<u32> {
    unsafe {
        match COUNTS_TURNS.load(Ordering::Relaxed) {
            true => bw.rollback_turns_dispatched(),
            false => bw.rollback_frame_count(),
        }
    }
}

/// Whether a tick's steps are running right now.
pub(crate) fn tick_running() -> bool {
    TICK_RUNNING.load(Ordering::Relaxed)
}

/// Whether the step in progress simulates a confirmed frame, one no later tick simulates again.
#[cfg(debug_assertions)]
pub(crate) fn in_final_step() -> bool {
    FINAL_STEP.load(Ordering::Relaxed)
}

/// Whether the step in progress simulates a frame the game has already been shown, rather than
/// stepping it forward for the first time. Everything the step does on behalf of the game's
/// progress rather than its simulation (sending the local turn, taking peers' turns off the
/// network) already happened when the frame was first simulated, and must not happen again.
pub(crate) fn in_resimulation() -> bool {
    RESIMULATING.load(Ordering::Relaxed)
}

/// Notes that the step in progress changed state outside the snapshot in a way that doing it again
/// would break, such as applying a player's leave: the engine snapshots the frame the step produces
/// and drops every older snapshot, so no rollback reaches back past it.
pub(crate) fn mark_irreversible_step() {
    if tick_running() {
        IRREVERSIBLE_STEP.store(true, Ordering::Relaxed);
    }
}

/// The frame the step in progress produces. Only meaningful while [`tick_running`].
pub(crate) fn step_frame() -> u32 {
    STEP_FRAME.load(Ordering::Relaxed)
}

/// The first frame the tick in progress produces. Only meaningful while [`tick_running`].
fn window_start() -> u32 {
    WINDOW_START.load(Ordering::Relaxed)
}

/// Clears engine state that does not survive to the next game: the sound and announcement
/// ledgers, the observer UI's in-progress research keys, and the game end and hash report records.
/// Called by the driver when the game
/// loop (re-)enters game init.
pub(crate) fn reset_for_game_init() {
    sounds::reset();
    announcements::reset();
    observer_ui::reset();
    ui_writes::reset();
    game_end::reset();
    hash_reports::reset();
}
