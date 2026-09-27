//! The once-only things the simulation announces as it runs, other than sounds: text lines, and
//! notifications to the observer UI. Each goes out when the frame that makes it is first
//! simulated, and a later simulation of the same frames makes it again only if the late inputs
//! changed what happened.
//!
//! An announcement is recognised across simulations by its kind and a key the hook derives from
//! its arguments, not by the exact frame: late inputs can move an event a frame or two, and the
//! observer UI in particular must not be told about the same unit twice. What an earlier tick
//! announced for the frames the current tick re-simulates is matched against what the current
//! tick's steps announce, one for one; an announcement that finds an unmatched earlier one is
//! held back as a repeat, and one that does not goes out as new.

use std::hash::{Hash, Hasher};

use parking_lot::Mutex;

/// What kind of announcement a hook is making; part of what identifies it across simulations.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Kind {
    /// A line of text attributed to a player (`print_text`).
    PlayerText,
    /// A line of text with no player (`show_game_message`): a player leaving or being eliminated,
    /// the game pausing.
    GameMessage,
    ObserverTrackBuilding,
    ObserverTrackResearch,
    ObserverRemoveBuilding,
    ObserverFinishResearch,
}

struct Announcement {
    /// The frame whose simulation made it, most recently.
    frame: u32,
    kind: Kind,
    key: u64,
    /// Whether a step of the tick in progress has made it.
    seen: bool,
}

/// The announcements of the frames a later tick can still simulate again.
static LEDGER: Mutex<Vec<Announcement>> = Mutex::new(Vec::new());

/// Hashes the arguments that identify an announcement of one kind into its key.
pub(crate) fn key(parts: impl Hash) -> u64 {
    let mut hasher = fxhash::FxHasher64::default();
    parts.hash(&mut hasher);
    hasher.finish()
}

/// Whether the hook making this announcement should let it through. Always true outside a tick;
/// during one, false when an earlier simulation of the frames being re-simulated already made the
/// same announcement.
pub(crate) fn should_announce(kind: Kind, key: u64) -> bool {
    if !super::tick_running() {
        return true;
    }
    let frame = super::step_frame();
    let window = super::window_start();
    let mut ledger = LEDGER.lock();
    let earlier = ledger
        .iter_mut()
        .find(|x| !x.seen && x.frame >= window && x.kind == kind && x.key == key);
    match earlier {
        Some(earlier) => {
            earlier.seen = true;
            earlier.frame = frame;
            false
        }
        None => {
            ledger.push(Announcement {
                frame,
                kind,
                key,
                seen: true,
            });
            true
        }
    }
}

/// Ends a tick: forgets the announcements of frames up to `settled_through`, which nothing will
/// simulate again, and the ones the tick's re-simulation no longer made, which only ever belonged
/// to a prediction. Returns how many of the latter there were.
pub(super) fn finish_tick(window_start: u32, settled_through: u32) -> u32 {
    let mut ledger = LEDGER.lock();
    let mut stale = 0;
    ledger.retain_mut(|x| {
        let retracted = !x.seen && x.frame >= window_start;
        stale += retracted as u32;
        x.seen = false;
        !retracted && x.frame > settled_through
    });
    stale
}

/// Forgets every announcement, for a timeline that starts over.
pub(crate) fn forget() {
    LEDGER.lock().clear();
}

pub(super) fn reset() {
    forget();
}
