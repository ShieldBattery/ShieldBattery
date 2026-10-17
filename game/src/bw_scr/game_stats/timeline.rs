//! Working out what happened between two samples: buildings finished, bases taken, tiers reached and
//! research started and finished. The game keeps none of these as events, only the counts and
//! flags they change, so each is found by comparing a sample with the one before it.

use bw_dat::{TechId, UnitId, UpgradeId, unit};
use overlay_ui::observer::{Significance, TimelineEventKind};

use super::engagements::Engagements;
use super::snapshot::{
    BuildingSite, DepotSite, GameSnapshot, ResearchLevels, ResearchSite, RosterUnit,
};
use super::unit_value::UnitCatalog;
use super::{
    MAX_PLAYERS, SAMPLE_INTERVAL_FRAMES, TECH_COUNT, TimelineEvent, TimelineSubject, UNIT_ID_COUNT,
    UPGRADE_COUNT,
};

/// How far from a player's own start location a finished resource depot has to be before it counts
/// as an expansion rather than as another building in the main, in map pixels.
///
/// Generous, because the cost of calling a macro hatch an expansion is a wrong line on the timeline
/// while the cost of missing one is nothing at all: a real expansion is most of a screen away.
const EXPANSION_DISTANCE: i32 = 32 * 15;

/// How long a game's opening lasts, in frames: about five minutes, by when a player's build is
/// set and the second and third of a production building say which one it was. Past it, another
/// gateway is one of many.
const OPENING_FRAMES: u32 = 5 * 60 * SAMPLE_INTERVAL_FRAMES;

/// The buildings that make units, which the opening is told by how many of are built.
const PRODUCTION_BUILDINGS: [UnitId; 6] = [
    unit::BARRACKS,
    unit::FACTORY,
    unit::STARPORT,
    unit::GATEWAY,
    unit::STARGATE,
    unit::ROBOTICS_FACILITY,
];

/// How far a lifted resource depot has to land from where it stood before it has moved base rather
/// than set back down where it was, in map pixels.
const SAME_DEPOT_DISTANCE: i32 = 64;

/// What one sample left behind for the next one to be compared against.
pub struct Baseline {
    /// The frame of the sample it was taken from.
    pub frame: u32,
    completed_units: Box<[[u32; MAX_PLAYERS]]>,
    research: ResearchLevels,
    /// Every finished building other than a depot, so a building count that went up can be put at
    /// the building that was not standing before.
    buildings: Vec<BuildingSite>,
    /// Where each research seen running runs, so its finish can be put where its start was: by the
    /// sample that sees it finish, the building has nothing in progress any more.
    research_sites: Vec<ResearchSite>,
    /// Every resource depot standing, so one that was already there is not reported again.
    depots: Vec<KnownDepot>,
    /// Every unit alive, sorted by unique id, so the next sample can tell which have died.
    pub roster: Vec<RosterUnit>,
    /// How many of each building every player has finished while there was a sample to report it
    /// against, indexed by unit id: a building is judged by how many came before it, whether or
    /// not those still stand.
    pub built: Box<[[u16; MAX_PLAYERS]]>,
    /// The fights going on as of this sample.
    pub engagements: Engagements,
}

/// A resource depot standing, as of where it last stood on the ground.
#[derive(Copy, Clone)]
struct KnownDepot {
    player: u8,
    unique_id: u32,
    /// The tier it was last seen finished as, so reaching the next one is noticed.
    unit_id: UnitId,
    x: i16,
    y: i16,
}

/// Compares `snapshot` with `previous`, the baseline of the sample just before it, putting
/// everything that changed in between onto `events`, and returns the baseline for the next sample.
///
/// Without `previous` this only takes stock: a map may start with buildings, upgrades and bases in
/// place, and a game picked up partway through already has them, and reporting each as having just
/// happened would bury the timeline under things that did not. `built` is what the newest baseline
/// counted as built, however long ago it was taken.
pub fn advance(
    previous: Option<&Baseline>,
    built: Option<Box<[[u16; MAX_PLAYERS]]>>,
    snapshot: GameSnapshot,
    catalog: &impl UnitCatalog,
    events: &mut Vec<TimelineEvent>,
) -> Baseline {
    let mut timeline = Timeline {
        frame: snapshot.frame,
        reporting: previous.is_some(),
        events,
        built: built
            .unwrap_or_else(|| vec![[0; MAX_PLAYERS]; UNIT_ID_COUNT as usize].into_boxed_slice()),
    };
    let starts = snapshot.players.each_ref().map(|player| player.start);
    let depots = timeline.depots(
        previous.map_or(&[], |previous| &previous.depots),
        &snapshot.depots,
        &starts,
    );
    if let Some(previous) = previous {
        timeline.buildings(previous, &snapshot, catalog);
    }
    let research_sites = merge_research_sites(
        previous.map_or(&[], |previous| &previous.research_sites),
        &snapshot.research_sites,
    );
    if let Some(previous) = previous {
        timeline.research(&previous.research, &snapshot.research, &research_sites);
    }
    Baseline {
        frame: snapshot.frame,
        completed_units: snapshot.completed_units,
        research: snapshot.research,
        buildings: snapshot.buildings,
        research_sites,
        depots,
        roster: snapshot.roster,
        built: timeline.built,
        engagements: Engagements::default(),
    }
}

/// Where the events one sample finds are put.
struct Timeline<'a> {
    frame: u32,
    /// Whether there is anything to report against, rather than only stock to take.
    reporting: bool,
    events: &'a mut Vec<TimelineEvent>,
    built: Box<[[u16; MAX_PLAYERS]]>,
}

impl Timeline<'_> {
    fn report(
        &mut self,
        player: u8,
        kind: TimelineEventKind,
        significance: Significance,
        subject: TimelineSubject,
        position: Option<(i16, i16)>,
    ) {
        if self.reporting {
            self.events.push(TimelineEvent {
                frame: self.frame,
                recorded: self.frame,
                player,
                kind,
                significance,
                subject,
                position,
            });
        }
    }

    /// Reports a building of `unit_id` that `player` finished, if it is one worth listing: the
    /// first of its kind, and in the opening the second and third of a production building, which
    /// is how an opening is told apart. Past those, another of the same is one of many.
    fn building(&mut self, player: u8, unit_id: UnitId, position: Option<(i16, i16)>) {
        if !self.reporting {
            return;
        }
        let Some(count) = self
            .built
            .get_mut(unit_id.0 as usize)
            .and_then(|counts| counts.get_mut(player as usize))
        else {
            return;
        };
        *count = count.saturating_add(1);
        let opening_production =
            PRODUCTION_BUILDINGS.contains(&unit_id) && self.frame < OPENING_FRAMES && *count <= 3;
        if *count == 1 || opening_production {
            self.report(
                player,
                TimelineEventKind::BuildingCompleted,
                Significance::Notable,
                TimelineSubject::Unit(unit_id),
                position,
            );
        }
    }

    /// Reports resource depots that were not standing at the last sample, as expansions when they
    /// are away from the player's own start location and as ordinary buildings when they are not,
    /// and a depot that finished turning into the next tier up. Returns every depot standing now.
    ///
    /// Each depot is followed as the one unit it is, so one lifted off is still the same base and
    /// one destroyed is gone: a base rebuilt where it stood is a base taken again. Only depots on
    /// the ground are placed, because where one floats says nothing about where a base is; one
    /// set down away from where it stood has moved base, which is an expansion taken where it
    /// landed if that is away from the start location, and otherwise nothing new.
    fn depots(
        &mut self,
        known: &[KnownDepot],
        standing: &[DepotSite],
        starts: &[(i16, i16); MAX_PLAYERS],
    ) -> Vec<KnownDepot> {
        let mut known: Vec<KnownDepot> = known
            .iter()
            .filter(|depot| {
                standing
                    .iter()
                    .any(|site| site.unique_id == depot.unique_id && site.player == depot.player)
            })
            .copied()
            .collect();
        for site in standing.iter().filter(|site| site.landed) {
            let position = (site.x, site.y);
            let depot = known
                .iter_mut()
                .find(|depot| depot.unique_id == site.unique_id && depot.player == site.player);
            match depot {
                Some(depot) if within((depot.x, depot.y), position, SAME_DEPOT_DISTANCE) => {
                    // A building morphing to the next tier is still the kind it was until it is
                    // done, so the kind only changes when the new tier is finished.
                    if site.completed && depot.unit_id != site.unit_id {
                        depot.unit_id = site.unit_id;
                        self.report(
                            site.player,
                            TimelineEventKind::BuildingCompleted,
                            Significance::Key,
                            TimelineSubject::Unit(site.unit_id),
                            Some(position),
                        );
                    }
                }
                Some(depot) => {
                    (depot.x, depot.y, depot.unit_id) = (site.x, site.y, site.unit_id);
                    if !near_start(site, starts) {
                        self.report(
                            site.player,
                            TimelineEventKind::ExpansionTaken,
                            Significance::Key,
                            TimelineSubject::Unit(site.unit_id),
                            Some(position),
                        );
                    }
                }
                None => {
                    known.push(KnownDepot {
                        player: site.player,
                        unique_id: site.unique_id,
                        unit_id: site.unit_id,
                        x: site.x,
                        y: site.y,
                    });
                    self.new_depot(site, starts);
                }
            }
        }
        known
    }

    /// Reports a depot that was not standing before: an expansion away from its owner's start
    /// location, and in the main another building, listed as the first of its kind is.
    fn new_depot(&mut self, site: &DepotSite, starts: &[(i16, i16); MAX_PLAYERS]) {
        match near_start(site, starts) {
            true => self.building(site.player, site.unit_id, Some((site.x, site.y))),
            false => self.report(
                site.player,
                TimelineEventKind::ExpansionTaken,
                Significance::Key,
                TimelineSubject::Unit(site.unit_id),
                Some((site.x, site.y)),
            ),
        }
    }

    /// Reports every building that finished since the last sample.
    ///
    /// Resource depots are left out: they are followed one by one, which is the only way to tell an
    /// expansion from another building in the main.
    ///
    /// Counted from the game's own tallies, and put on the map at the buildings of the kind that
    /// were not standing at the last sample.
    fn buildings(
        &mut self,
        previous: &Baseline,
        snapshot: &GameSnapshot,
        catalog: &impl UnitCatalog,
    ) {
        let mut fresh = snapshot
            .buildings
            .iter()
            .filter(|site| !previous.buildings.contains(site))
            .copied()
            .collect::<Vec<_>>();
        for (id, counts) in snapshot.completed_units.iter().enumerate() {
            let unit_id = UnitId(id as u16);
            if !catalog.is_building(unit_id) || catalog.is_town_hall(unit_id) {
                continue;
            }
            for (player, &count) in counts.iter().enumerate() {
                let before = previous
                    .completed_units
                    .get(id)
                    .map_or(0, |counts| counts[player]);
                for _ in 0..count.saturating_sub(before) {
                    let site = fresh
                        .iter()
                        .position(|site| site.player == player as u8 && site.unit_id == unit_id)
                        .map(|index| fresh.swap_remove(index));
                    self.building(player as u8, unit_id, site.map(|site| (site.x, site.y)));
                }
            }
        }
    }

    /// Reports every technology that was started or finished since the last sample, and every
    /// upgrade that finished.
    ///
    /// A start is the game's in-progress flag going up and a finish is the level or the researched
    /// flag moving, so a technology canceled halfway reports its start and nothing else, which is
    /// exactly what happened. An upgrade's start is left out: a level is only worth knowing once it
    /// is had. Both are put on the map at the building the research runs in, as found in `sites`.
    fn research(&mut self, before: &ResearchLevels, now: &ResearchLevels, sites: &[ResearchSite]) {
        let site_of = |player: usize, subject: TimelineSubject| {
            sites
                .iter()
                .find(|site| site.player == player as u8 && site.subject == subject)
                .map(|site| (site.x, site.y))
        };
        for player in 0..MAX_PLAYERS {
            for id in 0..UPGRADE_COUNT as usize {
                let subject = TimelineSubject::Upgrade(UpgradeId(id as u16));
                let started =
                    now.upgrade_in_progress[player][id] && !before.upgrade_in_progress[player][id];
                let finished = now.upgrade_level[player][id] > before.upgrade_level[player][id];
                self.research_events(player, subject, started, finished, site_of(player, subject));
            }
            for id in 0..TECH_COUNT as usize {
                let subject = TimelineSubject::Tech(TechId(id as u16));
                let started =
                    now.tech_in_progress[player][id] && !before.tech_in_progress[player][id];
                let finished =
                    now.tech_researched[player][id] && !before.tech_researched[player][id];
                self.research_events(player, subject, started, finished, site_of(player, subject));
            }
        }
    }

    fn research_events(
        &mut self,
        player: usize,
        subject: TimelineSubject,
        started: bool,
        finished: bool,
        site: Option<(i16, i16)>,
    ) {
        let (start, finish) = match subject {
            TimelineSubject::Tech(_) => (
                Some((TimelineEventKind::TechStarted, Significance::Notable)),
                (TimelineEventKind::TechCompleted, Significance::Key),
            ),
            _ => (
                None,
                (TimelineEventKind::UpgradeCompleted, Significance::Notable),
            ),
        };
        if started && let Some((kind, significance)) = start {
            self.report(player as u8, kind, significance, subject, site);
        }
        if finished {
            self.report(player as u8, finish.0, finish.1, subject, site);
        }
    }
}

/// Every research site known, with the ones `running` now replacing whatever was known for the same
/// player and research.
fn merge_research_sites(known: &[ResearchSite], running: &[ResearchSite]) -> Vec<ResearchSite> {
    let mut sites = known.to_vec();
    for site in running {
        match sites
            .iter_mut()
            .find(|known| known.player == site.player && known.subject == site.subject)
        {
            Some(known) => *known = *site,
            None => sites.push(*site),
        }
    }
    sites
}

/// Whether a depot stands close enough to its owner's start location to be part of the main.
fn near_start(site: &DepotSite, starts: &[(i16, i16); MAX_PLAYERS]) -> bool {
    let start = starts
        .get(site.player as usize)
        .copied()
        .unwrap_or_default();
    within(start, (site.x, site.y), EXPANSION_DISTANCE)
}

/// Whether two map positions are within `distance` pixels of each other.
fn within(a: (i16, i16), b: (i16, i16), distance: i32) -> bool {
    let dx = i32::from(a.0) - i32::from(b.0);
    let dy = i32::from(a.1) - i32::from(b.1);
    dx * dx + dy * dy <= distance * distance
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_distance_is_measured_as_a_circle() {
        assert!(within((0, 0), (30, 40), 50));
        assert!(!within((0, 0), (30, 40), 49));
    }
}
