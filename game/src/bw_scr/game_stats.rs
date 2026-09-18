//! The running record of the game the observer panels report from.
//!
//! Everything the matchup bar shows is true of the frame it is drawn on, so it is read straight off
//! BW. The stats wings are not: an income is a rate, a graph is a history, and a timeline is a list
//! of the moments something changed. None of that exists anywhere in the game's memory, so it is
//! built here, one sample per second of game time, from the counts and score tables BW does keep.
//!
//! This runs on BW's own thread, inside the step that advances the simulation, which is what makes
//! it complete. A replay seeking backwards restarts the simulation from frame zero and re-runs every
//! frame at full speed with nothing drawn; a sampler living in the draw path would come back to a
//! game whose first forty minutes it never saw. Sampling from the simulation step instead means the
//! history is rebuilt exactly as it was, so [`GameStats::clear`] on game init is all a seek costs.
//!
//! The memory is bounded and pre-decided: [`MAX_SAMPLES`] samples per player, which is two hours of
//! game time, and [`MAX_EVENTS`] timeline entries. A game that runs longer loses its oldest samples
//! rather than growing without limit.

use std::collections::VecDeque;

use bw_dat::{Game, TechId, UnitArray, UnitId, UpgradeId, order, unit};
use overlay_ui::observer::{GraphSeries, TimelineEventKind};

use crate::bw;
use crate::bw::unit::UnitIterator;

/// How many players the game keeps playable slots for, which is as many as anything here reports on.
pub const MAX_PLAYERS: usize = 8;

/// How many frames apart two samples are. Twenty-four frames is one second at the speed every
/// competitive game and almost every replay runs at, which is what makes a sample a second.
const SAMPLE_INTERVAL_FRAMES: u32 = 24;

/// How many samples one player's history holds: two hours of game time.
pub const MAX_SAMPLES: usize = 2 * 60 * 60;

/// How far back a rate is measured, in samples. A minute is long enough that one worker walking to
/// a new patch does not move the number, and short enough that a base lost is visible at once.
const INCOME_WINDOW: usize = 60;

/// How many timeline entries are kept. The panel draws six; the rest are what a taller feed or a
/// scrollback would be built from, and they cost almost nothing to keep.
const MAX_EVENTS: usize = 64;

/// How many unit, upgrade and technology entries are walked. These are the counts the game's own
/// fixed-size tables hold; a mod with more entries than this is simply not reported on past them.
const UNIT_ID_COUNT: u32 = 0xe4;
const UPGRADE_COUNT: u32 = 0x3d;
const TECH_COUNT: u32 = 0x2c;

/// Which of the game's score tables hold the unit trade.
const SCORE_UNITS_LOST: u8 = 3;
const SCORE_UNITS_KILLED: u8 = 4;

/// How far from a player's own start location a finished resource depot has to be before it counts
/// as an expansion rather than as another building in the main, in map pixels.
///
/// Generous, because the cost of calling a macro hatch an expansion is a wrong line on the timeline
/// while the cost of missing one is nothing at all: a real expansion is most of a screen away.
const EXPANSION_DISTANCE: i32 = 32 * 15;

/// How close two resource depots have to be before they are taken for the same one, in map pixels.
/// No two of them fit within this, so anything closer is the depot that was already there.
const SAME_DEPOT_DISTANCE: i32 = 64;

/// How many resource depots one player's positions are remembered for. Past this the oldest is
/// forgotten, which can only cost a duplicate timeline entry for a base rebuilt where an ancient one
/// stood.
const MAX_KNOWN_DEPOTS: usize = 32;

/// How many selection groups the game keeps per player.
const HOTKEY_GROUPS: usize = 0x12;

/// How many of those groups are the number keys.
///
/// The rest are the selection history SC:R keeps behind the same table; nothing recalls them with a
/// key, so nothing here reports on them.
const NUMBER_KEY_GROUPS: usize = 10;

/// How long a group has to go without being recalled before it is worth pointing out, in frames.
///
/// A minute of game time. Long enough that a group a player is cycling through stays lit, short
/// enough that an army parked at home while its owner macros is called out while it still matters.
const STALE_FRAMES: u16 = 60 * SAMPLE_INTERVAL_FRAMES as u16;

/// One second of one player's game.
///
/// Every field is a level rather than a rate: rates are differences between two of these, which is
/// what keeps a sample true of the moment it was taken even after the window a rate is read over
/// changes.
#[derive(Copy, Clone, Default)]
pub struct Sample {
    /// Everything this player has ever gathered, which only climbs.
    pub gathered_minerals: u32,
    pub gathered_gas: u32,
    /// What their standing army cost to build.
    pub army_minerals: u32,
    pub army_gas: u32,
    /// How many workers they own, and how many of those are standing still.
    pub workers: u32,
    pub idle_workers: u32,
    /// Supply in the units the game shows, not the halved ones it counts in.
    pub supply_used: u32,
    pub units_killed: u32,
    pub units_lost: u32,
    pub worker_kills: u32,
    pub worker_losses: u32,
}

impl Sample {
    /// What this player's army is worth in both resources together, which is the one number a
    /// graph of an army plots.
    pub fn army_value(&self) -> u32 {
        self.army_minerals.saturating_add(self.army_gas)
    }

    /// Everything gathered so far in both resources together.
    fn gathered(&self) -> u32 {
        self.gathered_minerals.saturating_add(self.gathered_gas)
    }
}

/// What a timeline entry is about, which is how the panel picks the icon it draws.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TimelineSubject {
    Unit(UnitId),
    Upgrade(UpgradeId),
    Tech(TechId),
}

/// One moment worth putting a clock on.
#[derive(Copy, Clone)]
pub struct TimelineEvent {
    /// The frame it happened on. Frames rather than seconds, because turning one into the other
    /// needs the speed the game was recorded at, which only the draw path knows.
    pub frame: u32,
    pub player: u8,
    pub kind: TimelineEventKind,
    pub subject: TimelineSubject,
}

/// One of a player's number-key selection groups, as the last sample found it.
#[derive(Copy, Clone)]
pub struct ControlGroup {
    /// The digit the group answers to.
    pub key: u8,
    /// What the group is mostly made of, which is the icon it is named by.
    pub unit_id: UnitId,
    /// How many living units are in it.
    pub count: u32,
    /// Whether it has gone long enough without being recalled to be worth pointing out.
    pub stale: bool,
}

/// One player's history.
struct PlayerStats {
    samples: VecDeque<Sample>,
    /// Where this player's finished resource depots stand, so a depot that was already there is not
    /// reported as a new one every second.
    known_depots: Vec<(i16, i16)>,
    /// What they have on their number keys, replaced whole every sample: a group is what it is
    /// right now, and nothing here is read against what it was.
    control_groups: Vec<ControlGroup>,
}

impl PlayerStats {
    fn new() -> PlayerStats {
        PlayerStats {
            samples: VecDeque::new(),
            known_depots: Vec::new(),
            control_groups: Vec::new(),
        }
    }

    fn clear(&mut self) {
        self.samples.clear();
        self.known_depots.clear();
        self.control_groups.clear();
    }

    fn push(&mut self, sample: Sample) {
        if self.samples.len() == MAX_SAMPLES {
            self.samples.pop_front();
        }
        self.samples.push_back(sample);
    }
}

/// The game as the last sample found it, which is what this one is compared against to find what
/// changed. Boxed, because the building counts alone are several kilobytes and nothing here is read
/// often enough to want them inline.
struct PreviousState {
    completed_units: Box<[[u32; MAX_PLAYERS]; UNIT_ID_COUNT as usize]>,
    upgrade_level: [[u8; UPGRADE_COUNT as usize]; MAX_PLAYERS],
    upgrade_in_progress: [[bool; UPGRADE_COUNT as usize]; MAX_PLAYERS],
    tech_researched: [[bool; TECH_COUNT as usize]; MAX_PLAYERS],
    tech_in_progress: [[bool; TECH_COUNT as usize]; MAX_PLAYERS],
}

impl PreviousState {
    fn new() -> PreviousState {
        PreviousState {
            completed_units: Box::new([[0; MAX_PLAYERS]; UNIT_ID_COUNT as usize]),
            upgrade_level: [[0; UPGRADE_COUNT as usize]; MAX_PLAYERS],
            upgrade_in_progress: [[false; UPGRADE_COUNT as usize]; MAX_PLAYERS],
            tech_researched: [[false; TECH_COUNT as usize]; MAX_PLAYERS],
            tech_in_progress: [[false; TECH_COUNT as usize]; MAX_PLAYERS],
        }
    }
}

/// The sampler. See the module docs.
pub struct GameStats {
    players: [PlayerStats; MAX_PLAYERS],
    events: VecDeque<TimelineEvent>,
    previous: PreviousState,
    /// The first frame a sample is due on.
    next_sample_frame: u32,
    /// Whether a sample has been taken this game.
    ///
    /// The first one only records where the game started; a map can begin with buildings, upgrades
    /// and bases already placed, and reporting each of them as having just happened would open every
    /// game with a timeline nobody can read.
    seeded: bool,
}

impl GameStats {
    pub fn new() -> GameStats {
        GameStats {
            players: std::array::from_fn(|_| PlayerStats::new()),
            events: VecDeque::new(),
            previous: PreviousState::new(),
            next_sample_frame: 0,
            seeded: false,
        }
    }

    /// Forgets the game, for a game that is about to start or to be simulated again from frame zero.
    pub fn clear(&mut self) {
        for player in &mut self.players {
            player.clear();
        }
        self.events.clear();
        self.previous = PreviousState::new();
        self.next_sample_frame = 0;
        self.seeded = false;
    }

    /// The most recent sample for a player, or `None` before the first one is taken.
    pub fn latest(&self, player: u8) -> Option<&Sample> {
        self.players.get(player as usize)?.samples.back()
    }

    /// What a player gathered of each resource over the last minute of game time.
    ///
    /// Measured over however much history there is when there is less than a minute of it, and
    /// scaled up to the minute it is quoted as, so an opening reads as the rate it is running at
    /// rather than as a fraction of one.
    pub fn income_per_minute(&self, player: u8) -> (u32, u32) {
        let Some(samples) = self.players.get(player as usize).map(|p| &p.samples) else {
            return (0, 0);
        };
        let Some(latest) = samples.back() else {
            return (0, 0);
        };
        let window = samples.len().min(INCOME_WINDOW + 1);
        if window < 2 {
            return (0, 0);
        }
        let earliest = &samples[samples.len() - window];
        let elapsed = (window - 1) as u32;
        let scale = |now: u32, then: u32| {
            now.saturating_sub(then)
                .saturating_mul(INCOME_WINDOW as u32)
                / elapsed
        };
        (
            scale(latest.gathered_minerals, earliest.gathered_minerals),
            scale(latest.gathered_gas, earliest.gathered_gas),
        )
    }

    /// One player's history of `series`, thinned to at most `points` evenly spaced values.
    ///
    /// Thinned rather than handed over whole, because a graph is a few hundred points wide and an
    /// hour of game time is thousands of samples: everything past one value per point is line
    /// segments shorter than a pixel.
    pub fn series(&self, player: u8, series: GraphSeries, points: usize) -> Vec<f32> {
        let Some(samples) = self.players.get(player as usize).map(|p| &p.samples) else {
            return Vec::new();
        };
        if samples.len() < 2 || points < 2 {
            return Vec::new();
        }
        let points = points.min(samples.len());
        (0..points)
            .map(|point| {
                let index = (samples.len() - 1) * point / (points - 1);
                self.value_at(samples, index, series)
            })
            .collect()
    }

    /// What one sample is worth on a plot of `series`.
    fn value_at(&self, samples: &VecDeque<Sample>, index: usize, series: GraphSeries) -> f32 {
        let sample = &samples[index];
        match series {
            GraphSeries::ArmyValue => sample.army_value() as f32,
            // A rate rather than a level, so it is the difference across the window ending here.
            GraphSeries::Income => {
                let window = (index + 1).min(INCOME_WINDOW + 1);
                if window < 2 {
                    return 0.0;
                }
                let earliest = &samples[index + 1 - window];
                let elapsed = (window - 1) as u32;
                (sample.gathered().saturating_sub(earliest.gathered()) * INCOME_WINDOW as u32
                    / elapsed) as f32
            }
            GraphSeries::Supply => sample.supply_used as f32,
            GraphSeries::Workers => sample.workers as f32,
            GraphSeries::Kills => sample.units_killed as f32,
        }
    }

    /// What has happened, newest first.
    pub fn events(&self) -> impl Iterator<Item = &TimelineEvent> {
        self.events.iter().rev()
    }

    /// What a player has on their number keys, as of the last sample.
    pub fn control_groups(&self, player: u8) -> &[ControlGroup] {
        match self.players.get(player as usize) {
            Some(player) => &player.control_groups,
            None => &[],
        }
    }

    /// Takes a sample if one is due, and records everything that changed since the last one.
    ///
    /// `active_units` is the game's own list, which is walked once: a second walk per measurement
    /// would cost as much again for numbers that all come from the same units.
    pub fn step(
        &mut self,
        game: Game,
        active_units: UnitIterator,
        units: &UnitArray,
        hotkey_frames_offset: Option<usize>,
    ) {
        let frame = game.frame_count();
        if frame < self.next_sample_frame {
            return;
        }
        // Counted from the frame actually sampled rather than from the one that was due, so a game
        // whose frame count jumped ahead resumes on the next second instead of catching up through
        // every second it skipped.
        self.next_sample_frame = frame.saturating_add(SAMPLE_INTERVAL_FRAMES);

        let mut idle_workers = [0u32; MAX_PLAYERS];
        let mut depots: Vec<(u8, UnitId, i16, i16)> = Vec::new();
        for unit in active_units {
            let player = unit.player() as usize;
            if player >= MAX_PLAYERS {
                continue;
            }
            let id = unit.id();
            if !unit.is_completed() {
                continue;
            }
            if id.is_worker() && is_idle(unit) {
                idle_workers[player] = idle_workers[player].saturating_add(1);
            }
            if id.is_town_hall() {
                let position = unit.position();
                depots.push((player as u8, id, position.x, position.y));
            }
        }

        let totals = unit_totals(game);
        for player in 0..MAX_PLAYERS {
            let totals = &totals[player];
            let sample = Sample {
                gathered_minerals: bw::gathered_minerals(game, player as u8),
                gathered_gas: bw::gathered_gas(game, player as u8),
                army_minerals: totals.army_minerals,
                army_gas: totals.army_gas,
                workers: totals.workers,
                idle_workers: idle_workers[player].min(totals.workers),
                supply_used: supply_used(game, player as u8),
                units_killed: game.score(SCORE_UNITS_KILLED, player as u8),
                units_lost: game.score(SCORE_UNITS_LOST, player as u8),
                worker_kills: totals.worker_kills,
                worker_losses: totals.worker_losses,
            };
            self.players[player].push(sample);
        }

        self.record_depots(game, frame, &depots);
        self.record_buildings(game, frame);
        self.record_research(game, frame);
        self.record_control_groups(game, frame, units, hotkey_frames_offset);
        self.seeded = true;
    }

    /// Replaces every player's number-key groups with what the game has on them right now.
    ///
    /// The game stores unique unit ids rather than pointers, so an id that no longer resolves is a
    /// unit that has died and is simply not counted: a group's count here is what recalling it
    /// would select.
    fn record_control_groups(
        &mut self,
        game: Game,
        frame: u32,
        units: &UnitArray,
        hotkey_frames_offset: Option<usize>,
    ) {
        // Truncated to the width the game stores a group's stamp at, so the two are subtracted in
        // the same arithmetic: a group untouched for longer than that width wraps and reads as
        // freshly used, which costs a dimmed tile rather than a wrong number.
        let now = frame as u16;
        for player in 0..MAX_PLAYERS {
            let groups = &mut self.players[player].control_groups;
            groups.clear();
            for group in 0..NUMBER_KEY_GROUPS {
                let Some((unit_id, count)) = read_control_group(game, units, player, group) else {
                    continue;
                };
                let stale = hotkey_frames_offset
                    .and_then(|offset| unsafe { last_used_frame(game, offset, player, group) })
                    .is_some_and(|used| now.wrapping_sub(used) > STALE_FRAMES);
                groups.push(ControlGroup {
                    // The game indexes a group by the digit it is bound with.
                    key: group as u8,
                    unit_id,
                    count,
                    stale,
                });
            }
        }
    }

    /// Notes a timeline entry, dropping the oldest once the feed is full.
    ///
    /// Silent until the game has been sampled once: a map may start with buildings, upgrades and
    /// bases already in place, and every one of them would otherwise be reported as having just
    /// happened on the first frame.
    fn push_event(
        &mut self,
        frame: u32,
        player: u8,
        kind: TimelineEventKind,
        subject: TimelineSubject,
    ) {
        if !self.seeded {
            return;
        }
        if self.events.len() == MAX_EVENTS {
            self.events.pop_front();
        }
        self.events.push_back(TimelineEvent {
            frame,
            player,
            kind,
            subject,
        });
    }

    /// Reports resource depots that were not standing at the last sample, as expansions when they
    /// are away from the player's own start location and as ordinary buildings when they are not.
    ///
    /// Driven from where the depots stand rather than from how many there are, because what makes a
    /// depot an expansion is where it was put.
    fn record_depots(&mut self, game: Game, frame: u32, depots: &[(u8, UnitId, i16, i16)]) {
        for &(player, id, x, y) in depots {
            let known = &mut self.players[player as usize].known_depots;
            if known
                .iter()
                .any(|&(known_x, known_y)| within(known_x, known_y, x, y, SAME_DEPOT_DISTANCE))
            {
                continue;
            }
            if known.len() == MAX_KNOWN_DEPOTS {
                known.remove(0);
            }
            known.push((x, y));
            let start = start_position(game, player);
            let kind = match within(start.0, start.1, x, y, EXPANSION_DISTANCE) {
                true => TimelineEventKind::BuildingCompleted,
                false => TimelineEventKind::ExpansionTaken,
            };
            self.push_event(frame, player, kind, TimelineSubject::Unit(id));
        }
    }

    /// Reports every building that finished since the last sample.
    ///
    /// Resource depots are left out: they are reported from where they stand, which is the only way
    /// to tell an expansion from another building in the main.
    fn record_buildings(&mut self, game: Game, frame: u32) {
        for id in 0..UNIT_ID_COUNT.min(UnitId::entry_amount()) {
            let unit_id = UnitId(id as u16);
            if !unit_id.is_building() || unit_id.is_town_hall() {
                continue;
            }
            for player in 0..MAX_PLAYERS {
                let count = game.completed_count(player as u8, unit_id);
                let previous = &mut self.previous.completed_units[id as usize][player];
                let built = count.saturating_sub(*previous);
                *previous = count;
                for _ in 0..built {
                    self.push_event(
                        frame,
                        player as u8,
                        TimelineEventKind::BuildingCompleted,
                        TimelineSubject::Unit(unit_id),
                    );
                }
            }
        }
    }

    /// Reports every upgrade and technology that was started or finished since the last sample.
    ///
    /// A start is the game's in-progress flag going up and a finish is the level or the researched
    /// flag moving, so an upgrade cancelled halfway reports its start and nothing else, which is
    /// exactly what happened.
    fn record_research(&mut self, game: Game, frame: u32) {
        for id in 0..UPGRADE_COUNT.min(UpgradeId::entry_amount()) {
            let upgrade = UpgradeId(id as u16);
            for player in 0..MAX_PLAYERS {
                let level = game.upgrade_level(player as u8, upgrade);
                let in_progress = game.upgrade_in_progress(player as u8, upgrade);
                let was_level = &mut self.previous.upgrade_level[player][id as usize];
                let finished = level > *was_level;
                *was_level = level;
                let was_running = &mut self.previous.upgrade_in_progress[player][id as usize];
                let started = in_progress && !*was_running;
                *was_running = in_progress;
                if started {
                    self.push_event(
                        frame,
                        player as u8,
                        TimelineEventKind::UpgradeStarted,
                        TimelineSubject::Upgrade(upgrade),
                    );
                }
                if finished {
                    self.push_event(
                        frame,
                        player as u8,
                        TimelineEventKind::UpgradeCompleted,
                        TimelineSubject::Upgrade(upgrade),
                    );
                }
            }
        }
        for id in 0..TECH_COUNT.min(TechId::entry_amount()) {
            let tech = TechId(id as u16);
            for player in 0..MAX_PLAYERS {
                let researched = game.tech_researched(player as u8, tech);
                let in_progress = game.tech_in_progress(player as u8, tech);
                let was_researched = &mut self.previous.tech_researched[player][id as usize];
                let finished = researched && !*was_researched;
                *was_researched = researched;
                let was_running = &mut self.previous.tech_in_progress[player][id as usize];
                let started = in_progress && !*was_running;
                *was_running = in_progress;
                if started {
                    self.push_event(
                        frame,
                        player as u8,
                        TimelineEventKind::TechStarted,
                        TimelineSubject::Tech(tech),
                    );
                }
                if finished {
                    self.push_event(
                        frame,
                        player as u8,
                        TimelineEventKind::TechCompleted,
                        TimelineSubject::Tech(tech),
                    );
                }
            }
        }
    }
}

/// Reads one of a player's selection groups: what it is mostly made of, and how many living units
/// are in it, or `None` for a group with nothing on it.
///
/// The icon is the commonest unit rather than the first, because the first entry of a group is
/// whatever happened to be selected when it was bound, while what a caster wants named is the army
/// the group is.
fn read_control_group(
    game: Game,
    units: &UnitArray,
    player: usize,
    group: usize,
) -> Option<(UnitId, u32)> {
    let ids = unsafe { *(**game).selection_hotkeys.get(player)?.get(group)? };
    let mut tally: Vec<(UnitId, u32)> = Vec::new();
    let mut count = 0;
    for id in ids {
        // Zero is the game's own end of the group rather than a unit it failed to find.
        if id == 0 {
            break;
        }
        let Some(unit) = units.get_by_unique_id(id) else {
            continue;
        };
        count += 1;
        let unit_id = unit.id();
        match tally
            .iter_mut()
            .find(|(candidate, _)| *candidate == unit_id)
        {
            Some(entry) => entry.1 += 1,
            None => tally.push((unit_id, 1)),
        }
    }
    let dominant = tally.into_iter().max_by_key(|&(_, held)| held)?.0;
    Some((dominant, count))
}

/// The frame a group was last written on, read out of the table `game` keeps it in.
///
/// # Safety
///
/// `offset` must be the byte offset of the game's own `u16[player][group]` stamp table, which is
/// what the binary analysis resolves it as.
unsafe fn last_used_frame(game: Game, offset: usize, player: usize, group: usize) -> Option<u16> {
    if player >= MAX_PLAYERS || group >= HOTKEY_GROUPS {
        return None;
    }
    unsafe {
        let base = (*game) as *const u8;
        let stamps = base.add(offset) as *const u16;
        Some(stamps.add(player * HOTKEY_GROUPS + group).read_unaligned())
    }
}

/// What one player owns, summed over the game's own per-unit counts.
#[derive(Copy, Clone, Default)]
struct UnitTotals {
    workers: u32,
    army_minerals: u32,
    army_gas: u32,
    worker_kills: u32,
    worker_losses: u32,
}

/// Sums every player's units out of the game's count tables.
///
/// Counted from the tables rather than by walking the unit list, because the tables include what the
/// list does not: a worker inside a refinery and a marine inside a dropship are both hidden from the
/// active list, and an army that shrank every time it loaded into a transport would be worse than no
/// army number at all.
fn unit_totals(game: Game) -> [UnitTotals; MAX_PLAYERS] {
    let mut totals = [UnitTotals::default(); MAX_PLAYERS];
    for id in 0..UNIT_ID_COUNT.min(UnitId::entry_amount()) {
        let unit_id = UnitId(id as u16);
        let worker = unit_id.is_worker();
        let army = counts_as_army(unit_id);
        if !worker && !army {
            continue;
        }
        let (minerals, gas) = (unit_id.mineral_cost(), unit_id.gas_cost());
        for (player, totals) in totals.iter_mut().enumerate() {
            let count = game.completed_count(player as u8, unit_id);
            if worker {
                totals.workers = totals.workers.saturating_add(count);
                totals.worker_kills = totals
                    .worker_kills
                    .saturating_add(game.unit_kills(player as u8, unit_id));
                totals.worker_losses = totals
                    .worker_losses
                    .saturating_add(game.unit_deaths(player as u8, unit_id));
            } else {
                totals.army_minerals = totals
                    .army_minerals
                    .saturating_add(count.saturating_mul(minerals));
                totals.army_gas = totals.army_gas.saturating_add(count.saturating_mul(gas));
            }
        }
    }
    totals
}

/// Whether a unit is part of what a player would fight with.
///
/// Buildings are what an army is made in rather than part of it, workers have a panel of their own,
/// subunits are the turret half of a unit already counted, and the things eggs and scarabs are do
/// not survive being counted: an egg is a unit on the way, which the production panel is already
/// showing.
fn counts_as_army(id: UnitId) -> bool {
    if id.is_building() || id.is_worker() || id.is_subunit() || id.is_powerup() {
        return false;
    }
    !matches!(
        id,
        unit::LARVA | unit::EGG | unit::LURKER_EGG | unit::COCOON | unit::SCARAB
    )
}

/// Whether a worker has nothing to do.
///
/// These are the orders a unit sits in while it waits to be told something. A worker mining, moving,
/// building or repairing is in an order of its own, so anything left here is a worker earning
/// nothing.
fn is_idle(unit: bw_dat::Unit) -> bool {
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

/// Whether two map positions are within `distance` pixels of each other.
fn within(ax: i16, ay: i16, bx: i16, by: i16, distance: i32) -> bool {
    let dx = i32::from(ax) - i32::from(bx);
    let dy = i32::from(ay) - i32::from(by);
    dx * dx + dy * dy <= distance * distance
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A history of `count` samples, each gathering `per_second` of each resource.
    fn steady(count: usize, per_second: u32) -> VecDeque<Sample> {
        (0..count as u32)
            .map(|second| Sample {
                gathered_minerals: second * per_second,
                gathered_gas: second * per_second,
                ..Sample::default()
            })
            .collect()
    }

    fn stats_with(samples: VecDeque<Sample>) -> GameStats {
        let mut stats = GameStats::new();
        stats.players[0].samples = samples;
        stats
    }

    #[test]
    fn income_is_a_rate_over_the_last_minute() {
        let stats = stats_with(steady(300, 10));
        assert_eq!(stats.income_per_minute(0), (600, 600));
    }

    #[test]
    fn a_game_shorter_than_the_window_is_quoted_at_the_rate_it_is_running_at() {
        // Ten seconds in at ten a second is six hundred a minute, not the hundred gathered so far.
        let stats = stats_with(steady(11, 10));
        assert_eq!(stats.income_per_minute(0), (600, 600));
    }

    #[test]
    fn a_game_with_nothing_in_it_yet_has_no_rate() {
        let stats = GameStats::new();
        assert_eq!(stats.income_per_minute(0), (0, 0));
        assert!(stats.latest(0).is_none());
        assert!(stats.series(0, GraphSeries::Income, 64).is_empty());
    }

    #[test]
    fn a_series_is_thinned_to_the_points_asked_for_and_keeps_its_ends() {
        let mut samples = VecDeque::new();
        for workers in 0..500u32 {
            samples.push_back(Sample {
                workers,
                ..Sample::default()
            });
        }
        let stats = stats_with(samples);
        let series = stats.series(0, GraphSeries::Workers, 100);
        assert_eq!(series.len(), 100);
        assert_eq!(series.first(), Some(&0.0));
        assert_eq!(series.last(), Some(&499.0));
    }

    #[test]
    fn a_series_shorter_than_the_points_asked_for_is_left_whole() {
        let stats = stats_with(steady(7, 1));
        assert_eq!(stats.series(0, GraphSeries::Supply, 100).len(), 7);
    }

    #[test]
    fn a_history_is_bounded_by_the_two_hours_it_keeps() {
        let mut player = PlayerStats::new();
        for workers in 0..(MAX_SAMPLES as u32 + 10) {
            player.push(Sample {
                workers,
                ..Sample::default()
            });
        }
        assert_eq!(player.samples.len(), MAX_SAMPLES);
        // The oldest go rather than the newest: a graph of the last two hours is worth more than a
        // graph frozen at the first two.
        assert_eq!(
            player.samples.back().map(|s| s.workers),
            Some(MAX_SAMPLES as u32 + 9)
        );
    }

    #[test]
    fn map_distance_is_measured_as_a_circle() {
        assert!(within(0, 0, 30, 40, 50));
        assert!(!within(0, 0, 30, 40, 49));
    }
}
