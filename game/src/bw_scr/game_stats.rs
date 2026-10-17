//! The running record of the game the observer panels report from.
//!
//! Everything the matchup bar shows is true of the frame it is drawn on, so it is read straight off
//! BW. The stats wings are not: an income is a rate, a graph is a history, and a timeline is a list
//! of the moments something changed. None of that exists anywhere in the game's memory, so it is
//! built here, one sample per second of game time, from the counts and score tables BW does keep:
//! [`snapshot`] copies a frame out of the game, and [`GameStats::apply`] turns the copies into
//! history.
//!
//! This runs on BW's own thread, inside the step that advances the simulation, so it sees every
//! frame the simulation does, including the ones a replay seek fast-forwards through with nothing
//! drawn. Samples are taken on a fixed grid of frames, so every pass over the same stretch of game
//! samples the same frames, and the history is kept by frame and read as of the frame on screen.
//! That is what lets a replay seek without the history going wrong: a seek restores a keyframe of
//! a stretch already simulated, before or after the frame it left, and a replay simulates every
//! frame the same way every time, so whatever is already recorded for that stretch stays true.
//! Only a rollback re-simulates a frame that can come out differently, and it says so (see
//! [`Resimulation`]).
//!
//! The memory is bounded: [`MAX_SAMPLES`] rows of samples, past which the older half of the game
//! is kept at half the detail, and [`MAX_EVENTS`] timeline entries.

mod deaths;
mod engagements;
mod snapshot;
mod timeline;
mod unit_value;

use std::collections::VecDeque;

use bw_dat::{TechId, UnitId, UpgradeId};
use overlay_ui::observer::{GraphSeries, Significance, TimelineEventKind};

pub(crate) use deaths::Death;
pub(crate) use snapshot::{
    GameSnapshot, SCORE_UNITS_KILLED, SCORE_UNITS_LOST, SCORE_UNITS_PRODUCED, control_group_units,
    read_snapshot,
};
pub(crate) use unit_value::DatUnits;

use snapshot::PlayerSnapshot;
use timeline::Baseline;
use unit_value::{HalfCost, UnitCatalog, counted_from_creation, counts_as_army, invested_cost};

/// How many players the game keeps playable slots for, which is as many as anything here reports on.
pub const MAX_PLAYERS: usize = 8;

/// How many frames apart two samples are. Twenty-four frames is one second at the speed every
/// competitive game and almost every replay runs at, which is what makes a sample a second.
const SAMPLE_INTERVAL_FRAMES: u32 = 24;

/// How many rows of samples are kept at full detail: two hours of game time.
const MAX_SAMPLES: usize = 2 * 60 * 60;

/// How far back a rate is measured, in frames. A minute is long enough that one worker walking to
/// a new patch does not move the number, and short enough that a base lost is visible at once.
const INCOME_WINDOW_FRAMES: u32 = 60 * SAMPLE_INTERVAL_FRAMES;

/// How many timeline entries are kept, a replay's seek bar marking every one of them.
///
/// A long eight-player game finishes a few thousand buildings, upgrades and researches between its
/// players, so no real game reaches this: it only stops a map that churns out buildings forever
/// from growing without end, and such a map loses its oldest entries first. About twenty bytes
/// each, so a third of a megabyte when full.
const MAX_EVENTS: usize = 16 * 1024;

/// How many deaths are kept: a long game with big armies on both sides loses a few thousand units,
/// at a few bytes each.
const MAX_DEATHS: usize = 1 << 16;

/// How many samples' baselines are kept to compare a re-simulated sample against. A rollback
/// reaches back a handful of frames, which is never more than a second or two of samples.
const BASELINES_KEPT: usize = 4;

/// How many unit, upgrade and technology entries are walked. These are the counts the game's own
/// fixed-size tables hold; a mod with more entries than this is simply not reported on past them.
const UNIT_ID_COUNT: u32 = 0xe4;
const UPGRADE_COUNT: u32 = 0x3d;
const TECH_COUNT: u32 = 0x2c;

/// How long a group has to go without being recalled before it is worth pointing out, in frames.
///
/// A minute of game time. Long enough that a group a player is cycling through stays lit, short
/// enough that an army parked at home while its owner macros is called out while it still matters.
const STALE_FRAMES: u16 = 60 * SAMPLE_INTERVAL_FRAMES as u16;

/// Whether a frame the simulation steps again comes out the way it did the first time.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Resimulation {
    /// It does: a replay plays the same commands every time, so a seek that goes back over frames
    /// already sampled can only sample them again as they were.
    Identical,
    /// It may not: a rollback steps frames again because inputs they were first simulated without
    /// have arrived, so what was sampled from them is out of date.
    MayDiffer,
}

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
    /// What everything they have killed was worth, by the game's own destroy scores.
    pub kills_score: u32,
    /// What every building they have destroyed was worth, the same way.
    pub razings_score: u32,
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

/// Every player's sample from one frame.
#[derive(Copy, Clone)]
struct SampleRow {
    frame: u32,
    players: [Sample; MAX_PLAYERS],
}

/// What a timeline entry is about, which is how the panel picks the icon it draws.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TimelineSubject {
    Unit(UnitId),
    Upgrade(UpgradeId),
    Tech(TechId),
}

/// One moment worth putting a clock on.
#[derive(Copy, Clone, Debug)]
pub struct TimelineEvent {
    /// The frame it happened on. Frames rather than seconds, because turning one into the other
    /// needs the speed the game was recorded at, which only the draw path knows.
    pub frame: u32,
    /// The frame of the sample that recorded it: the same, but for something only judged once it
    /// was over, such as a fight, which is put at the moment it began.
    pub recorded: u32,
    pub player: u8,
    pub kind: TimelineEventKind,
    pub significance: Significance,
    pub subject: TimelineSubject,
    /// Where on the map it happened, in map pixels: the building that finished or that the research
    /// runs in. `None` where the sampler could not tell which building it was.
    pub position: Option<(i16, i16)>,
}

/// One of a player's number-key selection groups, as the last sample found it.
#[derive(Copy, Clone)]
pub struct ControlGroup {
    /// The digit the group answers to.
    pub key: u8,
    /// What the group is mostly made of, which is the icon it is named by.
    pub unit_id: UnitId,
    /// The other kind in a group made of two, or `None` for a group that is one thing.
    pub secondary_unit_id: Option<UnitId>,
    /// How many living units are in it.
    pub count: u32,
    /// Whether the group is a building. The game lets a group hold twelve units or one building, so
    /// a building group is one building, and a count of it says nothing.
    pub building: bool,
    /// Whether it has gone long enough without being recalled to be worth pointing out.
    pub stale: bool,
}

/// The sampler. See the module docs.
pub struct GameStats {
    /// Sorted by frame, one row per sample.
    rows: Vec<SampleRow>,
    /// Sorted by frame.
    events: Vec<TimelineEvent>,
    /// Every unit seen to die, sorted by frame.
    deaths: Vec<Death>,
    /// What the newest samples left behind to be compared against, oldest first.
    baselines: VecDeque<Baseline>,
    /// What each player has on their number keys, replaced whole every sample: a group is what it
    /// is right now, and nothing here is read against what it was.
    control_groups: [Vec<ControlGroup>; MAX_PLAYERS],
    /// How much of the map each player could see as of the last sample, or `None` before one.
    vision: Option<MapVision>,
    /// The frame `control_groups` and `vision` were read on.
    current_state_frame: Option<u32>,
    /// The last frame of the replay being watched, after which nothing more is sampled.
    end_frame: Option<u32>,
    /// Counts every change to `rows` or `events`, and is never reset, so a [`HistoryStamp`] taken
    /// before a [`clear`](Self::clear) never matches one taken after it.
    generation: u64,
    /// The `generation` that `rows` and `events` last changed in.
    rows_changed: u64,
    events_changed: u64,
}

/// Which of the sampler's history a reader is looking at: two readings with equal stamps read the
/// same entries, so whatever was worked out from one holds for the other.
///
/// The history only changes at a sample, while it is read every frame, and the stretch of it read
/// moves with a replay's seek without anything being sampled.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct HistoryStamp {
    changed: u64,
    shown: usize,
}

/// How much of the map is in sight, read off the game's own per-tile visibility.
///
/// Kept as a count of the map's tiles for every combination of players that cannot see them, which
/// is what each tile records: one bit per player, set while that player has no vision of it. Any set
/// of players' share of the map comes out of those counts without walking the map again.
pub struct MapVision {
    hidden_from: Box<[u32; 256]>,
    total: u32,
}

impl MapVision {
    /// Counts the map's tiles by who cannot see them.
    pub fn read(tile_flags: &[u32]) -> MapVision {
        let mut hidden_from = Box::new([0u32; 256]);
        for &flags in tile_flags {
            hidden_from[(flags & 0xff) as usize] += 1;
        }
        MapVision {
            hidden_from,
            total: tile_flags.len() as u32,
        }
    }

    /// The share of the map, from 0 to 1, that at least one of `players` (a mask of player ids
    /// 0 to 7) can see.
    pub fn seen_by(&self, players: u8) -> f32 {
        if self.total == 0 {
            return 0.0;
        }
        let seen: u32 = (0..=255u8)
            .filter(|&hidden| !hidden & players != 0)
            .map(|hidden| self.hidden_from[hidden as usize])
            .sum();
        seen as f32 / self.total as f32
    }
}

impl GameStats {
    pub fn new() -> GameStats {
        GameStats {
            rows: Vec::new(),
            events: Vec::new(),
            deaths: Vec::new(),
            baselines: VecDeque::new(),
            control_groups: Default::default(),
            vision: None,
            current_state_frame: None,
            end_frame: None,
            generation: 0,
            rows_changed: 0,
            events_changed: 0,
        }
    }

    /// Forgets the game, for a game that is about to start, or to be simulated again from frame
    /// zero when a replay seek is left to the game itself.
    pub fn clear(&mut self) {
        let generation = self.generation + 1;
        *self = GameStats {
            generation,
            rows_changed: generation,
            events_changed: generation,
            ..GameStats::new()
        };
    }

    /// Records the last frame of the replay being watched, `None` for a game still being played,
    /// whose end is only known as its players leave it.
    pub fn set_end_frame(&mut self, end_frame: Option<u32>) {
        self.end_frame = end_frame;
    }

    /// Takes a sample of the frame the simulation just stepped to, if one is due on it, through
    /// `read`.
    pub fn step(
        &mut self,
        frame: u32,
        resimulation: Resimulation,
        catalog: &impl UnitCatalog,
        read: impl FnOnce() -> GameSnapshot,
    ) {
        if frame.is_multiple_of(SAMPLE_INTERVAL_FRAMES) {
            self.apply(read(), resimulation, catalog);
        }
    }

    /// Whether what the game is like right now (number keys, vision) was read too far from `frame`
    /// for the frame on screen to show it. Sampling keeps it within one interval while the
    /// simulation plays on; only a replay seek moves the frame anywhere else, and a paused replay
    /// then stays there with nothing stepped to read it again.
    pub fn current_state_stale(&self, frame: u32) -> bool {
        self.current_state_frame
            .is_some_and(|read| frame < read || frame - read >= SAMPLE_INTERVAL_FRAMES)
    }

    /// Takes what the game is like right now out of `snapshot`, leaving its history alone.
    pub fn refresh_current_state(
        &mut self,
        mut snapshot: GameSnapshot,
        catalog: &impl UnitCatalog,
    ) {
        self.take_current_state(&mut snapshot, catalog);
    }

    fn take_current_state(&mut self, snapshot: &mut GameSnapshot, catalog: &impl UnitCatalog) {
        self.vision = snapshot.vision.take();
        for (groups, player) in self.control_groups.iter_mut().zip(&snapshot.players) {
            *groups = read_control_groups(player, snapshot.frame, catalog);
        }
        self.current_state_frame = Some(snapshot.frame);
    }

    /// The frame the newest sample was taken on.
    fn sampled_through(&self) -> Option<u32> {
        self.rows.last().map(|row| row.frame)
    }

    /// Records one sample, and everything that changed since the one before it.
    ///
    /// A frame already sampled is only recorded again when re-simulating it may have changed it;
    /// then everything from it on is forgotten first and worked out afresh. Either way, what the
    /// game has on its number keys and in sight is taken from this sample, since those are read as
    /// they are now rather than as history.
    pub fn apply(
        &mut self,
        mut snapshot: GameSnapshot,
        resimulation: Resimulation,
        catalog: &impl UnitCatalog,
    ) {
        let frame = snapshot.frame;
        self.take_current_state(&mut snapshot, catalog);
        let events_before = self.events.len();
        if self
            .sampled_through()
            .is_some_and(|through| frame <= through)
        {
            match resimulation {
                Resimulation::Identical => return,
                Resimulation::MayDiffer => self.forget_from(frame),
            }
        }
        let events_forgotten = self.events.len() != events_before;
        let row = SampleRow {
            frame,
            players: player_samples(&snapshot, catalog),
        };
        // Events are only worked out against the sample one interval before this one. Anything
        // else is a gap the samples skipped over, and whatever happened in it can't be put at a
        // time.
        let previous = self
            .baselines
            .back()
            .filter(|baseline| baseline.frame.checked_add(SAMPLE_INTERVAL_FRAMES) == Some(frame));
        let mut fresh_deaths = Vec::new();
        if let Some(previous) = previous {
            let out = snapshot.players.each_ref().map(|player| player.out);
            deaths::record(
                &previous.roster,
                &snapshot.roster,
                out,
                frame,
                &mut fresh_deaths,
            );
            self.deaths.extend_from_slice(&fresh_deaths);
            let excess = self.deaths.len().saturating_sub(MAX_DEATHS);
            self.deaths.drain(..excess);
        }
        let now = standing(&row, &snapshot);
        let before = previous
            .and(self.rows.last())
            .map(|row| standing(row, &snapshot))
            .unwrap_or_default();
        let mut events = Vec::new();
        let engagements = engagements::advance(
            previous.map(|previous| &previous.engagements),
            &fresh_deaths,
            &engagements::Moment {
                before: &before,
                now: &now,
                rosters: [
                    previous.map_or(&[][..], |previous| &previous.roster),
                    &snapshot.roster,
                ],
                frame,
                last_sample: self
                    .end_frame
                    .is_some_and(|end| frame + SAMPLE_INTERVAL_FRAMES > end),
            },
            catalog,
            &mut events,
        );
        // What each player has ever built carries on from the newest baseline even across a gap
        // the samples skipped, so a building after one is still judged by how many came before it.
        let built = self.baselines.back().map(|newest| newest.built.clone());
        let mut baseline = timeline::advance(previous, built, snapshot, catalog, &mut events);
        baseline.engagements = engagements;
        self.generation += 1;
        self.rows_changed = self.generation;
        if events_forgotten || !events.is_empty() {
            self.events_changed = self.generation;
        }
        self.keep_events(events);
        if self.rows.len() >= MAX_SAMPLES {
            thin_older_half(&mut self.rows);
        }
        self.rows.push(row);
        if self.baselines.len() == BASELINES_KEPT {
            self.baselines.pop_front();
        }
        self.baselines.push_back(baseline);
    }

    /// Adds a sample's events to the timeline in the order they happened, which for one judged
    /// after it was over is earlier than the sample, dropping its oldest past [`MAX_EVENTS`].
    fn keep_events(&mut self, events: Vec<TimelineEvent>) {
        for event in events {
            let at = self
                .events
                .partition_point(|kept| kept.frame <= event.frame);
            self.events.insert(at, event);
        }
        let excess = self.events.len().saturating_sub(MAX_EVENTS);
        self.events.drain(..excess);
    }

    /// Forgets every sample and event from `frame` on, for frames about to be simulated again
    /// differently.
    fn forget_from(&mut self, frame: u32) {
        self.rows
            .truncate(self.rows.partition_point(|row| row.frame < frame));
        // An event judged after it was over can have happened before `frame` and been recorded
        // after it, by a sample that is being taken again.
        self.events
            .retain(|event| event.frame < frame && event.recorded < frame);
        self.deaths
            .truncate(self.deaths.partition_point(|death| death.frame < frame));
        while self
            .baselines
            .back()
            .is_some_and(|baseline| baseline.frame >= frame)
        {
            self.baselines.pop_back();
        }
    }

    /// The history as it stood on `frame`, which is the frame on screen: a replay that seeked back
    /// keeps what it recorded past it, and none of that has happened yet as far as the watcher is
    /// concerned.
    pub fn as_of(&self, frame: u32) -> StatsAsOf<'_> {
        StatsAsOf {
            rows: &self.rows[..self.rows.partition_point(|row| row.frame <= frame)],
            events: &self.events[..self.events.partition_point(|event| event.frame <= frame)],
            stats: self,
        }
    }
}

/// A record of what the sampler took and worked out, for tuning what it reports against real games.
#[cfg(debug_assertions)]
impl GameStats {
    /// Every death, timeline event and sample recorded after `frame`, as lines of comma-separated
    /// values, with the frame the newest of them is from.
    pub fn debug_lines_after(&self, frame: u32) -> (Vec<String>, u32) {
        let mut lines = Vec::new();
        let mut newest = frame;
        for row in self.rows.iter().filter(|row| row.frame > frame) {
            let players = row
                .players
                .iter()
                .map(|sample| {
                    format!(
                        "{},{},{},{},{},{}",
                        sample.army_value(),
                        sample.workers,
                        sample.supply_used,
                        sample.units_killed,
                        sample.units_lost,
                        sample.kills_score,
                    )
                })
                .collect::<Vec<_>>();
            lines.push(format!("sample,{},{}", row.frame, players.join(",")));
            newest = newest.max(row.frame);
        }
        for death in self.deaths.iter().filter(|death| death.frame > frame) {
            lines.push(format!(
                "death,{},{},{},{},{},{}",
                death.frame,
                death.player,
                death.unit_id.0,
                u8::from(death.completed),
                death.x,
                death.y,
            ));
        }
        for event in self.events.iter().filter(|event| event.recorded > frame) {
            let (x, y) = event.position.unwrap_or((-1, -1));
            lines.push(format!(
                "event,{},{},{:?},{:?},{x},{y},{:?}",
                event.frame, event.player, event.kind, event.subject, event.significance,
            ));
        }
        (lines, newest)
    }
}

/// The sampler's history up to one frame. See [`GameStats::as_of`].
pub struct StatsAsOf<'a> {
    rows: &'a [SampleRow],
    events: &'a [TimelineEvent],
    stats: &'a GameStats,
}

impl<'a> StatsAsOf<'a> {
    /// Which samples this reads.
    pub fn samples_stamp(&self) -> HistoryStamp {
        HistoryStamp {
            changed: self.stats.rows_changed,
            shown: self.rows.len(),
        }
    }

    /// Which timeline entries this reads.
    pub fn events_stamp(&self) -> HistoryStamp {
        HistoryStamp {
            changed: self.stats.events_changed,
            shown: self.events.len(),
        }
    }

    /// How much of the map each player could see as of the last sample.
    pub fn vision(&self) -> Option<&MapVision> {
        self.stats.vision.as_ref()
    }

    /// What a player has on their number keys, as of the last sample.
    pub fn control_groups(&self, player: u8) -> &[ControlGroup] {
        match self.stats.control_groups.get(player as usize) {
            Some(groups) => groups,
            None => &[],
        }
    }

    /// The most recent sample for a player, or `None` before the first one is taken.
    pub fn latest(&self, player: u8) -> Option<&Sample> {
        self.rows.last()?.players.get(player as usize)
    }

    /// What a player gathered of each resource over the last minute of game time.
    ///
    /// Measured over however much history there is when there is less than a minute of it, and
    /// scaled up to the minute it is quoted as, so an opening reads as the rate it is running at
    /// rather than as a fraction of one.
    pub fn income_per_minute(&self, player: u8) -> (u32, u32) {
        if player as usize >= MAX_PLAYERS {
            return (0, 0);
        }
        let Some(latest) = self.rows.len().checked_sub(1) else {
            return (0, 0);
        };
        let window = income_window(self.rows, latest);
        let player = player as usize;
        (
            income_over(window, player, |sample| sample.gathered_minerals),
            income_over(window, player, |sample| sample.gathered_gas),
        )
    }

    /// How much more a player gathered over the last minute of game time than over the minute
    /// before it, minerals and gas together, per minute: negative where their income fell. `None`
    /// until there are two whole minutes to compare.
    pub fn income_trend(&self, player: u8) -> Option<i32> {
        if player as usize >= MAX_PLAYERS {
            return None;
        }
        let player = player as usize;
        let latest = self.rows.last()?;
        let minute_ago =
            row_at_or_before(self.rows, latest.frame.checked_sub(INCOME_WINDOW_FRAMES)?)?;
        let two_minutes_ago = row_at_or_before(
            self.rows,
            latest.frame.checked_sub(INCOME_WINDOW_FRAMES * 2)?,
        )?;
        let gathered = |row: &SampleRow| row.players[player].gathered();
        let recent = per_minute(
            gathered(latest),
            latest.frame,
            gathered(minute_ago),
            minute_ago.frame,
        )?;
        let before = per_minute(
            gathered(minute_ago),
            minute_ago.frame,
            gathered(two_minutes_ago),
            two_minutes_ago.frame,
        )?;
        let trend = i64::from(recent) - i64::from(before);
        Some(trend.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32)
    }

    /// One player's history of `series`, read at no more than `points` evenly spaced moments from
    /// the first sample to the last.
    ///
    /// Thinned rather than handed over whole, because a graph is a few hundred points wide and an
    /// hour of game time is thousands of samples: everything past one value per point is line
    /// segments shorter than a pixel. Spaced by frame rather than by sample, so a stretch the
    /// samples are sparse over takes up the time it lasted.
    pub fn series(&self, player: u8, series: GraphSeries, points: usize) -> Vec<f32> {
        let rows = self.rows;
        if player as usize >= MAX_PLAYERS || rows.len() < 2 || points < 2 {
            return Vec::new();
        }
        let player = player as usize;
        let points = points.min(rows.len());
        let first = u64::from(rows[0].frame);
        let span = u64::from(rows[rows.len() - 1].frame) - first;
        (0..points)
            .map(|point| {
                let frame = first + span * point as u64 / (points - 1) as u64;
                let index = rows
                    .partition_point(|row| u64::from(row.frame) <= frame)
                    .saturating_sub(1);
                value_at(rows, index, player, series)
            })
            .collect()
    }

    /// What has happened, newest first.
    pub fn events(&self) -> impl Iterator<Item = &'a TimelineEvent> + use<'a> {
        self.events.iter().rev()
    }
}

/// What one player's sample in `rows[index]` is worth on a plot of `series`.
fn value_at(rows: &[SampleRow], index: usize, player: usize, series: GraphSeries) -> f32 {
    let sample = &rows[index].players[player];
    match series {
        GraphSeries::ArmyValue => sample.army_value() as f32,
        // A rate rather than a level, so it is measured over the window ending here.
        GraphSeries::Income => {
            income_over(income_window(rows, index), player, Sample::gathered) as f32
        }
        GraphSeries::Supply => sample.supply_used as f32,
        GraphSeries::Workers => sample.workers as f32,
        GraphSeries::Kills => sample.units_killed as f32,
    }
}

/// The two samples the income at `rows[index]` is measured between: that one, and the newest at
/// least a minute of game time older, or the first where there is less than a minute of history.
///
/// Rates are then taken over the frames actually between the two, so a stretch the samples skipped
/// is averaged over rather than counted as one interval.
fn income_window(rows: &[SampleRow], index: usize) -> (&SampleRow, &SampleRow) {
    let latest = &rows[index];
    let earliest = row_at_or_before(
        &rows[..=index],
        latest.frame.saturating_sub(INCOME_WINDOW_FRAMES),
    )
    .unwrap_or(&rows[0]);
    (latest, earliest)
}

/// How much of what `read` picks out of `player`'s samples was gathered per minute between the two
/// ends of a window.
fn income_over(
    (latest, earliest): (&SampleRow, &SampleRow),
    player: usize,
    read: impl Fn(&Sample) -> u32,
) -> u32 {
    per_minute(
        read(&latest.players[player]),
        latest.frame,
        read(&earliest.players[player]),
        earliest.frame,
    )
    .unwrap_or(0)
}

/// The newest row taken on or before `frame`.
fn row_at_or_before(rows: &[SampleRow], frame: u32) -> Option<&SampleRow> {
    rows[..rows.partition_point(|row| row.frame <= frame)].last()
}

/// How much a total that went from `then` at `then_frame` to `now` at `now_frame` grew per minute
/// of game time, or `None` with no time between the two.
fn per_minute(now: u32, now_frame: u32, then: u32, then_frame: u32) -> Option<u32> {
    let elapsed = now_frame
        .checked_sub(then_frame)
        .filter(|&elapsed| elapsed > 0)?;
    let grown = u64::from(now.saturating_sub(then)) * u64::from(INCOME_WINDOW_FRAMES);
    Some((grown / u64::from(elapsed)).min(u64::from(u32::MAX)) as u32)
}

/// Halves the detail of the older half of `rows`, keeping its first sample: a graph of a long game
/// is a few hundred points wide, so the start of it loses nothing at one sample every few seconds,
/// and rates are measured by the frames between samples so they stay true.
fn thin_older_half(rows: &mut Vec<SampleRow>) {
    let older = rows.len() / 2;
    let mut index = 0;
    rows.retain(|_| {
        let keep = index >= older || index.is_multiple_of(2);
        index += 1;
        keep
    });
}

/// Each player's standing as `row` has it, with the alliances and departures `snapshot` read.
fn standing(row: &SampleRow, snapshot: &GameSnapshot) -> engagements::Standing {
    engagements::Standing {
        army: row.players.each_ref().map(Sample::army_value),
        workers: row.players.each_ref().map(|sample| sample.workers),
        kills: row.players.each_ref().map(|sample| sample.kills_score),
        razings: row.players.each_ref().map(|sample| sample.razings_score),
        allies: snapshot.players.each_ref().map(|player| player.allies),
        out: snapshot.players.each_ref().map(|player| player.out),
    }
}

/// Every player's sample out of one snapshot.
fn player_samples(snapshot: &GameSnapshot, catalog: &impl UnitCatalog) -> [Sample; MAX_PLAYERS] {
    let mut workers = [0u32; MAX_PLAYERS];
    let mut army = [HalfCost::default(); MAX_PLAYERS];
    for (id, counts) in snapshot.completed_units.iter().enumerate() {
        let unit_id = UnitId(id as u16);
        if catalog.is_worker(unit_id) {
            for (workers, &count) in workers.iter_mut().zip(counts) {
                *workers = workers.saturating_add(count);
            }
        } else if counts_as_army(catalog, unit_id) {
            let counts = match counted_from_creation(unit_id) {
                true => snapshot.existing_units.get(id).unwrap_or(counts),
                false => counts,
            };
            let cost = invested_cost(catalog, unit_id);
            for (army, &count) in army.iter_mut().zip(counts) {
                *army = army.add(cost.times(count));
            }
        }
    }
    std::array::from_fn(|player| {
        let read = &snapshot.players[player];
        let (army_minerals, army_gas) = army[player].whole();
        Sample {
            gathered_minerals: read.gathered_minerals,
            gathered_gas: read.gathered_gas,
            army_minerals,
            army_gas,
            workers: workers[player],
            idle_workers: read.idle_workers.min(workers[player]),
            supply_used: read.supply_used,
            units_killed: read.units_killed,
            units_lost: read.units_lost,
            kills_score: read.kills_score,
            razings_score: read.razings_score,
            worker_kills: read.worker_kills,
            worker_losses: read.worker_losses,
        }
    })
}

/// How small a share of a group its second kind may hold and still be worth naming, as the divisor
/// of the fraction it has to reach.
///
/// A quarter. Below that the group is one thing with strays in it — an army of zealots that a
/// templar walked into is still an army of zealots — and above it the group really was built as a
/// mix, which is a different army and worth saying so.
const COMBO_SHARE_DIVISOR: u32 = 4;

/// One player's number-key groups as `player` read them on `frame`.
fn read_control_groups(
    player: &PlayerSnapshot,
    frame: u32,
    catalog: &impl UnitCatalog,
) -> Vec<ControlGroup> {
    // Truncated to the width the game stores a group's stamp at, so the two are subtracted in the
    // same arithmetic: a group untouched for longer than that width wraps and reads as freshly
    // used, which costs a dimmed tile rather than a wrong number.
    let now = frame as u16;
    player
        .control_groups
        .iter()
        .enumerate()
        .filter_map(|(key, reading)| {
            let reading = reading.as_ref()?;
            let tally: Vec<(UnitId, u32, u32)> = reading
                .kinds
                .iter()
                .map(|&(id, held)| (id, held, invested_cost(catalog, id).total()))
                .collect();
            let (dominant, runner_up) = group_composition(&tally)?;
            Some(ControlGroup {
                // The game indexes a group by the digit it is bound with.
                key: key as u8,
                unit_id: dominant,
                secondary_unit_id: runner_up,
                count: reading.kinds.iter().map(|&(_, held)| held).sum(),
                building: catalog.is_building(dominant),
                stale: reading
                    .last_used
                    .is_some_and(|used| now.wrapping_sub(used) > STALE_FRAMES),
            })
        })
        .collect()
}

/// Picks the one or two kinds that name a group, out of its tally of `(kind, units, cost)`.
///
/// The group is named by its commonest kind rather than by its first, because the first entry of a
/// group is whatever happened to be selected when it was bound, while what a caster wants named is
/// the army the group is. Two kinds holding the same number of units are separated by what they
/// cost: the expensive half of a mix is the half the group was built around, and a dropship full of
/// marines is a drop rather than a dropship.
///
/// The runner-up is only named when it holds at least a [`COMBO_SHARE_DIVISOR`]th of the group.
fn group_composition(tally: &[(UnitId, u32, u32)]) -> Option<(UnitId, Option<UnitId>)> {
    let total: u32 = tally.iter().map(|&(_, held, _)| held).sum();
    let leader = (0..tally.len()).max_by_key(|&index| {
        let (_, held, cost) = tally[index];
        (held, cost)
    })?;
    let runner_up = tally
        .iter()
        .enumerate()
        .filter(|&(index, _)| index != leader)
        .max_by_key(|&(_, &(_, held, cost))| (held, cost))
        .filter(|&(_, &(_, held, _))| held.saturating_mul(COMBO_SHARE_DIVISOR) >= total)
        .map(|(_, &(id, _, _))| id);
    Some((tally[leader].0, runner_up))
}

#[cfg(test)]
mod tests {
    use bw_dat::unit;

    use super::snapshot::{BuildingSite, DepotSite, ResearchLevels, RosterUnit};
    use super::unit_value::tests::FakeUnits;
    use super::*;

    const SECOND: u32 = SAMPLE_INTERVAL_FRAMES;
    const MINUTE: u32 = 60 * SECOND;

    /// Player 0's main, and a base far enough from it to be an expansion.
    const MAIN: (i16, i16) = (1000, 1000);
    const NATURAL: (i16, i16) = (2000, 1000);

    /// A game where nothing has happened yet on `frame`, but for player 0 having gathered ten of
    /// each resource every second so far.
    fn snapshot(frame: u32) -> GameSnapshot {
        let mut players: [PlayerSnapshot; MAX_PLAYERS] = Default::default();
        players[0].gathered_minerals = frame / SECOND * 10;
        players[0].gathered_gas = frame / SECOND * 10;
        players[0].start = MAIN;
        GameSnapshot {
            frame,
            players,
            completed_units: vec![[0; MAX_PLAYERS]; UNIT_ID_COUNT as usize].into_boxed_slice(),
            existing_units: vec![[0; MAX_PLAYERS]; UNIT_ID_COUNT as usize].into_boxed_slice(),
            research: ResearchLevels::new(),
            depots: Vec::new(),
            buildings: Vec::new(),
            research_sites: Vec::new(),
            vision: None,
            roster: Vec::new(),
        }
    }

    /// Steps `stats` through every frame in `frames`, each with what `game` says the game held then.
    fn play(
        stats: &mut GameStats,
        frames: std::ops::RangeInclusive<u32>,
        resimulation: Resimulation,
        game: impl Fn(u32) -> GameSnapshot,
    ) {
        let units = FakeUnits::standard();
        for frame in frames {
            stats.step(frame, resimulation, &units, || game(frame));
        }
    }

    fn replay(stats: &mut GameStats, frames: std::ops::RangeInclusive<u32>) {
        play(stats, frames, Resimulation::Identical, game_with_barracks);
    }

    /// The game [`snapshot`] describes, with player 0 finishing a barracks at ten minutes.
    fn game_with_barracks(frame: u32) -> GameSnapshot {
        let mut snapshot = snapshot(frame);
        if frame >= 10 * MINUTE {
            snapshot.completed_units[unit::BARRACKS.0 as usize][0] = 1;
            snapshot.buildings.push(BuildingSite {
                player: 0,
                unit_id: unit::BARRACKS,
                x: 1100,
                y: 1000,
            });
        }
        snapshot
    }

    /// The frames of the events visible in `stats`, oldest first.
    fn event_frames(stats: &StatsAsOf<'_>) -> Vec<u32> {
        let mut frames: Vec<u32> = stats.events().map(|event| event.frame).collect();
        frames.reverse();
        frames
    }

    fn depot(unique_id: u32, unit_id: UnitId, (x, y): (i16, i16)) -> DepotSite {
        DepotSite {
            player: 0,
            unique_id,
            unit_id,
            x,
            y,
            completed: true,
            landed: true,
        }
    }

    /// Takes one sample a second of each set of depots in `samples`, and returns what was reported
    /// as `(kind, subject, second)`, oldest first.
    fn depot_events(samples: &[Vec<DepotSite>]) -> Vec<(TimelineEventKind, TimelineSubject, u32)> {
        let mut stats = GameStats::new();
        for (index, depots) in samples.iter().enumerate() {
            let frame = (index as u32 + 1) * SECOND;
            let mut snapshot = snapshot(frame);
            snapshot.depots = depots.clone();
            stats.apply(snapshot, Resimulation::Identical, &FakeUnits::standard());
        }
        let mut events: Vec<_> = stats
            .as_of(u32::MAX)
            .events()
            .map(|event| (event.kind, event.subject, event.frame / SECOND))
            .collect();
        events.reverse();
        events
    }

    #[test]
    fn a_side_sees_every_tile_any_of_its_players_does() {
        // Four tiles: hidden from everyone, seen by player 0 alone, by player 1 alone, by both.
        let vision = MapVision::read(&[0xff, 0xfe, 0xfd, 0xfc]);
        assert_eq!(vision.seen_by(0b01), 0.5);
        assert_eq!(vision.seen_by(0b10), 0.5);
        assert_eq!(vision.seen_by(0b11), 0.75);
        assert_eq!(vision.seen_by(0b100), 0.0);
        assert_eq!(MapVision::read(&[]).seen_by(0b1), 0.0);
    }

    #[test]
    fn samples_are_taken_once_a_second() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=10 * SECOND + 5);
        assert_eq!(stats.rows.len(), 10);
        assert!(stats.rows.iter().all(|row| row.frame % SECOND == 0));
    }

    #[test]
    fn income_is_a_rate_over_the_last_minute() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=5 * MINUTE);
        assert_eq!(stats.as_of(5 * MINUTE).income_per_minute(0), (600, 600));
    }

    #[test]
    fn a_game_shorter_than_the_window_is_quoted_at_the_rate_it_is_running_at() {
        // Ten seconds in at ten a second is six hundred a minute, not the hundred gathered so far.
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=11 * SECOND);
        assert_eq!(stats.as_of(11 * SECOND).income_per_minute(0), (600, 600));
    }

    #[test]
    fn the_trend_is_this_minutes_income_against_the_last() {
        // Ten a second of each resource for three minutes, then fifteen.
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=4 * MINUTE,
            Resimulation::Identical,
            |frame| {
                let mut snapshot = snapshot(frame);
                let seconds = frame / SECOND;
                let gathered = seconds * 10 + seconds.saturating_sub(180) * 5;
                snapshot.players[0].gathered_minerals = gathered;
                snapshot.players[0].gathered_gas = gathered;
                snapshot
            },
        );
        // 1,800 a minute against 1,200 the minute before.
        assert_eq!(stats.as_of(4 * MINUTE).income_trend(0), Some(600));
    }

    #[test]
    fn a_steady_income_has_no_trend() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=4 * MINUTE);
        assert_eq!(stats.as_of(4 * MINUTE).income_trend(0), Some(0));
    }

    #[test]
    fn there_is_no_trend_before_two_minutes() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=2 * MINUTE);
        assert_eq!(stats.as_of(2 * MINUTE).income_trend(0), None);
    }

    #[test]
    fn a_game_with_nothing_in_it_yet_has_no_rate() {
        let stats = GameStats::new();
        let stats = stats.as_of(0);
        assert_eq!(stats.income_per_minute(0), (0, 0));
        assert!(stats.latest(0).is_none());
        assert!(stats.series(0, GraphSeries::Income, 64).is_empty());
    }

    #[test]
    fn a_series_is_thinned_to_the_points_asked_for_and_keeps_its_ends() {
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=500 * SECOND,
            Resimulation::Identical,
            |frame| {
                let mut snapshot = snapshot(frame);
                snapshot.completed_units[unit::SCV.0 as usize][0] = frame / SECOND;
                snapshot
            },
        );
        let series = stats
            .as_of(500 * SECOND)
            .series(0, GraphSeries::Workers, 100);
        assert_eq!(series.len(), 100);
        assert_eq!(series.first(), Some(&1.0));
        assert_eq!(series.last(), Some(&500.0));
    }

    #[test]
    fn a_series_shorter_than_the_points_asked_for_is_left_whole() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=7 * SECOND);
        let series = stats.as_of(7 * SECOND).series(0, GraphSeries::Supply, 100);
        assert_eq!(series.len(), 7);
    }

    #[test]
    fn a_seek_back_shows_the_history_as_it_stood_then() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=15 * MINUTE);
        assert_eq!(event_frames(&stats.as_of(15 * MINUTE)), [10 * MINUTE]);
        // A keyframe at five minutes is restored, and the replay fast-forwards to six.
        replay(&mut stats, 5 * MINUTE + 1..=6 * MINUTE);
        let then = stats.as_of(6 * MINUTE);
        assert_eq!(then.rows.last().map(|row| row.frame), Some(6 * MINUTE));
        assert!(event_frames(&then).is_empty());
        assert_eq!(then.income_per_minute(0), (600, 600));
    }

    #[test]
    fn a_seek_forward_onto_history_already_taken_keeps_it_as_it_was() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=15 * MINUTE);
        replay(&mut stats, 5 * MINUTE + 1..=6 * MINUTE);
        // A keyframe at fourteen minutes is restored, past the barracks and eight minutes on from
        // the frame the seek started at.
        replay(&mut stats, 14 * MINUTE + 1..=14 * MINUTE + 30 * SECOND);
        let now = stats.as_of(14 * MINUTE + 30 * SECOND);
        assert_eq!(now.income_per_minute(0), (600, 600));
        assert_eq!(now.income_trend(0), Some(0));
        assert_eq!(event_frames(&now), [10 * MINUTE]);
        assert_eq!(stats.rows.len(), (15 * MINUTE / SECOND) as usize);
    }

    #[test]
    fn going_back_and_playing_on_records_nothing_twice() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=12 * MINUTE);
        replay(&mut stats, 9 * MINUTE + 1..=16 * MINUTE);
        assert_eq!(stats.rows.len(), (16 * MINUTE / SECOND) as usize);
        assert!(
            stats
                .rows
                .windows(2)
                .all(|pair| pair[0].frame < pair[1].frame)
        );
        assert_eq!(event_frames(&stats.as_of(16 * MINUTE)), [10 * MINUTE]);
    }

    #[test]
    fn rates_are_measured_over_the_time_actually_between_samples() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=5 * MINUTE);
        // Nothing is sampled between five and fifteen minutes, but the game went on gathering.
        replay(&mut stats, 15 * MINUTE..=15 * MINUTE + 10 * SECOND);
        let now = stats.as_of(15 * MINUTE + 10 * SECOND);
        assert_eq!(now.income_per_minute(0), (600, 600));
        // A minute ago and two minutes ago are both in the gap, so there are not two minutes to
        // tell apart.
        assert_eq!(now.income_trend(0), None);
        let income = now.series(0, GraphSeries::Income, 1000);
        assert!(income.iter().skip(1).all(|&value| value == 1200.0));
        // The barracks finished somewhere in the gap, which is no time to put it at.
        assert!(event_frames(&now).is_empty());
    }

    #[test]
    fn a_graph_spaces_its_points_by_game_time() {
        let workers = |count: u32| {
            move |frame: u32| {
                let mut snapshot = snapshot(frame);
                snapshot.completed_units[unit::SCV.0 as usize][0] = count;
                snapshot
            }
        };
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=10 * SECOND,
            Resimulation::Identical,
            workers(4),
        );
        play(
            &mut stats,
            100 * SECOND..=101 * SECOND,
            Resimulation::Identical,
            workers(9),
        );
        // Twelve samples, but most of the time they span is the gap after the tenth, which holds
        // the value it was left at.
        let series = stats
            .as_of(101 * SECOND)
            .series(0, GraphSeries::Workers, 12);
        assert_eq!(series.iter().filter(|&&value| value == 4.0).count(), 11);
        assert_eq!(series.last(), Some(&9.0));
    }

    #[test]
    fn a_long_game_keeps_its_start_at_less_detail() {
        let mut stats = GameStats::new();
        let seconds = MAX_SAMPLES as u32 + 100;
        replay(&mut stats, 1..=seconds * SECOND);
        assert!(stats.rows.len() <= MAX_SAMPLES);
        assert_eq!(stats.rows.first().map(|row| row.frame), Some(SECOND));
        assert_eq!(
            stats.rows.last().map(|row| row.frame),
            Some(seconds * SECOND)
        );
        let now = stats.as_of(seconds * SECOND);
        assert_eq!(now.income_per_minute(0), (600, 600));
        let income = now.series(0, GraphSeries::Income, 180);
        assert!(income.iter().skip(1).all(|&value| value == 1200.0));
    }

    #[test]
    fn a_rollback_replaces_what_it_simulates_again() {
        let barracks = |frame: u32| {
            let mut snapshot = snapshot(frame);
            snapshot.completed_units[unit::BARRACKS.0 as usize][0] = 1;
            snapshot
        };
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=10 * SECOND,
            Resimulation::MayDiffer,
            snapshot,
        );
        // First simulated with a barracks finishing at eleven seconds.
        play(
            &mut stats,
            10 * SECOND + 1..=12 * SECOND,
            Resimulation::MayDiffer,
            barracks,
        );
        assert_eq!(event_frames(&stats.as_of(12 * SECOND)), [11 * SECOND]);
        // Late input arrives, and the rollback goes back to a few frames past ten seconds and
        // steps on: the barracks finishes a second later this time.
        play(
            &mut stats,
            10 * SECOND + 3..=13 * SECOND,
            Resimulation::MayDiffer,
            |frame| match frame >= 12 * SECOND {
                true => barracks(frame),
                false => snapshot(frame),
            },
        );
        assert_eq!(event_frames(&stats.as_of(13 * SECOND)), [12 * SECOND]);
        assert_eq!(stats.rows.len(), 13);
        assert!(
            stats
                .rows
                .windows(2)
                .all(|pair| pair[0].frame < pair[1].frame)
        );
    }

    #[test]
    fn a_hatchery_reaching_lair_and_hive_is_reported_each_time() {
        let hatchery = depot(1, unit::HATCHERY, MAIN);
        let to_lair = DepotSite {
            completed: false,
            ..hatchery
        };
        let lair = depot(1, unit::LAIR, MAIN);
        let to_hive = DepotSite {
            completed: false,
            ..lair
        };
        let hive = depot(1, unit::HIVE, MAIN);
        let events = depot_events(&[
            vec![hatchery],
            vec![hatchery],
            vec![to_lair],
            vec![to_lair],
            vec![lair],
            vec![to_hive],
            vec![hive],
            vec![hive],
        ]);
        let completed = TimelineEventKind::BuildingCompleted;
        assert_eq!(
            events,
            [
                (completed, TimelineSubject::Unit(unit::LAIR), 5),
                (completed, TimelineSubject::Unit(unit::HIVE), 7),
            ]
        );
    }

    #[test]
    fn a_depot_in_the_air_is_not_a_base() {
        let landed = depot(1, unit::COMMAND_CENTER, MAIN);
        let flying = |x: i16| DepotSite {
            landed: false,
            x,
            ..landed
        };
        let mut samples = vec![vec![landed]];
        samples.extend((0..20).map(|step| vec![flying(MAIN.0 + step * 50)]));
        // Set down at the natural, lifted again, and set back down where it was.
        let at_natural = depot(1, unit::COMMAND_CENTER, NATURAL);
        samples.push(vec![at_natural]);
        samples.push(vec![DepotSite {
            landed: false,
            ..at_natural
        }]);
        samples.push(vec![at_natural]);
        assert_eq!(
            depot_events(&samples),
            [(
                TimelineEventKind::ExpansionTaken,
                TimelineSubject::Unit(unit::COMMAND_CENTER),
                22
            )]
        );
    }

    #[test]
    fn a_base_rebuilt_where_one_was_destroyed_is_taken_again() {
        let main = depot(1, unit::COMMAND_CENTER, MAIN);
        let natural = depot(2, unit::COMMAND_CENTER, NATURAL);
        let rebuilt = depot(3, unit::COMMAND_CENTER, NATURAL);
        let events = depot_events(&[
            vec![main],
            vec![main, natural],
            vec![main],
            vec![main, rebuilt],
        ]);
        let taken = TimelineEventKind::ExpansionTaken;
        let subject = TimelineSubject::Unit(unit::COMMAND_CENTER);
        assert_eq!(events, [(taken, subject, 2), (taken, subject, 4)]);
    }

    /// `count` events a second for `seconds` seconds, as samples would hand them over.
    fn keep_events_for(stats: &mut GameStats, seconds: u32, count: usize) {
        for second in 1..=seconds {
            let event = TimelineEvent {
                frame: second * SECOND,
                recorded: second * SECOND,
                player: 0,
                kind: TimelineEventKind::BuildingCompleted,
                significance: Significance::Notable,
                subject: TimelineSubject::Unit(unit::BARRACKS),
                position: None,
            };
            stats.keep_events(vec![event; count]);
        }
    }

    #[test]
    fn a_long_games_first_events_are_kept() {
        let mut stats = GameStats::new();
        keep_events_for(&mut stats, 100, 10);
        let frames = event_frames(&stats.as_of(u32::MAX));
        assert_eq!(frames.len(), 1000);
        assert_eq!(frames.first(), Some(&SECOND));
    }

    #[test]
    fn past_the_bound_the_oldest_events_go_first() {
        let mut stats = GameStats::new();
        let per_second = 100;
        let seconds = (MAX_EVENTS as u32).div_ceil(per_second as u32) + 10;
        keep_events_for(&mut stats, seconds, per_second);
        let frames = event_frames(&stats.as_of(u32::MAX));
        assert_eq!(frames.len(), MAX_EVENTS);
        assert_eq!(frames.last(), Some(&(seconds * SECOND)));
        assert!(frames[0] > SECOND);
    }

    #[test]
    fn a_sample_moves_the_samples_stamp_and_only_an_event_moves_the_events_stamp() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=10 * MINUTE - SECOND);
        let before = stats.as_of(u32::MAX);
        let (samples, events) = (before.samples_stamp(), before.events_stamp());
        replay(&mut stats, 10 * MINUTE - SECOND + 1..=10 * MINUTE - 1);
        assert_eq!(stats.as_of(u32::MAX).samples_stamp(), samples);
        replay(&mut stats, 10 * MINUTE..=10 * MINUTE);
        let barracks = stats.as_of(u32::MAX);
        assert_ne!(barracks.samples_stamp(), samples);
        assert_ne!(barracks.events_stamp(), events);
        let (samples, events) = (barracks.samples_stamp(), barracks.events_stamp());
        replay(&mut stats, 10 * MINUTE + 1..=10 * MINUTE + SECOND);
        let after = stats.as_of(u32::MAX);
        assert_ne!(after.samples_stamp(), samples);
        assert_eq!(after.events_stamp(), events);
    }

    #[test]
    fn a_seek_back_moves_the_stamps_without_a_sample() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=15 * MINUTE);
        let now = stats.as_of(15 * MINUTE);
        let then = stats.as_of(5 * MINUTE);
        assert_ne!(then.samples_stamp(), now.samples_stamp());
        assert_ne!(then.events_stamp(), now.events_stamp());
        // Simulating frames already sampled again records nothing, so it changes nothing.
        let (samples, events) = (then.samples_stamp(), then.events_stamp());
        replay(&mut stats, 5 * MINUTE + 1..=6 * MINUTE);
        assert_eq!(stats.as_of(5 * MINUTE).samples_stamp(), samples);
        assert_eq!(stats.as_of(5 * MINUTE).events_stamp(), events);
    }

    #[test]
    fn a_rollback_moves_the_events_stamp_even_where_it_ends_up_as_long() {
        let barracks_at = |second: u32| {
            move |frame: u32| {
                let mut snapshot = snapshot(frame);
                if frame >= second * SECOND {
                    snapshot.completed_units[unit::BARRACKS.0 as usize][0] = 1;
                }
                snapshot
            }
        };
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=12 * SECOND,
            Resimulation::MayDiffer,
            barracks_at(11),
        );
        let events = stats.as_of(u32::MAX).events_stamp();
        play(
            &mut stats,
            10 * SECOND + 3..=12 * SECOND,
            Resimulation::MayDiffer,
            barracks_at(12),
        );
        assert_ne!(stats.as_of(u32::MAX).events_stamp(), events);
    }

    #[test]
    fn a_game_forgotten_never_repeats_a_stamp_from_before() {
        let mut stats = GameStats::new();
        replay(&mut stats, 1..=3 * SECOND);
        let before = stats.as_of(u32::MAX);
        let (samples, events) = (before.samples_stamp(), before.events_stamp());
        stats.clear();
        let cleared = stats.as_of(u32::MAX);
        assert_ne!(cleared.samples_stamp(), samples);
        assert_ne!(cleared.events_stamp(), events);
        replay(&mut stats, 1..=3 * SECOND);
        assert_ne!(stats.as_of(u32::MAX).samples_stamp(), samples);
    }

    #[test]
    fn an_army_is_worth_what_was_spent_on_it() {
        let mut snapshot = snapshot(SECOND);
        snapshot.completed_units[unit::ZERGLING.0 as usize][0] = 2;
        snapshot.completed_units[unit::SCOURGE.0 as usize][0] = 1;
        snapshot.completed_units[unit::LURKER.0 as usize][0] = 1;
        snapshot.existing_units[unit::LURKER.0 as usize][0] = 1;
        snapshot.completed_units[unit::DRONE.0 as usize][0] = 4;
        let samples = player_samples(&snapshot, &FakeUnits::standard());
        // 50 for the pair, 12.5/37.5 for one scourge, 125/125 for the lurker, rounded down once.
        assert_eq!((samples[0].army_minerals, samples[0].army_gas), (187, 162));
        assert_eq!(samples[0].workers, 4);
    }

    /// Player 0's army value in `snapshot`.
    fn army_value(snapshot: &GameSnapshot) -> u32 {
        player_samples(snapshot, &FakeUnits::standard())[0].army_value()
    }

    #[test]
    fn an_army_keeps_its_value_through_a_morph() {
        // The game counts a lurker egg, and a lurker stepping out of it, as existing but not
        // completed, and takes the hydralisk out of its completed count as the morph starts.
        let mut hydralisk = snapshot(SECOND);
        hydralisk.completed_units[unit::HYDRALISK.0 as usize][0] = 1;
        hydralisk.existing_units[unit::HYDRALISK.0 as usize][0] = 1;
        let mut egg = snapshot(SECOND);
        egg.existing_units[unit::LURKER_EGG.0 as usize][0] = 1;
        let mut stepping_out = snapshot(SECOND);
        stepping_out.existing_units[unit::LURKER.0 as usize][0] = 1;
        let mut lurker = snapshot(SECOND);
        lurker.completed_units[unit::LURKER.0 as usize][0] = 1;
        lurker.existing_units[unit::LURKER.0 as usize][0] = 1;
        assert_eq!(army_value(&hydralisk), 100);
        assert_eq!(army_value(&egg), 100);
        assert_eq!(army_value(&stepping_out), 250);
        assert_eq!(army_value(&lurker), 250);
    }

    #[test]
    fn a_unit_still_being_built_is_not_yet_in_the_army() {
        let mut snapshot = snapshot(SECOND);
        snapshot.completed_units[unit::MUTALISK.0 as usize][0] = 1;
        snapshot.existing_units[unit::MUTALISK.0 as usize][0] = 3;
        snapshot.existing_units[unit::COCOON.0 as usize][0] = 1;
        // One mutalisk finished and one in a cocoon. The two still hatching from larva join the army
        // once they are finished, like anything being built.
        assert_eq!(army_value(&snapshot), 400);
    }

    #[test]
    fn a_group_is_named_by_the_most_of_what_is_in_it() {
        let zealots = (unit::ZEALOT, 8, 100);
        let dragoons = (unit::DRAGOON, 4, 175);
        assert_eq!(
            group_composition(&[dragoons, zealots]),
            Some((unit::ZEALOT, Some(unit::DRAGOON)))
        );
    }

    #[test]
    fn two_kinds_tied_on_units_are_separated_by_what_they_cost() {
        let marines = (unit::MARINE, 4, 50);
        let tanks = (unit::SIEGE_TANK_TANK, 4, 250);
        assert_eq!(
            group_composition(&[marines, tanks]),
            Some((unit::SIEGE_TANK_TANK, Some(unit::MARINE)))
        );
    }

    #[test]
    fn a_kind_too_small_a_share_of_a_group_is_a_stray_rather_than_a_mix() {
        // Two of twelve is under the share a second kind has to hold; three of twelve is exactly
        // it.
        let strays = [(unit::ZEALOT, 10, 100), (unit::HIGH_TEMPLAR, 2, 200)];
        assert_eq!(group_composition(&strays), Some((unit::ZEALOT, None)));
        let mix = [(unit::ZEALOT, 9, 100), (unit::HIGH_TEMPLAR, 3, 200)];
        assert_eq!(
            group_composition(&mix),
            Some((unit::ZEALOT, Some(unit::HIGH_TEMPLAR)))
        );
    }

    #[test]
    fn a_group_of_one_kind_has_nothing_to_pair_it_with() {
        assert_eq!(
            group_composition(&[(unit::MUTALISK, 12, 150)]),
            Some((unit::MUTALISK, None))
        );
        assert_eq!(group_composition(&[]), None);
    }

    /// A map of one tile that player 0 can see when `seen` and nobody can otherwise.
    fn with_vision(mut snapshot: GameSnapshot, seen: bool) -> GameSnapshot {
        let hidden_from = if seen { 0xfe } else { 0xff };
        snapshot.vision = Some(MapVision::read(&[hidden_from]));
        snapshot
    }

    #[test]
    fn playing_on_keeps_the_current_state_fresh_enough() {
        let mut stats = GameStats::new();
        play(
            &mut stats,
            0..=10 * SECOND,
            Resimulation::Identical,
            snapshot,
        );
        for frame in 10 * SECOND..11 * SECOND {
            assert!(!stats.current_state_stale(frame), "{frame}");
        }
    }

    /// A seek that lands and stays paused has nothing stepped to read the game again, so what is
    /// read as the game stands now must be read again for the frame it landed on.
    #[test]
    fn a_seek_leaves_the_current_state_to_be_read_again() {
        let units = FakeUnits::standard();
        let mut stats = GameStats::new();
        play(
            &mut stats,
            0..=10 * SECOND,
            Resimulation::Identical,
            |frame| with_vision(snapshot(frame), true),
        );
        assert_eq!(stats.as_of(10 * SECOND).vision().unwrap().seen_by(1), 1.0);
        // Back to a keyframe and on a little way, then paused.
        let landed = 2 * SECOND + 5;
        assert!(stats.current_state_stale(landed));
        stats.refresh_current_state(with_vision(snapshot(landed), false), &units);
        assert!(!stats.current_state_stale(landed));
        assert_eq!(stats.as_of(landed).vision().unwrap().seen_by(1), 0.0);
        // A forward jump past the sampling cadence is as stale.
        assert!(stats.current_state_stale(landed + SECOND));
    }

    /// A game with one marine alive until `dies_at`, and a probe that never dies.
    fn marine_dying_at(dies_at: u32) -> impl Fn(u32) -> GameSnapshot {
        move |frame| {
            let mut snapshot = snapshot(frame);
            let unit = |unique_id, unit_id| RosterUnit {
                unique_id,
                player: 0,
                unit_id,
                completed: true,
                x: 100,
                y: 200,
            };
            if frame < dies_at {
                snapshot.roster.push(unit(4, unit::MARINE));
            }
            snapshot.roster.push(unit(9, unit::PROBE));
            snapshot
        }
    }

    fn death_frames(stats: &GameStats) -> Vec<(u32, UnitId)> {
        stats
            .deaths
            .iter()
            .map(|death| (death.frame, death.unit_id))
            .collect()
    }

    #[test]
    fn a_death_is_found_once_by_the_sample_that_sees_it_gone() {
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=20 * SECOND,
            Resimulation::Identical,
            marine_dying_at(10 * SECOND + 5),
        );
        assert_eq!(death_frames(&stats), [(11 * SECOND, unit::MARINE)]);
        // A replay seeking back over it and playing on finds nothing new.
        play(
            &mut stats,
            5 * SECOND..=20 * SECOND,
            Resimulation::Identical,
            marine_dying_at(10 * SECOND + 5),
        );
        assert_eq!(death_frames(&stats), [(11 * SECOND, unit::MARINE)]);
    }

    /// A rollback that simulates a death again at another moment moves it rather than adding one.
    #[test]
    fn a_rollback_moves_a_death_it_simulates_again() {
        let mut stats = GameStats::new();
        play(
            &mut stats,
            1..=12 * SECOND,
            Resimulation::MayDiffer,
            marine_dying_at(10 * SECOND + 5),
        );
        assert_eq!(death_frames(&stats), [(11 * SECOND, unit::MARINE)]);
        // Inputs arrive that keep the marine alive a second longer.
        play(
            &mut stats,
            10 * SECOND + 10..=14 * SECOND,
            Resimulation::MayDiffer,
            marine_dying_at(11 * SECOND + 5),
        );
        assert_eq!(death_frames(&stats), [(12 * SECOND, unit::MARINE)]);
    }

    /// A game where player 0's thirty hydralisks all die at `dies_at`, to player 1's marine
    /// standing among them.
    fn hydralisks_dying_at(dies_at: u32) -> impl Fn(u32) -> GameSnapshot {
        move |frame| {
            let mut snapshot = snapshot(frame);
            snapshot.roster.push(RosterUnit {
                unique_id: 1,
                player: 1,
                unit_id: unit::MARINE,
                completed: true,
                x: 520,
                y: 500,
            });
            let alive = frame < dies_at;
            if alive {
                snapshot.roster.extend((0..30).map(|index| RosterUnit {
                    unique_id: 100 + index,
                    player: 0,
                    unit_id: unit::HYDRALISK,
                    completed: true,
                    x: 500,
                    y: 500,
                }));
                snapshot.completed_units[unit::HYDRALISK.0 as usize][0] = 30;
            } else {
                snapshot.players[1].kills_score = 3000;
            }
            snapshot
        }
    }

    fn fights(stats: &GameStats) -> Vec<(u32, TimelineEventKind)> {
        stats
            .events
            .iter()
            .filter(|event| !event.kind.names_its_subject())
            .map(|event| (event.frame, event.kind))
            .collect()
    }

    #[test]
    fn a_fight_is_put_at_its_start_once_and_seeking_back_finds_it_again_only_once() {
        let game = hydralisks_dying_at(10 * SECOND + 5);
        let mut stats = GameStats::new();
        play(&mut stats, 1..=30 * SECOND, Resimulation::Identical, &game);
        let won = TimelineEventKind::FightWon { margin: 3000 };
        assert_eq!(fights(&stats), [(11 * SECOND, won)]);
        play(
            &mut stats,
            5 * SECOND..=30 * SECOND,
            Resimulation::Identical,
            &game,
        );
        assert_eq!(fights(&stats), [(11 * SECOND, won)]);
    }

    /// A rollback that takes the sample that judged a fight again judges it again, rather than
    /// keeping the first verdict alongside the second.
    #[test]
    fn a_rollback_over_the_sample_that_judged_a_fight_judges_it_once() {
        let game = hydralisks_dying_at(10 * SECOND + 5);
        let mut first_pass = GameStats::new();
        play(
            &mut first_pass,
            1..=30 * SECOND,
            Resimulation::MayDiffer,
            &game,
        );
        let judged = first_pass
            .events
            .last()
            .map(|event| event.recorded)
            .unwrap();
        assert!(judged > 11 * SECOND);
        // A rollback reaches back a few frames, from just past the sample that judged the fight.
        let mut stats = GameStats::new();
        play(&mut stats, 1..=judged + 5, Resimulation::MayDiffer, &game);
        play(
            &mut stats,
            judged - SECOND / 2..=30 * SECOND,
            Resimulation::MayDiffer,
            &game,
        );
        assert_eq!(
            fights(&stats),
            [(11 * SECOND, TimelineEventKind::FightWon { margin: 3000 })]
        );
    }
}
