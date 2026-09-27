//! A rollback engine for BW's simulation: takes a memcpy snapshot of a fixed list of memory
//! ranges ([`ranges`]), restores an earlier one, and re-simulates forward from it ([`snapshot`]).
//!
//! The simulation allocates nothing during play: the object pools are vectors whose storage is
//! sized once at map init and never moves, and the rest of the synced state lives in static
//! globals or in heap blocks whose owning pointer never changes after init. A snapshot is
//! therefore a fixed list of `(address, length)` ranges, captured once per game and copied in
//! place with no pointer rewriting.
//!
//! Whoever drives the engine runs each restore-and-resimulate as a batch of one or more logic
//! steps, a tick, and marks one step of the batch as confirmed: the one whose frame no later tick
//! will simulate again. Everything a step does that must happen only once for a frame (sounds,
//! text lines, notifications to the observer UI) is deferred until the confirmed step produces
//! it; [`in_predicted_step`] is how the hooks for those tell a step that must hold back from one
//! that may go ahead. [`sounds`] and [`observer_ui`] hold the deferred state for their own kind of
//! once-only effect.
//!
//! This writes into live BW memory and is compiled out of release DLLs entirely, rather than
//! merely declining to run.

use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) mod observer_ui;
pub(crate) mod ranges;
pub(crate) mod snapshot;
pub(crate) mod sounds;

/// Whether a tick's steps are running right now. A step taken outside a tick applies every
/// once-only effect immediately, since nothing will simulate its frame again.
static TICK_RUNNING: AtomicBool = AtomicBool::new(false);

/// Whether the step in progress is the tick's confirmed step.
static CONFIRMED_STEP: AtomicBool = AtomicBool::new(false);

/// Marks the start of a tick's steps. Called by the driver before the first of them runs.
pub(crate) fn begin_tick() {
    TICK_RUNNING.store(true, Ordering::Relaxed);
}

/// Marks the end of a tick's steps. Called by the driver once the last of them has run.
pub(crate) fn end_tick() {
    TICK_RUNNING.store(false, Ordering::Relaxed);
    CONFIRMED_STEP.store(false, Ordering::Relaxed);
}

/// Marks the step now running as the tick's confirmed step, the one whose frame no later tick
/// simulates again, or as one of its predicted steps. Called by the driver before each step.
pub(crate) fn set_step_confirmed(confirmed: bool) {
    CONFIRMED_STEP.store(confirmed, Ordering::Relaxed);
}

/// Whether a tick's steps are running right now.
pub(crate) fn tick_running() -> bool {
    TICK_RUNNING.load(Ordering::Relaxed)
}

/// Whether the step in progress is the tick's confirmed step.
pub(crate) fn in_confirmed_step() -> bool {
    CONFIRMED_STEP.load(Ordering::Relaxed)
}

/// Whether the step in progress produces a predicted frame, one that a later tick simulates
/// again.
///
/// What the simulation announces as it happens (text lines such as chat, notifications to the
/// observer UI) must be held back on such a step: the confirmed step that eventually produces the
/// frame for the last time announces the same things, and each of them is meant to happen once.
/// Called from the hooks on those announcements.
pub(crate) fn in_predicted_step() -> bool {
    tick_running() && !in_confirmed_step()
}

/// Clears engine state that does not survive to the next game: the sound ledger and the observer
/// UI's in-progress research keys. Called by the driver when the game loop (re-)enters game init.
pub(crate) fn reset_for_game_init() {
    sounds::reset();
    observer_ui::reset();
}
