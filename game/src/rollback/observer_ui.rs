//! Keeps the SC:R observer UI's in-progress research and upgrade records in step with rollback.
//!
//! The UI dereferences the record it looks up for a finish notification without checking it was
//! found, so a notification a predicted step produced must not be let through once a later step
//! has retired the record it names; [`observer_research_finishing`] is what checks that.

use parking_lot::Mutex;

use crate::bw;

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
}
#[cfg(target_arch = "x86")]
mod observer_ui_layout {
    pub const PLAYERS: usize = 0x4;
    pub const PLAYER_COUNT: usize = 0x8;
    pub const PLAYER_SIZE: usize = 0x68;
    pub const PLAYER_UPGRADES: usize = 0x50;
    pub const PLAYER_UPGRADE_COUNT: usize = 0x54;
}
/// Bytes of one upgrade record, and where its in-progress state lives in it (after the `u32` key).
const OBSERVER_UPGRADE_SIZE: usize = 0x14;
const OBSERVER_UPGRADE_STATE: usize = 0xc;

/// The `(key, state)` of every upgrade record the observer UI keeps for `unit`'s owner.
unsafe fn observer_upgrade_records(ui: usize, unit: *mut bw::Unit) -> Vec<(u32, i32)> {
    use observer_ui_layout::*;
    unsafe {
        let player = (*unit).player as u32;
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
static OBSERVER_RESEARCH_KEYS: Mutex<Vec<ResearchKey>> = Mutex::new(Vec::new());

struct ResearchKey {
    unit: usize,
    generation: u8,
    key: u32,
}

/// Notes the key the observer UI has just stored for `unit`'s research or upgrade, the newest of
/// its owner's records. Called from the observer UI hook after a start notification has gone
/// through. Only steps a rollback tick runs, and the steps of a replay that seeks by keyframe, are
/// tracked; see [`observer_research_finishing`].
pub(crate) unsafe fn observer_research_started(ui: usize, unit: *mut bw::Unit) {
    if !super::tick_running() && !crate::replay_seek::active() {
        return;
    }
    unsafe {
        let Some(&(key, _)) = observer_upgrade_records(ui, unit).last() else {
            return;
        };
        let mut keys = OBSERVER_RESEARCH_KEYS.lock();
        keys.retain(|x| x.unit != unit as usize);
        keys.push(ResearchKey {
            unit: unit as usize,
            generation: (*unit).minor_unique_index,
            key,
        });
    }
}

/// Whether the observer UI can be told `unit`'s research or upgrade finished, which it only takes
/// while it still holds the in-progress record: it dereferences the record it looks up without
/// checking it was found. It retires a record on its own once the frames it shows have the unit
/// gone, and those frames run ahead of the confirmed ones the notifications come from. Called from
/// the observer UI hook for a finish notification it lets through.
///
/// A replay that has restored a keyframe has the same problem: the UI's records come from
/// wherever the replay was before the seek, and may hold nothing for research the restored
/// simulation is finishing.
///
/// Any other step outside a rollback tick is let through: every step of a game that rolls back
/// runs in a tick, and a game that doesn't shows the frames its notifications come from.
pub(crate) unsafe fn observer_research_finishing(ui: usize, unit: *mut bw::Unit) -> bool {
    if !super::tick_running() && !crate::replay_seek::has_restored() {
        return true;
    }
    unsafe {
        let open = take_open_research_key(&mut OBSERVER_RESEARCH_KEYS.lock(), ui, unit);
        if !open {
            let frame = crate::bw::get_bw().rollback_frame_count().unwrap_or(0);
            debug!(
                "Observer UI no longer holds unit {unit:p}'s research record on frame {frame}; \
                 not telling it the research finished"
            );
        }
        open
    }
}

/// Consumes the tracked key and checks that it belongs to the same occupant of the unit slot.
/// The native callback searches for the unit's current unique id, which includes its generation.
unsafe fn take_open_research_key(
    keys: &mut Vec<ResearchKey>,
    ui: usize,
    unit: *mut bw::Unit,
) -> bool {
    unsafe {
        let saved = keys
            .iter()
            .position(|x| x.unit == unit as usize)
            .map(|index| keys.swap_remove(index));
        saved.is_some_and(|saved| {
            saved.generation == (*unit).minor_unique_index
                && observer_upgrade_records(ui, unit)
                    .iter()
                    .any(|&(id, state)| id == saved.key && state == 0)
        })
    }
}

/// Drops keys from the simulation a replay seek replaces. Unit generations can wrap over a long
/// replay, so even a matching generation cannot identify a record across an arbitrary seek.
pub(crate) fn reset_for_replay_seek() {
    OBSERVER_RESEARCH_KEYS.lock().clear();
}

/// Clears the in-progress research keys for a new game.
pub(super) fn reset() {
    OBSERVER_RESEARCH_KEYS.lock().clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use observer_ui_layout::*;

    struct ObserverUi {
        header: [usize; 3],
        _player: Vec<usize>,
        _upgrades: Vec<[u32; OBSERVER_UPGRADE_SIZE / size_of::<u32>()]>,
    }

    impl ObserverUi {
        fn new(player_id: u8, records: &[(u32, i32)]) -> Self {
            let mut upgrades = vec![[0; OBSERVER_UPGRADE_SIZE / size_of::<u32>()]; records.len()];
            for (record, &(key, state)) in upgrades.iter_mut().zip(records) {
                record[0] = key;
                record[OBSERVER_UPGRADE_STATE / size_of::<u32>()] = state as u32;
            }
            let mut player = vec![0; PLAYER_SIZE / size_of::<usize>()];
            player[0] = player_id as usize;
            player[PLAYER_UPGRADES / size_of::<usize>()] = upgrades.as_ptr() as usize;
            player[PLAYER_UPGRADE_COUNT / size_of::<usize>()] = upgrades.len();
            let mut header = [0; 3];
            header[PLAYERS / size_of::<usize>()] = player.as_ptr() as usize;
            header[PLAYER_COUNT / size_of::<usize>()] = 1;
            Self {
                header,
                _player: player,
                _upgrades: upgrades,
            }
        }

        fn address(&self) -> usize {
            self.header.as_ptr() as usize
        }
    }

    fn key_for(unit: &mut bw::Unit, key: u32) -> ResearchKey {
        ResearchKey {
            unit: unit as *mut bw::Unit as usize,
            generation: unit.minor_unique_index,
            key,
        }
    }

    #[test]
    fn restored_slot_cannot_finish_another_generations_open_record() {
        let mut unit: bw::Unit = unsafe { std::mem::zeroed() };
        unit.minor_unique_index = 2;
        let mut keys = vec![key_for(&mut unit, 0x4001)];
        let ui = ObserverUi::new(unit.player, &[(0x4001, 0)]);

        unit.minor_unique_index = 1;
        assert!(!unsafe { take_open_research_key(&mut keys, ui.address(), &mut unit) });
        assert!(keys.is_empty());
    }

    #[test]
    fn same_generation_can_finish_its_matching_open_record_once() {
        let mut unit: bw::Unit = unsafe { std::mem::zeroed() };
        unit.minor_unique_index = 2;
        let mut keys = vec![key_for(&mut unit, 0x4001)];
        let ui = ObserverUi::new(unit.player, &[(0x2001, 0), (0x4001, 0)]);

        assert!(unsafe { take_open_research_key(&mut keys, ui.address(), &mut unit) });
        assert!(!unsafe { take_open_research_key(&mut keys, ui.address(), &mut unit) });
    }

    #[test]
    fn missing_or_retired_records_cannot_finish() {
        let mut unit: bw::Unit = unsafe { std::mem::zeroed() };
        for records in [
            vec![],
            vec![(0x2001, 0)],
            vec![(0x4001, 1)],
            vec![(0x4001, 3)],
        ] {
            let mut keys = vec![key_for(&mut unit, 0x4001)];
            let ui = ObserverUi::new(unit.player, &records);
            assert!(!unsafe { take_open_research_key(&mut keys, ui.address(), &mut unit) });
            assert!(keys.is_empty());
        }
    }
}
