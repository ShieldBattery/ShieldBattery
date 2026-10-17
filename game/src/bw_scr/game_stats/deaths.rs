//! Which units died between two samples, and where.
//!
//! The game counts deaths per player and kind but keeps no record of where or when one happened.
//! Comparing two samples' rosters of every living unit gives both: a unit in the earlier roster and
//! not in the later one died in between, last seen where the earlier roster had it, which is at most
//! a second out of date. A unit that morphs keeps its unique id, so it never reads as a death.

use bw_dat::UnitId;

use super::MAX_PLAYERS;
use super::snapshot::RosterUnit;

/// One unit that died.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Death {
    /// The frame of the sample that found it gone.
    pub frame: u32,
    pub player: u8,
    /// What it was when last seen alive.
    pub unit_id: UnitId,
    /// Whether it was finished, rather than a building going up or something still in its egg.
    pub completed: bool,
    pub x: i16,
    pub y: i16,
}

/// Appends to `deaths` every unit in `before` that is not in `after`, stamped with `frame`, but for
/// the units of players `out` of the game: what the game takes away from a player who has left or
/// been beaten all goes at once, and none of it died. Both rosters are sorted by unique id.
pub fn record(
    before: &[RosterUnit],
    after: &[RosterUnit],
    out: [bool; MAX_PLAYERS],
    frame: u32,
    deaths: &mut Vec<Death>,
) {
    let mut after = after.iter().peekable();
    for unit in before {
        while after
            .next_if(|alive| alive.unique_id < unit.unique_id)
            .is_some()
        {}
        let gone = after
            .next_if(|alive| alive.unique_id == unit.unique_id)
            .is_none();
        if gone && !out.get(unit.player as usize).copied().unwrap_or(true) {
            deaths.push(Death {
                frame,
                player: unit.player,
                unit_id: unit.unit_id,
                completed: unit.completed,
                x: unit.x,
                y: unit.y,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use bw_dat::unit;

    use super::*;

    fn alive(unique_id: u32, unit_id: UnitId) -> RosterUnit {
        RosterUnit {
            unique_id,
            player: 0,
            unit_id,
            completed: true,
            x: unique_id as i16,
            y: 0,
        }
    }

    #[test]
    fn a_unit_gone_from_the_roster_died_where_it_was_last_seen() {
        let before = [
            alive(3, unit::MARINE),
            alive(7, unit::HYDRALISK),
            alive(9, unit::SCV),
        ];
        // The hydralisk is a lurker egg now, and the marine is gone.
        let after = [alive(7, unit::LURKER_EGG), alive(9, unit::SCV)];
        let mut deaths = Vec::new();
        record(&before, &after, [false; MAX_PLAYERS], 48, &mut deaths);
        assert_eq!(
            deaths,
            [Death {
                frame: 48,
                player: 0,
                unit_id: unit::MARINE,
                completed: true,
                x: 3,
                y: 0,
            }]
        );
    }

    #[test]
    fn units_born_since_are_no_deaths() {
        let before = [alive(5, unit::MARINE)];
        let after = [
            alive(2, unit::SCV),
            alive(5, unit::MARINE),
            alive(8, unit::SCV),
        ];
        let mut deaths = Vec::new();
        record(&before, &after, [false; MAX_PLAYERS], 48, &mut deaths);
        assert!(deaths.is_empty());
    }

    #[test]
    fn what_a_player_out_of_the_game_loses_never_died() {
        let before = [alive(3, unit::MARINE), alive(9, unit::SCV)];
        let mut out = [false; MAX_PLAYERS];
        out[0] = true;
        let mut deaths = Vec::new();
        record(&before, &[], out, 48, &mut deaths);
        assert!(deaths.is_empty());
    }
}
