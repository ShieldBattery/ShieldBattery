//! State hash reports, which stand in for native sync in a game that rolls back. Every
//! [`REPORT_INTERVAL`]th position on the timeline is hashed as it is simulated, and a position's
//! hash goes out once the position is confirmed, so it hashes the state every client reaches rather
//! than a prediction. A position simulated again replaces its hash: only the simulation that ran on
//! every slot's real turns reports.
//!
//! The relay compares every slot's report for a position and names a slot that disagrees with the
//! rest, or keeps playing without reporting, so every report position has to go out exactly once.

use std::collections::BTreeMap;

use parking_lot::Mutex;

/// Positions that are a multiple of this, from this one on, are reported. Position `n` is the
/// state once every slot's first `n` turns have run, which is what the relay counts.
pub(crate) const REPORT_INTERVAL: u32 = 8;

struct Reports {
    /// The hash each report position's latest simulation left, until the position is confirmed.
    hashes: BTreeMap<u32, u64>,
    /// The next position to report.
    next: u32,
}

static REPORTS: Mutex<Reports> = Mutex::new(Reports {
    hashes: BTreeMap::new(),
    next: REPORT_INTERVAL,
});

/// Whether the step that produces `position` has to record a hash.
pub(crate) fn is_report_position(position: u32) -> bool {
    position >= REPORT_INTERVAL && position.is_multiple_of(REPORT_INTERVAL)
}

/// Records the hash the step that produced `position` left, replacing what an earlier simulation of
/// the position left.
pub(crate) fn record(position: u32, hash: u64) {
    REPORTS.lock().hashes.insert(position, hash);
}

/// Takes the reports of every position up to `confirmed` not yet taken, oldest first. A report
/// position that was confirmed without being recorded is logged and skipped; the relay names this
/// client for it if the client keeps playing.
pub(crate) fn take_confirmed(confirmed: u32) -> Vec<(u32, u64)> {
    let mut reports = REPORTS.lock();
    let mut taken = Vec::new();
    while reports.next <= confirmed {
        let position = reports.next;
        match reports.hashes.remove(&position) {
            Some(hash) => taken.push((position, hash)),
            None => error!("No state hash was recorded for confirmed position {position}"),
        }
        reports.next += REPORT_INTERVAL;
    }
    let next = reports.next;
    reports.hashes.retain(|&position, _| position >= next);
    taken
}

pub(super) fn reset() {
    let mut reports = REPORTS.lock();
    reports.hashes.clear();
    reports.next = REPORT_INTERVAL;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_go_out_once_confirmed_and_keep_the_latest_simulation() {
        reset();
        assert!(!is_report_position(0));
        assert!(!is_report_position(7));
        assert!(is_report_position(8));
        record(8, 1);
        record(16, 2);
        assert_eq!(take_confirmed(7), vec![]);
        // A rollback simulates position 16 again on the real turns.
        record(16, 3);
        assert_eq!(take_confirmed(16), vec![(8, 1), (16, 3)]);
        assert_eq!(take_confirmed(20), vec![]);
        record(24, 4);
        assert_eq!(take_confirmed(40), vec![(24, 4)]);
        reset();
    }
}
