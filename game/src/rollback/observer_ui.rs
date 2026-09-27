//! Keeps the SC:R observer UI's in-progress research and upgrade records in step with rollback.
//!
//! The UI dereferences the record it looks up for a finish notification without checking it was
//! found, so a notification a predicted step produced must not be let through once a later step
//! has retired the record it names; [`observer_research_finishing`] is what checks that.

use parking_lot::Mutex;

/// Where the observer UI keeps each player's research and upgrade records: the UI object holds a
/// vector of per-player records (`players`), each of which holds a vector of upgrade records keyed
/// by the unique id of the unit doing the research, with a state that is 0 while it is in
/// progress.
#[cfg(target_arch = "x86_64")]
mod observer_ui_layout {
    pub const PLAYERS: usize = 0x8;
    pub const PLAYER_COUNT: usize = 0x10;
    pub const PLAYER_SIZE: usize = 0x90;
    pub const PLAYER_UPGRADES: usize = 0x60;
    pub const PLAYER_UPGRADE_COUNT: usize = 0x68;
    pub const UNIT_PLAYER: usize = 0x68;
}
#[cfg(target_arch = "x86")]
mod observer_ui_layout {
    pub const PLAYERS: usize = 0x4;
    pub const PLAYER_COUNT: usize = 0x8;
    pub const PLAYER_SIZE: usize = 0x68;
    pub const PLAYER_UPGRADES: usize = 0x50;
    pub const PLAYER_UPGRADE_COUNT: usize = 0x54;
    pub const UNIT_PLAYER: usize = 0x4c;
}
/// Bytes of one upgrade record, and where its in-progress state lives in it (after the `u32` key).
const OBSERVER_UPGRADE_SIZE: usize = 0x14;
const OBSERVER_UPGRADE_STATE: usize = 0xc;

/// The `(key, state)` of every upgrade record the observer UI keeps for `unit`'s owner.
unsafe fn observer_upgrade_records(ui: usize, unit: usize) -> Vec<(u32, i32)> {
    use observer_ui_layout::*;
    unsafe {
        let player = ((unit + UNIT_PLAYER) as *const u8).read() as u32;
        let players = ((ui + PLAYERS) as *const usize).read();
        let count = ((ui + PLAYER_COUNT) as *const usize).read();
        let mut out = Vec::new();
        for i in 0..count {
            let record = players + i * PLAYER_SIZE;
            if (record as *const u32).read() != player {
                continue;
            }
            let upgrades = ((record + PLAYER_UPGRADES) as *const usize).read();
            let upgrade_count = ((record + PLAYER_UPGRADE_COUNT) as *const usize).read();
            for j in 0..upgrade_count {
                let entry = upgrades + j * OBSERVER_UPGRADE_SIZE;
                out.push((
                    (entry as *const u32).read(),
                    ((entry + OBSERVER_UPGRADE_STATE) as *const i32).read(),
                ));
            }
        }
        out
    }
}

/// The key of the in-progress observer UI record for each unit it was told started research or an
/// upgrade, as the UI stored it.
static OBSERVER_RESEARCH_KEYS: Mutex<Vec<(usize, u32)>> = Mutex::new(Vec::new());

/// Notes the key the observer UI has just stored for `unit`'s research or upgrade, the newest of
/// its owner's records. Called from the observer UI hook after a start notification has gone
/// through.
pub(crate) unsafe fn observer_research_started(ui: usize, unit: usize) {
    unsafe {
        let Some(&(key, _)) = observer_upgrade_records(ui, unit).last() else {
            return;
        };
        let mut keys = OBSERVER_RESEARCH_KEYS.lock();
        keys.retain(|&(x, _)| x != unit);
        keys.push((unit, key));
    }
}

/// Whether the observer UI can be told `unit`'s research or upgrade finished, which it only takes
/// while it still holds the in-progress record: it dereferences the record it looks up without
/// checking it was found. It retires a record on its own once the frames it shows have the unit
/// gone, and those frames run ahead of the confirmed ones the notifications come from. Called from
/// the observer UI hook for a finish notification it lets through.
pub(crate) unsafe fn observer_research_finishing(ui: usize, unit: usize) -> bool {
    unsafe {
        let key = {
            let mut keys = OBSERVER_RESEARCH_KEYS.lock();
            keys.iter()
                .position(|&(x, _)| x == unit)
                .map(|index| keys.swap_remove(index).1)
        };
        let open = key.is_some_and(|key| {
            observer_upgrade_records(ui, unit)
                .iter()
                .any(|&(id, state)| id == key && state == 0)
        });
        if !open {
            let frame = crate::bw::get_bw().probe_frame_count().unwrap_or(0);
            debug!(
                "Observer UI no longer holds unit {unit:x}'s research record on frame {frame}; \
                 not telling it the research finished"
            );
        }
        open
    }
}

/// Clears the in-progress research keys for a new game.
pub(super) fn reset() {
    OBSERVER_RESEARCH_KEYS.lock().clear();
}
