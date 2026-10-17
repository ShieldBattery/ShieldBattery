//! Fights, worker raids and bases destroyed: the moments a game turns on, found in where and when
//! units died.
//!
//! Deaths near each other in place and time are one engagement. An engagement is judged once it is
//! over, so what it reports is final: whether it was big enough to mention, who came out of it
//! ahead, and whose workers it cost. It is put on the timeline at the moment it began, which is
//! where a watcher jumping to it wants to land.
//!
//! The thresholds were tuned against real games: most units die one or two at a time to
//! skirmishing, and what a watcher wants pointed out is the fight that costs a large share of the
//! armies in it, or a large amount whatever the armies; and a run on a mineral line, as against a
//! worker or two lost along the way.

use bw_dat::{UnitId, unit};
use overlay_ui::observer::{FightDegree, Significance, TimelineEventKind};

use super::deaths::Death;
use super::snapshot::RosterUnit;
use super::unit_value::{UnitCatalog, counted_from_creation, counts_as_army, invested_cost};
use super::{MAX_PLAYERS, SAMPLE_INTERVAL_FRAMES, TimelineEvent, TimelineSubject};

/// How long an engagement goes on without a death before it is over, in frames.
const GAP_FRAMES: u32 = 8 * SAMPLE_INTERVAL_FRAMES;

/// How far from an engagement's middle a death can be and still be part of it, in map pixels:
/// twenty tiles, about a screen.
const REACH: f32 = 640.0;

/// A fight worth marking on the seek bar: one that cost at least this much and this share of the
/// armies in it, or this much whatever the armies were.
const KEY_FIGHT_VALUE: u32 = 2000;
const KEY_FIGHT_SHARE: f32 = 0.3;
const DECISIVE_FIGHT_VALUE: u32 = 5000;

/// A fight worth listing: as above, at a smaller size.
const NOTABLE_FIGHT_VALUE: u32 = 700;
const NOTABLE_FIGHT_SHARE: f32 = 0.15;
const LARGE_FIGHT_VALUE: u32 = 2000;

/// A run on a player's workers: this many lost in one engagement, or a smaller number that is still
/// this share of all they had.
const RAID_WORKERS: u16 = 6;
const SMALL_RAID_WORKERS: u16 = 3;
const SMALL_RAID_SHARE: f32 = 0.2;

/// How a fight is judged: by what each side has left of what it brought to it, rather than by what
/// it lost outright. An army of a thousand lost whole is a fight lost, however much the army of five
/// thousand it fought lost in taking it. The measure is how many times over the winner's share left
/// is the loser's, which is how far the fight moved the balance between the two armies: these are
/// where it is won narrowly, outright and decisively, and anything less is an even fight.
const CLOSE_FIGHT_SWING: f32 = 1.12;
const CLEAR_FIGHT_SWING: f32 = 1.3;
const DECISIVE_FIGHT_SWING: f32 = 2.0;

/// Units whose death is no loss to report: the larvae and eggs a hatchery keeps, and the
/// ammunition, mines and missiles that are spent by being used.
const SPENT_UNITS: [UnitId; 7] = [
    unit::LARVA,
    unit::EGG,
    unit::SCARAB,
    unit::INTERCEPTOR,
    unit::SPIDER_MINE,
    unit::BROODLING,
    unit::NUCLEAR_MISSILE,
];

/// The buildings that fight, whose losses count towards a fight as units do.
const STATIC_DEFENSE: [UnitId; 6] = [
    unit::BUNKER,
    unit::MISSILE_TURRET,
    unit::PHOTON_CANNON,
    unit::CREEP_COLONY,
    unit::SUNKEN_COLONY,
    unit::SPORE_COLONY,
];

/// Each player's state at one sample, which engagements are measured against.
#[derive(Copy, Clone, Default)]
pub struct Standing {
    /// What their army is worth.
    pub army: [u32; MAX_PLAYERS],
    pub workers: [u32; MAX_PLAYERS],
    /// What everything they have killed was worth, by the game's destroy scores: units in
    /// `kills`, buildings in `razings`.
    pub kills: [u32; MAX_PLAYERS],
    pub razings: [u32; MAX_PLAYERS],
    /// Each player's allies, as a mask of player ids, counting only alliances both ways.
    pub allies: [u8; MAX_PLAYERS],
    /// Whether each player has left the game or been beaten.
    pub out: [bool; MAX_PLAYERS],
}

/// The sample deaths are being placed at, and the one before it.
pub struct Moment<'a> {
    pub before: &'a Standing,
    pub now: &'a Standing,
    /// Every unit alive at the sample before and at this one, which say who was where.
    pub rosters: [&'a [RosterUnit]; 2],
    pub frame: u32,
    /// Whether the game will not be sampled again, which closes every engagement.
    pub last_sample: bool,
}

impl Standing {
    /// What everything a player has destroyed was worth, units and buildings together: a fight
    /// counts the static defense in it.
    fn destroyed(&self, player: usize) -> u32 {
        self.kills[player].saturating_add(self.razings[player])
    }
}

/// The engagements still going on, carried from one sample to the next.
#[derive(Clone, Default)]
pub struct Engagements {
    open: Vec<Engagement>,
    /// Who was out of the game as of the last sample, so a player leaving is noticed.
    out: [bool; MAX_PLAYERS],
}

#[derive(Clone)]
struct Engagement {
    first: u32,
    last: u32,
    /// The middle of the deaths so far, weighted by what each was worth.
    x: f32,
    y: f32,
    weight: f32,
    /// What each player lost in units and static defense, in resources.
    lost: [u32; MAX_PLAYERS],
    /// What of `lost` no army value counts: static defense, and the overlords that are a zerg's
    /// supply.
    lost_outside_army: [u32; MAX_PLAYERS],
    /// What each player brought to the engagement: the most their army has been worth, counting
    /// what it had lost here already, at any sample they took part in. Reinforcements arriving
    /// partway through are brought to it too.
    brought: [u32; MAX_PLAYERS],
    /// What each kind of unit lost cost each player, for naming what the fight was fought with.
    lost_kinds: Vec<(u8, UnitId, u32)>,
    workers: [u16; MAX_PLAYERS],
    /// The kind of worker each player lost, and how many workers they had before the first.
    worker_kind: [Option<UnitId>; MAX_PLAYERS],
    workers_before: [u32; MAX_PLAYERS],
    /// The players who lost anything, and what their armies were worth as they joined.
    involved: u8,
    pool: u32,
    /// What each player destroyed here, by the game's destroy scores. Those say what a player
    /// killed but not where, so a player is credited with what they destroyed between two samples
    /// only where the engagement had deaths between them and the player had something that fights
    /// within reach of it.
    kills: [u32; MAX_PLAYERS],
}

/// Places `deaths`, which happened between the two samples of `moment`, into the engagements
/// carried from `previous`, and puts on `events` every engagement that ended and every base
/// destroyed. Without `previous` this only starts afresh, since deaths with no sample just before
/// them cannot be placed in time.
pub fn advance(
    previous: Option<&Engagements>,
    deaths: &[Death],
    moment: &Moment<'_>,
    catalog: &impl UnitCatalog,
    events: &mut Vec<TimelineEvent>,
) -> Engagements {
    let Moment {
        before,
        now,
        rosters,
        frame,
        last_sample,
    } = *moment;
    let Some(previous) = previous else {
        return Engagements {
            open: Vec::new(),
            out: now.out,
        };
    };
    let mut open = previous.open.clone();
    // What the engagements already going on had lost before this sample's deaths, which is what an
    // army's value at the sample before still counted.
    let units_lost_before: Vec<[u32; MAX_PLAYERS]> = open
        .iter()
        .map(|engagement| {
            std::array::from_fn(|player| {
                engagement.lost[player].saturating_sub(engagement.lost_outside_army[player])
            })
        })
        .collect();
    // A unit in the middle of a morph is never complete, and killing one is a loss all the same.
    let counted = |death: &&Death| death.completed || counted_from_creation(death.unit_id);
    for death in deaths.iter().filter(counted) {
        let victim = death.player as usize;
        if victim >= MAX_PLAYERS {
            continue;
        }
        if catalog.is_town_hall(death.unit_id) {
            let near = present_near(rosters, catalog, f32::from(death.x), f32::from(death.y));
            events.push(base_destroyed(death, before, now, near, frame));
            continue;
        }
        let worker = catalog.is_worker(death.unit_id);
        let value = invested_cost(catalog, death.unit_id).total() / 2;
        let counts = worker
            || (!SPENT_UNITS.contains(&death.unit_id)
                && (!catalog.is_building(death.unit_id)
                    || STATIC_DEFENSE.contains(&death.unit_id))
                && value > 0);
        if !counts {
            continue;
        }
        let engagement = match nearest_open(&mut open, death) {
            Some(engagement) => engagement,
            None => {
                open.push(Engagement::new(death.frame));
                open.last_mut().expect("just pushed")
            }
        };
        // Static defense and the overlords no army value counts, so what a side brought has to
        // count them as they are lost, or losing them would read as a share of something else.
        let outside_army = !counts_as_army(catalog, death.unit_id);
        engagement.add(death, worker, outside_army, value, before);
    }
    // Every death is stamped with the sample that found it, so an engagement whose last death is
    // this sample's had deaths in it since the sample before.
    for (index, engagement) in open.iter_mut().enumerate() {
        if engagement.last != frame {
            continue;
        }
        let near = present_near(rosters, catalog, engagement.x, engagement.y);
        let lost_before = units_lost_before
            .get(index)
            .copied()
            .unwrap_or([0; MAX_PLAYERS]);
        for (player, lost_before) in lost_before.into_iter().enumerate() {
            let destroyed = now
                .destroyed(player)
                .saturating_sub(before.destroyed(player));
            if near & 1 << player != 0 {
                engagement.kills[player] = engagement.kills[player].saturating_add(destroyed);
            }
            if engagement.lost[player] > 0 || engagement.kills[player] > 0 {
                let brought = before.army[player].saturating_add(lost_before);
                engagement.brought[player] = engagement.brought[player].max(brought);
            }
        }
    }
    let someone_left = (0..MAX_PLAYERS).any(|player| now.out[player] && !previous.out[player]);
    let mut still_open = Vec::with_capacity(open.len());
    for engagement in open {
        if last_sample || someone_left || frame.saturating_sub(engagement.last) > GAP_FRAMES {
            engagement.report(now, frame, events);
        } else {
            still_open.push(engagement);
        }
    }
    Engagements {
        open: still_open,
        out: now.out,
    }
}

/// Whether a unit of kind `id` can take part in a fight: anything but a building that does not
/// fight, and the larvae and eggs a hatchery keeps.
fn takes_part(catalog: &impl UnitCatalog, id: UnitId) -> bool {
    (!catalog.is_building(id) || STATIC_DEFENSE.contains(&id))
        && !matches!(id, unit::LARVA | unit::EGG)
}

/// The players with something in `rosters` that takes part in a fight within reach of `(x, y)`,
/// as a mask of player ids.
fn present_near(rosters: [&[RosterUnit]; 2], catalog: &impl UnitCatalog, x: f32, y: f32) -> u8 {
    let mut present = 0u8;
    for unit in rosters.into_iter().flatten() {
        let bit = 1u8.checked_shl(u32::from(unit.player)).unwrap_or(0);
        if present & bit != 0 || !takes_part(catalog, unit.unit_id) {
            continue;
        }
        let dx = f32::from(unit.x) - x;
        let dy = f32::from(unit.y) - y;
        if dx * dx + dy * dy <= REACH * REACH {
            present |= bit;
        }
    }
    present
}

/// The engagement still going on that `death` is part of, if any: the nearest whose last death
/// was recent enough and whose middle is close enough.
fn nearest_open<'a>(open: &'a mut [Engagement], death: &Death) -> Option<&'a mut Engagement> {
    let at = (f32::from(death.x), f32::from(death.y));
    open.iter_mut()
        .filter(|engagement| death.frame.saturating_sub(engagement.last) <= GAP_FRAMES)
        .map(|engagement| {
            let dx = engagement.x - at.0;
            let dy = engagement.y - at.1;
            (dx * dx + dy * dy, engagement)
        })
        .filter(|(distance, _)| *distance <= REACH * REACH)
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, engagement)| engagement)
}

impl Engagement {
    fn new(frame: u32) -> Engagement {
        Engagement {
            first: frame,
            last: frame,
            x: 0.0,
            y: 0.0,
            weight: 0.0,
            lost: [0; MAX_PLAYERS],
            lost_outside_army: [0; MAX_PLAYERS],
            brought: [0; MAX_PLAYERS],
            lost_kinds: Vec::new(),
            workers: [0; MAX_PLAYERS],
            worker_kind: [None; MAX_PLAYERS],
            workers_before: [0; MAX_PLAYERS],
            involved: 0,
            pool: 0,
            kills: [0; MAX_PLAYERS],
        }
    }

    fn add(
        &mut self,
        death: &Death,
        worker: bool,
        outside_army: bool,
        value: u32,
        before: &Standing,
    ) {
        let player = death.player as usize;
        self.last = death.frame;
        // A worker's worth is counted where it died, so a fight over a mineral line is placed there,
        // but it is not part of what the fight cost.
        let weight = value.max(1) as f32;
        self.x = (self.x * self.weight + f32::from(death.x) * weight) / (self.weight + weight);
        self.y = (self.y * self.weight + f32::from(death.y) * weight) / (self.weight + weight);
        self.weight += weight;
        if self.involved & 1 << player == 0 {
            self.involved |= 1 << player;
            self.pool = self.pool.saturating_add(before.army[player]);
        }
        if worker {
            if self.workers[player] == 0 {
                self.workers_before[player] = before.workers[player];
            }
            self.workers[player] = self.workers[player].saturating_add(1);
            self.worker_kind[player] = Some(death.unit_id);
            return;
        }
        self.lost[player] = self.lost[player].saturating_add(value);
        if outside_army {
            self.lost_outside_army[player] = self.lost_outside_army[player].saturating_add(value);
        }
        match self
            .lost_kinds
            .iter_mut()
            .find(|(owner, kind, _)| *owner == death.player && *kind == death.unit_id)
        {
            Some((_, _, total)) => *total = total.saturating_add(value),
            None => self.lost_kinds.push((death.player, death.unit_id, value)),
        }
    }

    /// Puts what this engagement came to on `events`, if it came to anything worth telling.
    fn report(&self, now: &Standing, frame: u32, events: &mut Vec<TimelineEvent>) {
        let position = Some((self.x.round() as i16, self.y.round() as i16));
        let kills = |player: usize| self.kills[player];
        if let Some(fight) = self.fight(now, kills) {
            events.push(TimelineEvent {
                frame: self.first,
                recorded: frame,
                position,
                ..fight
            });
        }
        for victim in 0..MAX_PLAYERS {
            let count = self.workers[victim];
            let share = count as f32 / self.workers_before[victim].max(1) as f32;
            let raid =
                count >= RAID_WORKERS || (count >= SMALL_RAID_WORKERS && share >= SMALL_RAID_SHARE);
            let Some(worker) = self.worker_kind[victim].filter(|_| raid) else {
                continue;
            };
            let attacker = top_killer(
                (0..MAX_PLAYERS).filter(|&other| !same_side(now, victim, other)),
                kills,
            );
            let (player, kind) = match attacker {
                Some(attacker) => (attacker, TimelineEventKind::WorkersKilled { count }),
                None => (victim, TimelineEventKind::WorkersLost { count }),
            };
            events.push(TimelineEvent {
                frame: self.first,
                recorded: frame,
                player: player as u8,
                kind,
                significance: Significance::Key,
                subject: TimelineSubject::Unit(worker),
                position,
            });
        }
    }

    /// What the fighting in this engagement came to, if it was big enough to tell: who came out
    /// ahead and how far, named after what the losers lost most of. The frame, record and place are
    /// the caller's to fill in.
    fn fight(&self, now: &Standing, kills: impl Fn(usize) -> u32) -> Option<TimelineEvent> {
        let value: u32 = self.lost.iter().sum();
        let share = match self.pool {
            0 => 1.0,
            pool => value as f32 / pool as f32,
        };
        let significance = if (value >= KEY_FIGHT_VALUE && share >= KEY_FIGHT_SHARE)
            || value >= DECISIVE_FIGHT_VALUE
        {
            Significance::Key
        } else if (value >= NOTABLE_FIGHT_VALUE && share >= NOTABLE_FIGHT_SHARE)
            || value >= LARGE_FIGHT_VALUE
        {
            Significance::Notable
        } else {
            return None;
        };
        // Sides rather than players, so a team that traded well together won together.
        let mut sides: Vec<Side> = Vec::new();
        for player in (0..MAX_PLAYERS).filter(|&player| self.lost[player] > 0 || kills(player) > 0)
        {
            let id = side_of(now, player);
            let index = match sides.iter().position(|side| side.id == id) {
                Some(index) => index,
                None => {
                    sides.push(Side {
                        id,
                        lost: 0,
                        brought: 0,
                    });
                    sides.len() - 1
                }
            };
            let side = &mut sides[index];
            side.lost = side.lost.saturating_add(self.lost[player]);
            side.brought = side
                .brought
                .saturating_add(self.brought[player])
                .saturating_add(self.lost_outside_army[player]);
        }
        // Losses that nobody near them can be credited with are no fight to tell, nor to judge.
        if sides.len() < 2 {
            return None;
        }
        sides.sort_by(|a, b| a.share().total_cmp(&b.share()));
        let winner = sides[0];
        let loser_left = sides[1..]
            .iter()
            .map(|side| 1.0 - side.share())
            .fold(1.0f32, f32::min);
        let winner_left = 1.0 - winner.share();
        // Two sides with nothing left traded everything for everything, and a side with nothing
        // left against one that has something has been beaten as decisively as a fight can go.
        let swing = if winner_left == 0.0 {
            1.0
        } else if loser_left == 0.0 {
            f32::INFINITY
        } else {
            winner_left / loser_left
        };
        let killed = |side: usize| -> u32 {
            sides
                .iter()
                .filter(|other| other.id != side)
                .map(|other| other.lost)
                .sum()
        };
        let degree = if swing >= DECISIVE_FIGHT_SWING {
            Some(FightDegree::Decisive)
        } else if swing >= CLEAR_FIGHT_SWING {
            Some(FightDegree::Clear)
        } else if swing >= CLOSE_FIGHT_SWING {
            Some(FightDegree::Close)
        } else {
            None
        };
        let (player, kind, winning_side) = match degree {
            Some(degree) => {
                let player = top_killer(
                    (0..MAX_PLAYERS).filter(|&player| side_of(now, player) == winner.id),
                    &kills,
                )
                .unwrap_or(winner.id);
                let won = TimelineEventKind::FightWon {
                    degree,
                    lost: winner.lost,
                    killed: killed(winner.id),
                };
                (player, won, Some(winner.id))
            }
            None => {
                let player = top_killer(0..MAX_PLAYERS, &kills)
                    .or_else(|| (0..MAX_PLAYERS).max_by_key(|&player| self.lost[player]))
                    .unwrap_or(0);
                let side = side_of(now, player);
                let lost = sides
                    .iter()
                    .find(|other| other.id == side)
                    .map_or(0, |side| side.lost);
                let even = TimelineEventKind::FightEven {
                    lost,
                    killed: killed(side),
                };
                (player, even, None)
            }
        };
        // Named after the costliest kind the losing sides lost, or anyone lost in an even fight.
        let subject = self
            .lost_kinds
            .iter()
            .filter(|(owner, _, _)| {
                winning_side.is_none_or(|winner| side_of(now, *owner as usize) != winner)
            })
            .max_by_key(|(_, _, total)| *total)
            .map(|&(_, kind, _)| kind)?;
        Some(TimelineEvent {
            frame: 0,
            recorded: 0,
            player: player as u8,
            kind,
            significance,
            subject: TimelineSubject::Unit(subject),
            position: None,
        })
    }
}

/// A resource depot that died: destroyed by whoever razed the most against its owner that sample
/// of the players `near` it (a mask of player ids), or lost by its owner where nobody can be told.
fn base_destroyed(
    death: &Death,
    before: &Standing,
    now: &Standing,
    near: u8,
    frame: u32,
) -> TimelineEvent {
    let victim = death.player as usize;
    let attacker = top_killer(
        (0..MAX_PLAYERS).filter(|&other| !same_side(now, victim, other) && near & 1 << other != 0),
        |player| now.razings[player].saturating_sub(before.razings[player]),
    );
    let (player, kind) = match attacker {
        Some(attacker) => (attacker, TimelineEventKind::BaseDestroyed),
        None => (victim, TimelineEventKind::BaseLost),
    };
    TimelineEvent {
        frame: death.frame,
        recorded: frame,
        player: player as u8,
        kind,
        significance: Significance::Key,
        subject: TimelineSubject::Unit(death.unit_id),
        position: Some((death.x, death.y)),
    }
}

/// One side of a fight: what it lost, and what it brought to lose.
#[derive(Copy, Clone)]
struct Side {
    /// The lowest player id on it.
    id: usize,
    lost: u32,
    brought: u32,
}

impl Side {
    /// How much of what it brought it lost: all of it for a side that brought nothing an army
    /// value counts and lost something all the same.
    fn share(&self) -> f32 {
        match self.brought {
            0 if self.lost > 0 => 1.0,
            0 => 0.0,
            brought => (self.lost as f32 / brought as f32).min(1.0),
        }
    }
}

/// The side `player` is on, named by the lowest player id on it: a player and everyone allied
/// with them both ways.
fn side_of(standing: &Standing, player: usize) -> usize {
    (0..player)
        .find(|&other| same_side(standing, player, other))
        .unwrap_or(player)
}

fn same_side(standing: &Standing, player: usize, other: usize) -> bool {
    player == other || standing.allies[player] & 1 << other != 0
}

/// Whichever of `players` killed the most, if any of them killed anything.
fn top_killer(players: impl Iterator<Item = usize>, kills: impl Fn(usize) -> u32) -> Option<usize> {
    players
        .map(|player| (kills(player), player))
        .filter(|&(killed, _)| killed > 0)
        .max_by_key(|&(killed, player)| (killed, std::cmp::Reverse(player)))
        .map(|(_, player)| player)
}

#[cfg(test)]
mod tests {
    use super::super::unit_value::tests::FakeUnits;
    use super::*;

    const SECOND: u32 = SAMPLE_INTERVAL_FRAMES;

    fn death(frame: u32, player: u8, unit_id: UnitId, x: i16) -> Death {
        Death {
            frame,
            player,
            unit_id,
            completed: true,
            x,
            y: 1000,
        }
    }

    /// Two players, each with an army worth `army` and `workers` workers, and the killing each has
    /// done so far.
    fn standing(army: u32, workers: u32, kills: [u32; 2]) -> Standing {
        let mut standing = Standing::default();
        standing.army[..2].copy_from_slice(&[army, army]);
        standing.workers[..2].copy_from_slice(&[workers, workers]);
        standing.kills[..2].copy_from_slice(&kills);
        standing
    }

    /// A marine for each of `players`, standing at `x` on the line the test deaths are on.
    fn roster(players: &[u8], x: i16) -> Vec<RosterUnit> {
        players
            .iter()
            .enumerate()
            .map(|(index, &player)| RosterUnit {
                unique_id: index as u32,
                player,
                unit_id: unit::MARINE,
                completed: true,
                x,
                y: 1000,
            })
            .collect()
    }

    /// Feeds `samples` of deaths in turn, one sample a second from the first death, then quiet
    /// seconds until everything open has closed, returning what was reported. The first four
    /// players all have units where the deaths are.
    fn run(samples: &[Vec<Death>], before: Standing, now: Standing) -> Vec<TimelineEvent> {
        run_among(samples, before, now, &roster(&[0, 1, 2, 3], 500))
    }

    /// As [`run`], with `alive` the units every sample finds alive.
    fn run_among(
        samples: &[Vec<Death>],
        before: Standing,
        now: Standing,
        alive: &[RosterUnit],
    ) -> Vec<TimelineEvent> {
        let units = FakeUnits::standard();
        let mut events = Vec::new();
        let mut state = Engagements::default();
        let first = samples
            .iter()
            .flatten()
            .map(|death| death.frame)
            .min()
            .unwrap_or(0);
        let quiet = (GAP_FRAMES / SECOND + 2) as usize;
        let empty = Vec::new();
        for (index, deaths) in samples
            .iter()
            .chain(std::iter::repeat_n(&empty, quiet))
            .enumerate()
        {
            let moment = Moment {
                before: &before,
                now: &now,
                rosters: [alive, alive],
                frame: first + index as u32 * SECOND,
                last_sample: false,
            };
            state = advance(Some(&state), deaths, &moment, &units, &mut events);
        }
        events
    }

    #[test]
    fn a_costly_fight_is_reported_once_it_is_over_at_the_moment_it_began() {
        // Player 0 loses twenty hydralisks (2,000) and player 1 ten marines (500) out of armies of
        // 3,000 each: a big fight player 1 won by 1,500.
        let samples = vec![
            (0..10)
                .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
                .chain((0..5).map(|_| death(10 * SECOND, 1, unit::MARINE, 520)))
                .collect::<Vec<_>>(),
            (0..10)
                .map(|_| death(11 * SECOND, 0, unit::HYDRALISK, 480))
                .chain((0..5).map(|_| death(11 * SECOND, 1, unit::MARINE, 500)))
                .collect(),
        ];
        let events = run(
            &samples,
            standing(3000, 20, [0, 0]),
            standing(3000, 20, [500, 2000]),
        );
        assert_eq!(events.len(), 1);
        let fight = events[0];
        assert_eq!(
            fight.kind,
            TimelineEventKind::FightWon {
                degree: FightDegree::Clear,
                lost: 500,
                killed: 2000
            }
        );
        assert_eq!(fight.significance, Significance::Key);
        assert_eq!(fight.player, 1);
        assert_eq!(fight.frame, 10 * SECOND);
        assert!(fight.recorded > 11 * SECOND + GAP_FRAMES);
        // Named after what the loser lost.
        assert_eq!(fight.subject, TimelineSubject::Unit(unit::HYDRALISK));
        assert!(
            fight
                .position
                .is_some_and(|(x, _)| (480..=520).contains(&x))
        );
    }

    /// An army thrown away whole loses the fight, however much more it cost the bigger army that
    /// beat it.
    #[test]
    fn losing_a_whole_army_loses_the_fight() {
        let mut before = Standing::default();
        before.army[..2].copy_from_slice(&[1000, 5000]);
        let mut now = before;
        now.kills[..2].copy_from_slice(&[1500, 1000]);
        let samples = vec![
            (0..10)
                .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
                .chain((0..15).map(|_| death(10 * SECOND, 1, unit::HYDRALISK, 520)))
                .collect::<Vec<_>>(),
        ];
        let events = run(&samples, before, now);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::FightWon {
                degree: FightDegree::Decisive,
                lost: 1500,
                killed: 1000,
            }
        );
        assert_eq!(events[0].player, 1);
    }

    /// Two armies that wipe each other out traded evenly, whoever has the lower player id.
    #[test]
    fn armies_lost_whole_on_both_sides_are_an_even_fight() {
        let mut before = Standing::default();
        before.army[..2].copy_from_slice(&[1000, 1000]);
        let mut now = before;
        now.kills[..2].copy_from_slice(&[1000, 1000]);
        let samples = vec![
            (0..10)
                .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
                .chain((0..10).map(|_| death(10 * SECOND, 1, unit::HYDRALISK, 520)))
                .collect::<Vec<_>>(),
        ];
        let events = run(&samples, before, now);
        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].kind,
            TimelineEventKind::FightEven { .. }
        ));
    }

    /// Overlords are no part of an army's value, so losing them is counted as brought as well as
    /// lost rather than read as the army being gone.
    #[test]
    fn overlords_lost_are_no_army_wiped_out() {
        let mut before = Standing::default();
        before.army[..2].copy_from_slice(&[1000, 1000]);
        let mut now = before;
        now.kills[..2].copy_from_slice(&[500, 800]);
        let samples = vec![
            (0..8)
                .map(|_| death(10 * SECOND, 0, unit::OVERLORD, 500))
                .chain((0..5).map(|_| death(10 * SECOND, 1, unit::HYDRALISK, 520)))
                .collect::<Vec<_>>(),
        ];
        let events = run(&samples, before, now);
        assert_eq!(events.len(), 1);
        // Player 0 lost 800 of 1,800 and player 1 lost 500 of 1,000.
        assert!(matches!(
            events[0].kind,
            TimelineEventKind::FightEven { .. }
        ));
    }

    #[test]
    fn a_skirmish_is_not_worth_telling() {
        let samples = vec![vec![
            death(10 * SECOND, 0, unit::MARINE, 500),
            death(10 * SECOND, 1, unit::MARINE, 500),
        ]];
        let events = run(
            &samples,
            standing(3000, 20, [0, 0]),
            standing(3000, 20, [100, 100]),
        );
        assert!(events.is_empty());
    }

    #[test]
    fn a_fight_both_sides_lost_alike_in_is_even() {
        let samples = vec![
            (0..20)
                .map(|_| death(10 * SECOND, 0, unit::MARINE, 500))
                .chain((0..19).map(|_| death(10 * SECOND, 1, unit::MARINE, 500)))
                .collect::<Vec<_>>(),
        ];
        let events = run(
            &samples,
            standing(2000, 20, [0, 0]),
            standing(2000, 20, [950, 1000]),
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::FightEven {
                lost: 950,
                killed: 1000
            }
        );
        assert_eq!(events[0].significance, Significance::Notable);
    }

    #[test]
    fn deaths_far_apart_are_separate_engagements() {
        // Two fights at once at opposite ends of the map, each too small on its own.
        let samples = vec![vec![
            death(10 * SECOND, 0, unit::HYDRALISK, 100),
            death(10 * SECOND, 1, unit::HYDRALISK, 3000),
        ]];
        let events = run(
            &samples,
            standing(400, 20, [0, 0]),
            standing(400, 20, [100, 100]),
        );
        assert!(events.is_empty());
    }

    #[test]
    fn a_run_on_a_mineral_line_is_told_and_a_worker_or_two_is_not() {
        let raid = vec![
            (0..7)
                .map(|_| death(10 * SECOND, 0, unit::DRONE, 500))
                .collect::<Vec<_>>(),
        ];
        let events = run(
            &raid,
            standing(1000, 30, [0, 0]),
            standing(1000, 23, [0, 350]),
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::WorkersKilled { count: 7 }
        );
        assert_eq!(events[0].player, 1);
        assert_eq!(events[0].subject, TimelineSubject::Unit(unit::DRONE));

        let pair = vec![
            (0..2)
                .map(|_| death(10 * SECOND, 0, unit::DRONE, 500))
                .collect::<Vec<_>>(),
        ];
        let events = run(
            &pair,
            standing(1000, 30, [0, 0]),
            standing(1000, 28, [0, 100]),
        );
        assert!(events.is_empty());
    }

    #[test]
    fn three_workers_matter_when_they_are_a_good_share_of_them() {
        let three = vec![
            (0..3)
                .map(|_| death(10 * SECOND, 0, unit::SCV, 500))
                .collect::<Vec<_>>(),
        ];
        let early = run(
            &three,
            standing(500, 12, [0, 0]),
            standing(500, 9, [0, 150]),
        );
        assert_eq!(early[0].kind, TimelineEventKind::WorkersKilled { count: 3 });
        let late = run(
            &three,
            standing(500, 50, [0, 0]),
            standing(500, 47, [0, 150]),
        );
        assert!(late.is_empty());
    }

    #[test]
    fn a_destroyed_base_is_told_at_once() {
        let units = FakeUnits::standard();
        let mut events = Vec::new();
        let before = standing(1000, 20, [0, 0]);
        let mut now = before;
        now.razings[1] = 1200;
        let alive = roster(&[1], 600);
        let moment = Moment {
            before: &before,
            now: &now,
            rosters: [&alive, &alive],
            frame: 10 * SECOND,
            last_sample: false,
        };
        let hatchery = [death(10 * SECOND, 0, unit::HATCHERY, 500)];
        advance(
            Some(&Engagements::default()),
            &hatchery,
            &moment,
            &units,
            &mut events,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, TimelineEventKind::BaseDestroyed);
        assert_eq!(events[0].player, 1);
    }

    #[test]
    fn a_player_leaving_ends_the_fight_there_and_then() {
        let units = FakeUnits::standard();
        let mut events = Vec::new();
        let before = standing(2000, 20, [0, 0]);
        let fighting = (0..30)
            .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
            .collect::<Vec<_>>();
        let alive = roster(&[1], 500);
        let killed = standing(2000, 20, [0, 3000]);
        let moment = Moment {
            before: &before,
            now: &killed,
            rosters: [&alive, &alive],
            frame: 10 * SECOND,
            last_sample: false,
        };
        let state = advance(
            Some(&Engagements::default()),
            &fighting,
            &moment,
            &units,
            &mut events,
        );
        assert!(events.is_empty());
        let mut gone = killed;
        gone.out[0] = true;
        let moment = Moment {
            before: &killed,
            now: &gone,
            frame: 11 * SECOND,
            ..moment
        };
        advance(Some(&state), &[], &moment, &units, &mut events);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].frame, 10 * SECOND);
    }

    /// In a team game a side wins together: player 2, whose ally lost the most, still won.
    #[test]
    fn a_team_wins_a_fight_together() {
        let mut before = Standing::default();
        before.army[..4].copy_from_slice(&[2000, 2000, 2000, 2000]);
        // Players 0 and 2 against 1 and 3.
        before.allies[..4].copy_from_slice(&[1 << 2, 1 << 3, 1, 1 << 1]);
        let mut now = before;
        now.kills[..4].copy_from_slice(&[1000, 600, 2500, 400]);
        let samples = vec![
            (0..15)
                .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
                .chain((0..25).map(|_| death(10 * SECOND, 1, unit::HYDRALISK, 500)))
                .chain((0..25).map(|_| death(10 * SECOND, 3, unit::HYDRALISK, 500)))
                .collect::<Vec<_>>(),
        ];
        let events = run(&samples, before, now);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::FightWon {
                degree: FightDegree::Decisive,
                lost: 1500,
                killed: 5000
            }
        );
        assert_eq!(events[0].player, 2);
    }

    /// A player killing something across the map in the meantime had no part in the fight, and
    /// does not win it for having lost nothing in it.
    #[test]
    fn a_kill_elsewhere_wins_no_fight() {
        let mut before = Standing::default();
        before.army[..3].copy_from_slice(&[3000, 3000, 3000]);
        let mut now = before;
        now.kills[..3].copy_from_slice(&[500, 2000, 50]);
        let samples = vec![
            (0..20)
                .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
                .chain((0..10).map(|_| death(10 * SECOND, 1, unit::MARINE, 500)))
                .collect::<Vec<_>>(),
        ];
        let mut alive = roster(&[0, 1], 500);
        alive.extend(roster(&[2], 4000));
        let events = run_among(&samples, before, now, &alive);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::FightWon {
                degree: FightDegree::Decisive,
                lost: 500,
                killed: 2000
            }
        );
        assert_eq!(events[0].player, 1);
    }

    /// A player who turns up after the fighting is over, having killed something elsewhere in the
    /// meantime, did not win it.
    #[test]
    fn a_late_arrival_wins_no_fight() {
        let units = FakeUnits::standard();
        let mut events = Vec::new();
        let mut before = Standing::default();
        before.army[..3].copy_from_slice(&[3000, 3000, 3000]);
        let mut now = before;
        now.kills[..2].copy_from_slice(&[500, 2000]);
        let fighting = roster(&[0, 1], 500);
        let deaths = (0..20)
            .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
            .chain((0..10).map(|_| death(10 * SECOND, 1, unit::MARINE, 500)))
            .collect::<Vec<_>>();
        let mut state = advance(
            Some(&Engagements::default()),
            &deaths,
            &Moment {
                before: &before,
                now: &now,
                rosters: [&fighting, &fighting],
                frame: 10 * SECOND,
                last_sample: false,
            },
            &units,
            &mut events,
        );
        // Player 2 kills something across the map, then walks up to where the fight was.
        let mut later = now;
        later.kills[2] = 50;
        let mut arrived = fighting.clone();
        arrived.extend(roster(&[2], 4000));
        for second in 11..=(10 + GAP_FRAMES / SECOND + 2) {
            if second == 19 {
                arrived = fighting.clone();
                arrived.extend(roster(&[2], 520));
            }
            let earlier = if second == 11 { now } else { later };
            state = advance(
                Some(&state),
                &[],
                &Moment {
                    before: &earlier,
                    now: &later,
                    rosters: [&arrived, &arrived],
                    frame: second * SECOND,
                    last_sample: false,
                },
                &units,
                &mut events,
            );
        }
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::FightWon {
                degree: FightDegree::Decisive,
                lost: 500,
                killed: 2000
            }
        );
        assert_eq!(events[0].player, 1);
    }

    /// Losses that no player nearby could have inflicted are not told as a fight anybody won.
    #[test]
    fn losses_with_nobody_near_them_are_no_fight() {
        let samples = vec![
            (0..30)
                .map(|_| death(10 * SECOND, 0, unit::HYDRALISK, 500))
                .collect::<Vec<_>>(),
        ];
        let events = run_among(
            &samples,
            standing(3000, 20, [0, 0]),
            standing(3000, 20, [0, 3000]),
            &roster(&[1], 4000),
        );
        assert!(events.is_empty());
    }

    /// A base is razed by whoever was there, not by whoever razed the most across the map.
    #[test]
    fn a_base_is_razed_by_a_player_at_it() {
        let units = FakeUnits::standard();
        let mut events = Vec::new();
        let mut before = Standing::default();
        before.army[..3].copy_from_slice(&[1000, 1000, 1000]);
        let mut now = before;
        now.razings[..3].copy_from_slice(&[0, 400, 1500]);
        let mut alive = roster(&[1], 600);
        alive.extend(roster(&[2], 4000));
        let moment = Moment {
            before: &before,
            now: &now,
            rosters: [&alive, &alive],
            frame: 10 * SECOND,
            last_sample: false,
        };
        let command_center = [death(10 * SECOND, 0, unit::COMMAND_CENTER, 500)];
        advance(
            Some(&Engagements::default()),
            &command_center,
            &moment,
            &units,
            &mut events,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, TimelineEventKind::BaseDestroyed);
        assert_eq!(events[0].player, 1);
    }

    /// A hydralisk killed while it is a lurker egg was never complete, and is still a loss.
    #[test]
    fn a_unit_killed_mid_morph_is_a_loss() {
        let egg = |frame| Death {
            completed: false,
            ..death(frame, 0, unit::LURKER_EGG, 500)
        };
        let samples = vec![(0..25).map(|_| egg(10 * SECOND)).collect::<Vec<_>>()];
        let events = run(
            &samples,
            standing(3000, 20, [0, 0]),
            standing(3000, 20, [0, 2500]),
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            TimelineEventKind::FightWon {
                degree: FightDegree::Decisive,
                lost: 0,
                killed: 2500
            }
        );
    }
}
