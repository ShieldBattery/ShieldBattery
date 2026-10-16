//! Reading one moment of the game out of BW's memory, for the stats to be worked out from.
//!
//! Everything here is a copy: nothing in a [`GameSnapshot`] points back into the game, so what is
//! done with one is plain arithmetic that a test can feed made-up moments to.

use bw_dat::{Game, TechId, Unit, UnitArray, UnitId, UpgradeId, order};

use super::{MAX_PLAYERS, MapVision, TECH_COUNT, TimelineSubject, UNIT_ID_COUNT, UPGRADE_COUNT};
use crate::bw;
use crate::bw::unit::UnitIterator;

/// Which of the game's score tables hold the units a player made, and the unit trade.
pub(crate) const SCORE_UNITS_PRODUCED: u8 = 2;
pub(crate) const SCORE_UNITS_LOST: u8 = 3;
pub(crate) const SCORE_UNITS_KILLED: u8 = 4;

/// How many selection groups the game keeps per player.
const HOTKEY_GROUPS: usize = 0x12;

/// How many of those groups are the number keys.
///
/// The rest are the selection history SC:R keeps behind the same table; nothing recalls them with a
/// key, so nothing here reports on them.
const NUMBER_KEY_GROUPS: usize = 10;

/// The game as one frame left it.
pub struct GameSnapshot {
    pub frame: u32,
    pub players: [PlayerSnapshot; MAX_PLAYERS],
    /// How many finished units of each kind every player owns, indexed by unit id.
    pub completed_units: Box<[[u32; MAX_PLAYERS]]>,
    pub research: ResearchLevels,
    /// Every town hall that is finished or turning into the next one up.
    pub depots: Vec<DepotSite>,
    /// Every other finished building.
    pub buildings: Vec<BuildingSite>,
    /// Every upgrade and technology being researched, and where.
    pub research_sites: Vec<ResearchSite>,
    /// How much of the map each player can see, where the map's flags could be read.
    pub vision: Option<MapVision>,
}

/// The numbers the game keeps for one player.
#[derive(Clone, Default)]
pub struct PlayerSnapshot {
    /// Everything this player has ever gathered, which only climbs.
    pub gathered_minerals: u32,
    pub gathered_gas: u32,
    /// Supply in the units the game shows, not the halved ones it counts in.
    pub supply_used: u32,
    pub units_killed: u32,
    pub units_lost: u32,
    pub worker_kills: u32,
    pub worker_losses: u32,
    /// Finished workers with nothing to do.
    pub idle_workers: u32,
    /// Where their game began, in map pixels.
    pub start: (i16, i16),
    /// Their number-key groups, by digit.
    pub control_groups: [Option<GroupReading>; NUMBER_KEY_GROUPS],
}

/// One number-key group's living units, tallied by kind in the order the kinds first appear.
#[derive(Clone, Default)]
pub struct GroupReading {
    pub kinds: Vec<(UnitId, u32)>,
    /// The frame the group was last recalled or bound on, truncated to the width the game keeps it
    /// at, where the game's stamp table could be read.
    pub last_used: Option<u16>,
}

/// Every player's upgrade and technology state.
#[derive(Clone)]
pub struct ResearchLevels {
    pub upgrade_level: [[u8; UPGRADE_COUNT as usize]; MAX_PLAYERS],
    pub upgrade_in_progress: [[bool; UPGRADE_COUNT as usize]; MAX_PLAYERS],
    pub tech_researched: [[bool; TECH_COUNT as usize]; MAX_PLAYERS],
    pub tech_in_progress: [[bool; TECH_COUNT as usize]; MAX_PLAYERS],
}

impl ResearchLevels {
    pub fn new() -> ResearchLevels {
        ResearchLevels {
            upgrade_level: [[0; UPGRADE_COUNT as usize]; MAX_PLAYERS],
            upgrade_in_progress: [[false; UPGRADE_COUNT as usize]; MAX_PLAYERS],
            tech_researched: [[false; TECH_COUNT as usize]; MAX_PLAYERS],
            tech_in_progress: [[false; TECH_COUNT as usize]; MAX_PLAYERS],
        }
    }
}

/// A town hall standing on the map.
#[derive(Copy, Clone)]
pub struct DepotSite {
    pub player: u8,
    /// The game's own handle for this one unit, which stays the same while it lifts off, lands and
    /// morphs, and is never the handle of a unit that stood before it.
    pub unique_id: u32,
    /// What it is. A building turning into the next tier up stays the kind it was until it is done.
    pub unit_id: UnitId,
    pub x: i16,
    pub y: i16,
    pub completed: bool,
    /// Whether it is on the ground rather than lifted off.
    pub landed: bool,
}

/// A building standing on the map.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct BuildingSite {
    pub player: u8,
    pub unit_id: UnitId,
    pub x: i16,
    pub y: i16,
}

/// Research running, and the building it runs in.
#[derive(Copy, Clone)]
pub struct ResearchSite {
    pub player: u8,
    pub subject: TimelineSubject,
    pub x: i16,
    pub y: i16,
}

/// Reads the game as the frame just simulated left it.
///
/// `active_units` is the game's own list, which is walked once: a second walk per measurement would
/// cost as much again for numbers that all come from the same units.
///
/// # Safety
///
/// Must run on BW's thread with a game loaded. `hotkey_frames`, where given, must point at the
/// game's own `u16[player][group]` stamp table, which is what the binary analysis resolves it as.
pub unsafe fn read_snapshot(
    game: Game,
    active_units: UnitIterator,
    units: &UnitArray,
    hotkey_frames: Option<*const u16>,
    tile_flags: Option<&[u32]>,
) -> GameSnapshot {
    let mut players: [PlayerSnapshot; MAX_PLAYERS] = Default::default();
    let mut depots = Vec::new();
    let mut buildings = Vec::new();
    let mut research_sites = Vec::new();
    for unit in active_units {
        let player = unit.player();
        if player as usize >= MAX_PLAYERS {
            continue;
        }
        let id = unit.id();
        let position = unit.position();
        if id.is_town_hall() && (unit.is_completed() || unit.is_morphing_building()) {
            depots.push(DepotSite {
                player,
                unique_id: units.to_unique_id(unit),
                unit_id: id,
                x: position.x,
                y: position.y,
                completed: unit.is_completed(),
                landed: unit.is_landed_building(),
            });
        }
        if !unit.is_completed() {
            continue;
        }
        if id.is_worker() && is_idle(unit) {
            let idle = &mut players[player as usize].idle_workers;
            *idle = idle.saturating_add(1);
        }
        if !id.is_building() {
            continue;
        }
        if !id.is_town_hall() {
            buildings.push(BuildingSite {
                player,
                unit_id: id,
                x: position.x,
                y: position.y,
            });
        }
        let subjects = [
            unit.tech_in_progress().map(TimelineSubject::Tech),
            unit.upgrade_in_progress().map(TimelineSubject::Upgrade),
        ];
        for subject in subjects.into_iter().flatten() {
            research_sites.push(ResearchSite {
                player,
                subject,
                x: position.x,
                y: position.y,
            });
        }
    }

    let unit_count = UNIT_ID_COUNT.min(UnitId::entry_amount());
    let mut completed_units = vec![[0u32; MAX_PLAYERS]; unit_count as usize].into_boxed_slice();
    for (id, counts) in completed_units.iter_mut().enumerate() {
        let unit_id = UnitId(id as u16);
        let worker = unit_id.is_worker();
        for (player, count) in counts.iter_mut().enumerate() {
            *count = game.completed_count(player as u8, unit_id);
            if worker {
                let snapshot = &mut players[player];
                snapshot.worker_kills = snapshot
                    .worker_kills
                    .saturating_add(game.unit_kills(player as u8, unit_id));
                snapshot.worker_losses = snapshot
                    .worker_losses
                    .saturating_add(game.unit_deaths(player as u8, unit_id));
            }
        }
    }

    for (player, snapshot) in players.iter_mut().enumerate() {
        let id = player as u8;
        snapshot.gathered_minerals = bw::gathered_minerals(game, id);
        snapshot.gathered_gas = bw::gathered_gas(game, id);
        snapshot.supply_used = supply_used(game, id);
        snapshot.units_killed = game.score(SCORE_UNITS_KILLED, id);
        snapshot.units_lost = game.score(SCORE_UNITS_LOST, id);
        snapshot.start = start_position(game, id);
        for (group, reading) in snapshot.control_groups.iter_mut().enumerate() {
            *reading = read_control_group(game, units, player, group).map(|kinds| GroupReading {
                kinds,
                last_used: hotkey_frames
                    .and_then(|frames| unsafe { last_used_frame(frames, player, group) }),
            });
        }
    }

    GameSnapshot {
        frame: game.frame_count(),
        players,
        completed_units,
        research: read_research(game),
        depots,
        buildings,
        research_sites,
        vision: tile_flags.map(MapVision::read),
    }
}

/// Every player's upgrade levels and researched technologies, and which of each are underway.
fn read_research(game: Game) -> ResearchLevels {
    let mut research = ResearchLevels::new();
    for id in 0..UPGRADE_COUNT.min(UpgradeId::entry_amount()) {
        let upgrade = UpgradeId(id as u16);
        for player in 0..MAX_PLAYERS {
            research.upgrade_level[player][id as usize] = game.upgrade_level(player as u8, upgrade);
            research.upgrade_in_progress[player][id as usize] =
                game.upgrade_in_progress(player as u8, upgrade);
        }
    }
    for id in 0..TECH_COUNT.min(TechId::entry_amount()) {
        let tech = TechId(id as u16);
        for player in 0..MAX_PLAYERS {
            research.tech_researched[player][id as usize] =
                game.tech_researched(player as u8, tech);
            research.tech_in_progress[player][id as usize] =
                game.tech_in_progress(player as u8, tech);
        }
    }
    research
}

/// The living units on one of a player's number keys, in the group's order: what recalling it would
/// select.
pub fn control_group_units(game: Game, units: &UnitArray, player: u8, group: u8) -> Vec<Unit> {
    let Some(ids) = (unsafe {
        (**game)
            .selection_hotkeys
            .get(player as usize)
            .and_then(|groups| groups.get(group as usize))
            .copied()
    }) else {
        return Vec::new();
    };
    // Zero is the game's own end of the group rather than a unit it failed to find.
    let stored = ids.iter().take_while(|&&id| id != 0);
    // The game's own recall: a group stored with more than one unit leaves out what can only be
    // selected alone (an egg, a building), and what is out of sight inside something or no longer
    // the player's. Counted as stored, so a group whose other units have died still leaves out
    // its egg.
    let alone = stored.clone().count() <= 1;
    stored
        .filter_map(|&id| units.get_by_unique_id(id))
        .filter(|unit| {
            !unit.is_hidden()
                && unit.player() == player
                && (alone || unsafe { crate::bw_scr::can_be_group_selected(**unit) })
        })
        .collect()
}

/// Tallies one of a player's selection groups by kind, or `None` for a group with nothing living on
/// it.
///
/// The game stores unique unit ids rather than pointers, so an id that no longer resolves is a unit
/// that has died and is simply not counted: the count is what recalling the group would select.
fn read_control_group(
    game: Game,
    units: &UnitArray,
    player: usize,
    group: usize,
) -> Option<Vec<(UnitId, u32)>> {
    let ids = unsafe { *(**game).selection_hotkeys.get(player)?.get(group)? };
    let mut tally: Vec<(UnitId, u32)> = Vec::new();
    for id in ids {
        // Zero is the game's own end of the group rather than a unit it failed to find.
        if id == 0 {
            break;
        }
        let Some(unit) = units.get_by_unique_id(id) else {
            continue;
        };
        let unit_id = unit.id();
        match tally.iter_mut().find(|(kind, _)| *kind == unit_id) {
            Some(entry) => entry.1 += 1,
            None => tally.push((unit_id, 1)),
        }
    }
    (!tally.is_empty()).then_some(tally)
}

/// The frame a group was last written on, read out of the table the game keeps it in.
///
/// # Safety
///
/// `frames` must point at the game's own `u16[player][group]` stamp table, which is what the binary
/// analysis resolves it as.
unsafe fn last_used_frame(frames: *const u16, player: usize, group: usize) -> Option<u16> {
    if frames.is_null() || player >= MAX_PLAYERS || group >= HOTKEY_GROUPS {
        return None;
    }
    unsafe { Some(frames.add(player * HOTKEY_GROUPS + group).read_unaligned()) }
}

/// Whether a worker has nothing to do.
///
/// These are the orders a unit sits in while it waits to be told something. A worker mining, moving,
/// building or repairing is in an order of its own, so anything left here is a worker earning
/// nothing.
fn is_idle(unit: Unit) -> bool {
    matches!(
        unit.order(),
        order::NOTHING | order::STOP | order::GUARD | order::PLAYER_GUARD
    )
}

/// Supply in the units the game shows, summed over the three races' tables.
///
/// Summed rather than read off the player's own race, because a player can end up owning units of
/// another race — a mind-controlled dropship, a map that hands them out — and the supply those cost
/// is supply they are paying for.
fn supply_used(game: Game, player: u8) -> u32 {
    // Counted internally at twice what the game shows, because a zergling costs half of one, so what
    // is used rounds up.
    let total: u32 = [
        bw_dat::Race::Zerg,
        bw_dat::Race::Terran,
        bw_dat::Race::Protoss,
    ]
    .into_iter()
    .map(|race| game.supply_used(player, race))
    .sum();
    total.wrapping_add(1) / 2
}

/// Where a player's game began, in map pixels.
fn start_position(game: Game, player: u8) -> (i16, i16) {
    let position = unsafe { (**game).start_position.get(player as usize).copied() };
    match position {
        Some([x, y]) => (x as i16, y as i16),
        None => (0, 0),
    }
}
