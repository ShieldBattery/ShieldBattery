//! Which units died between two samples, and where.
//!
//! The game counts deaths per player and kind but keeps no record of where or when one happened.
//! Comparing two samples' rosters of every living unit gives both: a unit in the earlier roster and
//! not in the later one died in between, last seen where the earlier roster had it, which is at most
//! a second out of date. A unit that morphs keeps its unique id, so it never reads as a death.
//!
//! A few units leave the game without dying, used up in making another: the second of two templar
//! merging into an archon, and the drone that becomes an extractor. The game takes each away in
//! the same frame as the other unit takes its new form, so both show in the same two rosters, and
//! the one is matched off against the other where it was last seen close enough to have been the
//! one used.

use bw_dat::{UnitId, unit};

use super::MAX_PLAYERS;
use super::snapshot::RosterUnit;

/// How far from what it went into a unit used up can have been last seen, in map pixels: about
/// what a drone or a templar covers in the second between two samples, from the edge of a geyser.
const USED_UP_REACH: i32 = 256;

/// One unit that died.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Death {
    /// The frame of the sample that found it gone.
    pub frame: u32,
    pub player: u8,
    /// What it was when last seen alive.
    pub unit_id: UnitId,
    /// Whether it was finished, rather than a building going up or something still in its egg. A
    /// finished building partway through a morph into the next one up is finished.
    pub completed: bool,
    pub x: i16,
    pub y: i16,
}

/// Appends to `deaths` every unit in `before` that is not in `after`, stamped with `frame`, but for
/// the units of players `out` of the game, and those used up in making another. What the game takes
/// away from a player who has left or been beaten all goes at once, and none of it died. Both
/// rosters are sorted by unique id.
pub fn record(
    before: &[RosterUnit],
    after: &[RosterUnit],
    out: [bool; MAX_PLAYERS],
    frame: u32,
    deaths: &mut Vec<Death>,
) {
    let mut gone = Vec::new();
    let mut alive = after.iter().peekable();
    for unit in before {
        while alive
            .next_if(|alive| alive.unique_id < unit.unique_id)
            .is_some()
        {}
        if alive
            .next_if(|alive| alive.unique_id == unit.unique_id)
            .is_none()
            && !out.get(unit.player as usize).copied().unwrap_or(true)
        {
            gone.push(*unit);
        }
    }
    for made in after {
        let was = before
            .binary_search_by_key(&made.unique_id, |unit| unit.unique_id)
            .ok()
            .map(|index| before[index].unit_id);
        let used_up = used_up_making(was, made.unit_id);
        if used_up.is_empty() {
            continue;
        }
        let nearest = gone
            .iter()
            .enumerate()
            .filter(|(_, unit)| unit.player == made.player && used_up.contains(&unit.unit_id))
            .map(|(index, unit)| {
                let dx = i32::from(unit.x) - i32::from(made.x);
                let dy = i32::from(unit.y) - i32::from(made.y);
                (dx * dx + dy * dy, index)
            })
            .filter(|&(distance, _)| distance <= USED_UP_REACH * USED_UP_REACH)
            .min()
            .map(|(_, index)| index);
        if let Some(index) = nearest {
            gone.swap_remove(index);
        }
    }
    gone.sort_unstable_by_key(|unit| unit.unique_id);
    deaths.extend(gone.into_iter().map(|unit| Death {
        frame,
        player: unit.player,
        unit_id: unit.unit_id,
        completed: unit.completed,
        x: unit.x,
        y: unit.y,
    }));
}

/// The kinds the unit the game uses up, without its dying, can have been last seen as, in a unit
/// that was `was` (`None` for one new to the roster) becoming `now`: an archon is two templar, one
/// of whom carries on as the archon, and an extractor takes over a geyser that belonged to nobody,
/// with a drone, or with the egg that drone hatched from since the last sample.
fn used_up_making(was: Option<UnitId>, now: UnitId) -> &'static [UnitId] {
    match (was, now) {
        (Some(unit::HIGH_TEMPLAR), unit::ARCHON) => &[unit::HIGH_TEMPLAR],
        (Some(unit::DARK_TEMPLAR), unit::DARK_ARCHON) => &[unit::DARK_TEMPLAR],
        (None, unit::EXTRACTOR) => &[unit::DRONE, unit::EGG],
        _ => &[],
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

    fn at(unit: RosterUnit, x: i16) -> RosterUnit {
        RosterUnit { x, ..unit }
    }

    #[test]
    fn templar_merging_into_archons_did_not_die() {
        // Eight templar merge into four archons, and a ninth is killed across the map.
        let before = (0..9)
            .map(|id| at(alive(id, unit::HIGH_TEMPLAR), 100 * id as i16))
            .collect::<Vec<_>>();
        let after = (0..4)
            .map(|pair| at(alive(pair * 2, unit::ARCHON), 100 * (pair * 2) as i16))
            .collect::<Vec<_>>();
        let mut deaths = Vec::new();
        record(&before, &after, [false; MAX_PLAYERS], 48, &mut deaths);
        assert_eq!(deaths.len(), 1);
        assert_eq!(deaths[0].unit_id, unit::HIGH_TEMPLAR);
        assert_eq!(deaths[0].x, 800);
    }

    #[test]
    fn a_drone_that_became_an_extractor_did_not_die() {
        let before = [alive(3, unit::DRONE), alive(5, unit::DRONE)];
        // The extractor is the geyser, which nobody owned and so was in no roster.
        let after = [alive(5, unit::DRONE), at(alive(40, unit::EXTRACTOR), 4)];
        let mut deaths = Vec::new();
        record(&before, &after, [false; MAX_PLAYERS], 48, &mut deaths);
        assert!(deaths.is_empty());
    }

    #[test]
    fn an_extractor_started_by_a_new_drone_leaves_a_death_elsewhere_alone() {
        // The extractor's drone hatched since the last sample, out of an egg by the hatchery, while
        // a drone across the map was killed.
        let before = [at(alive(3, unit::DRONE), 3000), at(alive(5, unit::EGG), 60)];
        let after = [at(alive(40, unit::EXTRACTOR), 0)];
        let mut deaths = Vec::new();
        record(&before, &after, [false; MAX_PLAYERS], 48, &mut deaths);
        assert_eq!(deaths.len(), 1);
        assert_eq!(deaths[0].unit_id, unit::DRONE);
        assert_eq!(deaths[0].x, 3000);
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
