//! State hash reports, which stand in for native sync in a game that rolls back. Every
//! [`REPORT_INTERVAL`]th position on the timeline is hashed as it is simulated, and a position's
//! hash goes out once the position is confirmed, so it hashes the state every client reaches rather
//! than a prediction. A position simulated again replaces its hash: only the simulation that ran on
//! every slot's real turns reports. What a confirmed position recorded besides its hash (the hash's
//! components, the sync probe, its units) goes on to the [`desync_evidence`].
//!
//! The relay compares every slot's report for a position and names a slot that disagrees with the
//! rest, or keeps playing without reporting, so every report position has to go out exactly once.

use std::collections::BTreeMap;

use parking_lot::Mutex;

use crate::rollback::desync_evidence::{self, SyncProbe};
use crate::rollback::state_hash::UnitRecord;

/// Positions that are a multiple of this, from this one on, are reported. Position `n` is the
/// state once every slot's first `n` turns have run, which is what the relay counts.
pub(crate) const REPORT_INTERVAL: u32 = 8;

/// How many emptied unit buffers are kept for reuse, so recording a report position doesn't
/// allocate once the game is under way.
const SPARE_UNIT_BUFFERS: usize = 4;

/// What the latest simulation of a report position left.
struct Recorded {
    probe: SyncProbe,
    /// Every unit the position's state hash covered, in list order.
    units: Vec<UnitRecord>,
}

struct Reports {
    /// The latest simulation of each report position, until the position is confirmed.
    recorded: BTreeMap<u32, Recorded>,
    /// The next position to report.
    next: u32,
    spare_unit_buffers: Vec<Vec<UnitRecord>>,
}

impl Reports {
    fn recycle(&mut self, mut units: Vec<UnitRecord>) {
        if self.spare_unit_buffers.len() < SPARE_UNIT_BUFFERS {
            units.clear();
            self.spare_unit_buffers.push(units);
        }
    }
}

static REPORTS: Mutex<Reports> = Mutex::new(Reports {
    recorded: BTreeMap::new(),
    next: REPORT_INTERVAL,
    spare_unit_buffers: Vec::new(),
});

/// Whether the step that produces `position` has to record a hash.
pub(crate) fn is_report_position(position: u32) -> bool {
    position >= REPORT_INTERVAL && position.is_multiple_of(REPORT_INTERVAL)
}

/// An empty buffer for the units of a report position's state hash, to pass to [`record`].
pub(crate) fn unit_buffer() -> Vec<UnitRecord> {
    REPORTS.lock().spare_unit_buffers.pop().unwrap_or_default()
}

/// Records what the step that produced `position` left, replacing what an earlier simulation of
/// the position left.
pub(crate) fn record(position: u32, probe: SyncProbe, units: Vec<UnitRecord>) {
    let mut reports = REPORTS.lock();
    if let Some(replaced) = reports.recorded.insert(position, Recorded { probe, units }) {
        reports.recycle(replaced.units);
    }
}

/// Takes the reports of every position up to `confirmed` not yet taken, oldest first, and hands
/// them to the desync evidence. A report position that was confirmed without being recorded is
/// logged and skipped; the relay names this client for it if the client keeps playing.
pub(crate) fn take_confirmed(confirmed: u32) -> Vec<(u32, u64)> {
    let mut reports = REPORTS.lock();
    let mut taken = Vec::new();
    while reports.next <= confirmed {
        let position = reports.next;
        match reports.recorded.remove(&position) {
            Some(recorded) => {
                taken.push((position, recorded.probe.hash.combined()));
                let replaced = desync_evidence::confirm(position, &recorded.probe, recorded.units);
                if let Some(replaced) = replaced {
                    reports.recycle(replaced);
                }
            }
            None => error!("No state hash was recorded for confirmed position {position}"),
        }
        reports.next += REPORT_INTERVAL;
    }
    let next = reports.next;
    // Only split when something is stale: a split allocates, and most ticks confirm nothing new.
    if reports
        .recorded
        .first_key_value()
        .is_some_and(|(&position, _)| position < next)
    {
        let kept = reports.recorded.split_off(&next);
        let stale = std::mem::replace(&mut reports.recorded, kept);
        for (_, recorded) in stale {
            reports.recycle(recorded.units);
        }
    }
    taken
}

pub(super) fn reset() {
    let mut reports = REPORTS.lock();
    reports.recorded.clear();
    reports.next = REPORT_INTERVAL;
    desync_evidence::reset();
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::rollback::state_hash::StateHash;

    fn probe(frame: u32, units: u64) -> SyncProbe {
        SyncProbe {
            rng: [0; 6],
            minerals: [0; 4],
            gas: [0; 4],
            trigger_timer: 0,
            hash: StateHash {
                frame,
                units,
                ..StateHash::default()
            },
        }
    }

    fn combined(frame: u32, units: u64) -> u64 {
        probe(frame, units).hash.combined()
    }

    #[test]
    fn reports_go_out_once_confirmed_and_keep_the_latest_simulation() {
        reset();
        assert!(!is_report_position(0));
        assert!(!is_report_position(7));
        assert!(is_report_position(8));
        record(8, probe(8, 1), unit_buffer());
        record(16, probe(16, 2), unit_buffer());
        assert_eq!(take_confirmed(7), vec![]);
        // A rollback simulates position 16 again on the real turns.
        record(16, probe(16, 3), unit_buffer());
        assert_eq!(
            take_confirmed(16),
            vec![(8, combined(8, 1)), (16, combined(16, 3))]
        );
        assert_eq!(take_confirmed(20), vec![]);
        record(24, probe(24, 4), unit_buffer());
        assert_eq!(take_confirmed(40), vec![(24, combined(24, 4))]);
        // A position recorded after it went out is dropped, never reported again.
        record(16, probe(16, 5), unit_buffer());
        record(48, probe(48, 6), unit_buffer());
        assert_eq!(take_confirmed(40), vec![]);
        assert_eq!(REPORTS.lock().recorded.len(), 1);
        assert_eq!(take_confirmed(48), vec![(48, combined(48, 6))]);
        reset();
    }
}
