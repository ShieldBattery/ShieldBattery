//! Sound requests made while a tick's steps are running, held back until the tick is done and
//! then reconciled against what earlier ticks played for the same frames: which are new, which came
//! late, and which were only ever part of a prediction that did not happen.

use parking_lot::Mutex;

use crate::bw;
use crate::bw_scr::BwScr;

/// One sound the simulation asked for while a tick was running.
///
/// A re-simulated frame asks for the same sounds again unless the commands that arrived since
/// changed what happened on it, so a request is recognized across ticks by its frame, sound and
/// position.
#[derive(Copy, Clone)]
struct SoundRequest {
    frame: u32,
    sound_id: u32,
    /// Where on the map the sound plays, or `None` for one that is not positioned.
    position: Option<(i32, i32)>,
    volume: f32,
}

impl SoundRequest {
    fn is_same_sound(&self, other: &SoundRequest) -> bool {
        self.frame == other.frame
            && self.sound_id == other.sound_id
            && self.position == other.position
    }
}

/// Sound requests on either side of one tick.
///
/// Reconciling what a tick's steps asked for against what earlier ticks played for the frames it
/// re-simulated tells which requests are new (the new frame's, and any that the late commands
/// caused on a re-simulated frame) and which sounds were played for a prediction that did not
/// happen.
struct SoundLedger {
    /// Requests the steps of the tick in progress have made, in the order they made them.
    requested: Vec<SoundRequest>,
    /// Requests already played for frames that a later tick can still re-simulate.
    presented: Vec<SoundRequest>,
}

/// The sounds of the frames a later tick can still re-simulate.
static SOUND_LEDGER: Mutex<SoundLedger> = Mutex::new(SoundLedger {
    requested: Vec::new(),
    presented: Vec::new(),
});

/// What reconciling one tick's sound requests did.
#[derive(Default)]
pub(crate) struct SoundCounts {
    /// Requests for the tick's new frame, played as the frame is shown.
    pub(crate) on_time: u32,
    /// Requests for a re-simulated frame that no earlier tick played, played now instead.
    pub(crate) late: u32,
    /// Frames the late requests were played behind the frame they were made on, summed.
    pub(crate) late_frames: u32,
    /// Sounds an earlier tick played for a re-simulated frame that no longer asks for them.
    #[cfg(debug_assertions)]
    pub(crate) stale: u32,
}

/// Records a sound request the simulation makes while a tick's steps run, returning what the
/// `play_sound` hook should answer in place of playing it, or `None` outside a tick to let the
/// request through. Called from the `play_sound` hook with its arguments.
///
/// A request tied to a unit is recorded at the unit's position: the sound is played only after the
/// tick, by which point the unit may no longer exist.
pub(crate) fn intercept_play_sound(
    sound_id: u32,
    volume: f32,
    unit: *mut libc::c_void,
    x: *mut i32,
    y: *mut i32,
) -> Option<u32> {
    if !super::tick_running() {
        return None;
    }
    unsafe {
        let position = if !x.is_null() {
            Some((*x, if y.is_null() { 0 } else { *y }))
        } else {
            bw_dat::Unit::from_ptr(unit as *mut bw::Unit).map(|unit| {
                let position = unit.position();
                (position.x as i32, position.y as i32)
            })
        };
        SOUND_LEDGER.lock().requested.push(SoundRequest {
            frame: super::step_frame(),
            sound_id,
            position,
            volume,
        });
    }
    // The original reports whether a channel took the sound; nothing in the simulation reads it.
    Some(1)
}

/// Plays the sounds the tick's steps asked for that no earlier tick played, and counts the ones an
/// earlier tick played that the re-simulation no longer asks for.
///
/// `window_start` is the first frame the tick's steps produced, `settled_through` the newest frame
/// no later tick simulates again, and `present_frame` the newest frame the tick reached, the one
/// about to be shown.
pub(crate) unsafe fn reconcile_sounds(
    bw: &BwScr,
    window_start: u32,
    settled_through: u32,
    present_frame: u32,
) -> SoundCounts {
    unsafe {
        let mut ledger = SOUND_LEDGER.lock();
        let requested = std::mem::take(&mut ledger.requested);
        // Sounds of frames before the tick's first step were not simulated again, so they stand.
        let (mut presented, kept): (Vec<SoundRequest>, Vec<SoundRequest>) =
            std::mem::take(&mut ledger.presented)
                .into_iter()
                .partition(|x| x.frame >= window_start);
        let mut new_requests = Vec::new();
        for request in &requested {
            match presented.iter().position(|x| x.is_same_sound(request)) {
                Some(index) => {
                    presented.swap_remove(index);
                }
                None => new_requests.push(*request),
            }
        }
        // Every frame these were played for was simulated again by this tick, so what is left over
        // was only ever part of a prediction.
        let mut counts = SoundCounts {
            #[cfg(debug_assertions)]
            stale: presented.len() as u32,
            ..SoundCounts::default()
        };
        ledger.presented = kept
            .into_iter()
            .chain(requested)
            .filter(|x| x.frame > settled_through)
            .collect();
        drop(ledger);

        for request in new_requests {
            let lateness = present_frame.saturating_sub(request.frame);
            match lateness {
                0 => counts.on_time += 1,
                _ => {
                    counts.late += 1;
                    counts.late_frames += lateness;
                }
            }
            bw.rollback_play_sound(request.sound_id, request.volume, request.position);
        }
        counts
    }
}

/// Forgets which sounds have already been played for frames a snapshot no longer holds, so a
/// fresh run of ticks does not treat anything as already presented.
#[cfg(debug_assertions)]
pub(crate) fn forget_presented() {
    SOUND_LEDGER.lock().presented.clear();
}

/// Forgets which sounds the tick in progress requested, for a tick that ends without a fingerprint
/// to reconcile them against.
#[cfg(debug_assertions)]
pub(crate) fn forget_requested() {
    SOUND_LEDGER.lock().requested.clear();
}

/// Clears the ledger for a new game.
pub(super) fn reset() {
    let mut ledger = SOUND_LEDGER.lock();
    ledger.requested.clear();
    ledger.presented.clear();
}
