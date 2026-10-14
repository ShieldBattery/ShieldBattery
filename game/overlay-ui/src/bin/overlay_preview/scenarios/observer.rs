//! The observer scenario, with a fake game behind it.
//!
//! The observer panels report on a game rather than acting on one, so a scenario of frozen numbers
//! would prove almost nothing: a bank that never moves cannot show whether a number jitters its
//! column wider, and a production row that never fills cannot show whether a progress bar reads at
//! a glance. So this scenario simulates a game — banks that rise and fall, supply that climbs, rows
//! of production that fill and restart — and answers the two things a watcher can ask of the panels:
//! whose vision they are watching through, and which producer they want selected.
//!
//! The simulation is a pure function of game time, so an offline render of the same second is the
//! same image every time, and the preview's own clock is the only thing that moves it.
//!
//! Every measurement here is per-player and knows nothing about how many players there are, so the
//! same fake game drives a duel, two sides of two, two sides of four and a free-for-all of any
//! size. What changes with the shape is which surfaces the game has: two players are read from the
//! matchup bar, up to two a half from its stacked form, and anything wider from the corner team
//! cards.

use egui::{Color32, Rect, pos2, vec2};
use overlay_ui::observer::{
    ControlGroupView, ControlGroupsPlayerView, ControlGroupsView, EconomyPlayerView, EconomyView,
    GraphGrouping, GraphLineView, GraphSeries, GraphsView, MapControlSideView, MapControlView,
    MatchupForm, MatchupPlayerView, MatchupView, MilitaryPlayerView, MilitaryView, ObserverView,
    ProductionIcon, ProductionItemView, ProductionPlayerView, ProductionProgressView,
    ProductionView, RaceView, SelectedUnitView, SelectionView, TeamCardPlayerView,
    TeamCardTotalsView, TeamCardView, TeamCardsView, TimelineEventKind, TimelineEventView,
    TimelineView, UnitUpgradeView, UpgradeEffect, WeaponDamageView, team_name,
};
use overlay_ui::shell::PanelPrefs;
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;

/// The most players a game of Brood War has, which is as many as anything here reports on.
const MAX_PLAYERS: usize = 8;

/// The longest name the game lets a player carry, which is what the bar's name slot has to survive.
const LONG_NAME: &str = "MaximumLengthName_24ch";

/// The names the fake game's players are given, in slot order.
const NAMES: [&str; MAX_PLAYERS] = [
    "Rhynso", "tec27", "Artosis", "Nyoken", "Sasin", "Dandy", "Cloudy", "KogeT",
];

/// How many points a graph line is drawn from. The panel is a few hundred points wide, so more
/// samples than this would be more line segments than there are pixels to draw them in.
const GRAPH_POINTS: usize = 120;

/// How often the fake game puts something on the timeline, in seconds of game time.
const EVENT_INTERVAL_SECS: u64 = 37;

/// How many events the fake game hands over, which is as many as the game DLL does: more than the
/// panel draws, and what the replay plate's track is ticked with.
const TIMELINE_DEPTH: usize = 24;

/// What the fake game's timeline events are about, walked in turn: something is built, an upgrade
/// runs its course, an expansion goes up, a technology runs its course.
const EVENT_KINDS: [TimelineEventKind; 6] = [
    TimelineEventKind::BuildingCompleted,
    TimelineEventKind::UpgradeStarted,
    TimelineEventKind::UpgradeCompleted,
    TimelineEventKind::ExpansionTaken,
    TimelineEventKind::TechStarted,
    TimelineEventKind::TechCompleted,
];

/// What each race's production row is filled from: the units a player of that race is most often
/// making, by the id the game's own icon atlas is indexed with.
const ZERG_UNITS: [u16; 5] = [41, 37, 38, 43, 42];
const TERRAN_UNITS: [u16; 5] = [7, 0, 2, 5, 8];
const PROTOSS_UNITS: [u16; 5] = [64, 65, 66, 71, 69];

/// The buildings a player of each race keeps on a key: their production and their town hall, which
/// are the two every player of the race binds.
const ZERG_BUILDINGS: [u16; 2] = [0x8e, 0x83];
const TERRAN_BUILDINGS: [u16; 2] = [0x71, 0x6a];
const PROTOSS_BUILDINGS: [u16; 2] = [0xa0, 0x9a];

/// What each race carries its army around in, for the selection that is a loaded transport.
const ZERG_TRANSPORT: u16 = 0x2a;
const TERRAN_TRANSPORT: u16 = 0x0b;
const PROTOSS_TRANSPORT: u16 = 0x45;

/// What each race defends its bases with, for the selection that is a building with guns of its own.
const ZERG_DEFENSE: u16 = 0x92;
const TERRAN_DEFENSE: u16 = 0x7c;
const PROTOSS_DEFENSE: u16 = 0xa2;

/// The egg a larva turns into while it morphs, for the selection that is a unit on its way to
/// being another.
const ZERG_EGG: u16 = 0x24;

/// The names the game's English stat_txt gives the units and buildings above, by the same id.
fn unit_name(id: u16) -> Option<String> {
    let name = match id {
        0 => "Terran Marine",
        2 => "Terran Vulture",
        5 => "Terran Siege Tank",
        7 => "Terran SCV",
        8 => "Terran Wraith",
        TERRAN_TRANSPORT => "Terran Dropship",
        ZERG_EGG => "Zerg Egg",
        37 => "Zerg Zergling",
        38 => "Zerg Hydralisk",
        41 => "Zerg Drone",
        ZERG_TRANSPORT => "Zerg Overlord",
        43 => "Zerg Mutalisk",
        64 => "Protoss Probe",
        65 => "Protoss Zealot",
        66 => "Protoss Dragoon",
        PROTOSS_TRANSPORT => "Protoss Shuttle",
        71 => "Protoss Arbiter",
        0x6a => "Terran Command Center",
        0x71 => "Terran Barracks",
        0x83 => "Zerg Hatchery",
        0x8e => "Zerg Spawning Pool",
        0x9a => "Protoss Nexus",
        0xa0 => "Protoss Gateway",
        ZERG_DEFENSE => "Zerg Sunken Colony",
        TERRAN_DEFENSE => "Terran Missile Turret",
        PROTOSS_DEFENSE => "Protoss Photon Cannon",
        _ => return None,
    };
    Some(name.to_string())
}

/// How many units the loaded transport is carrying, which is short of the eight one holds: a row
/// drawn to its last slot would not say whether the panel draws the room or only what is in it.
const CARGO_UNITS: usize = 4;

/// How many more units the producing building has waiting behind the one on the way.
const QUEUED_UNITS: usize = 2;

/// Which slot of a player's control groups the two building groups start at, which is where a
/// player who binds their buildings at all puts them: after the armies they made with them.
const BUILDING_SLOT: usize = 4;

/// The fake game's knobs.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// Where the game's clock starts, in seconds. A live game counts up from here; a replay takes
    /// its clock from the fake replay instead, so the two never disagree on screen.
    pub start_secs: u32,
    /// How many players the fake game has.
    pub players: usize,
    /// How many players a side holds, filled in slot order: one side of this many, then the next.
    /// A size of one is a free-for-all, where every player is their own side, and a size that does
    /// not divide the player count leaves the last side short, the way a three-player game of two
    /// against one does.
    pub team_size: usize,
    /// What each player is playing, in slot order. A list rather than a fixed row of eight, so a
    /// knobs file written when the scenario had fewer slots still loads into this one.
    pub races: Vec<RaceView>,
    /// Whether the player on the left has lost supply they were already using, which is the one
    /// number on the bar that changes color.
    pub supply_blocked: bool,
    /// Whether the players carry the longest names the game allows, which is what proves a name
    /// slot elides rather than pushing the numbers beside it out of place.
    pub long_names: bool,
    /// How many entries each player's production row carries.
    pub production_depth: usize,
    /// How many of the ten number keys each player has a group on. The empty slots are the point:
    /// the panel draws all ten whether or not there is anything on them.
    pub control_groups: usize,
    /// How many units the watcher has selected. One of them is the panel's own case: a selection of
    /// one is the only one the game's console reads numbers out of, and a selection of none is what
    /// the panel spends most of a game showing.
    pub selection: usize,
    /// Whether what is selected is a building part way through making something, which is the
    /// reading a queue and a progress bar are drawn for. Takes the selection over from the count.
    pub selection_building: bool,
    /// Whether what is selected is a transport with an army inside it, which is the reading the
    /// carried units are drawn for. Takes the selection over from the count.
    pub selection_cargo: bool,
    /// Whether what is selected is a building that is itself still going up, which is the reading
    /// that names the building once rather than again as what it is making. Takes the selection
    /// over from the count.
    pub selection_constructing: bool,
    /// Whether what is selected is an egg part way through its morph, which is the reading that
    /// has one slot of what it is turning into and its carapace under that. Takes the selection
    /// over from the count.
    pub selection_morphing: bool,
    /// Whether what is selected is a building with guns of its own and nothing on the way, which
    /// is the reading of a building with upgrades to read out. Takes the selection over from the
    /// count.
    pub selection_defense: bool,
    /// Whether the game reports how much of the map each side holds. The real game has no such
    /// measurement yet, so this is the switch that proves the bar disappears without one rather
    /// than drawing an empty share.
    pub map_control: bool,
    /// Whether the list of players under the minimap's vision button starts open, which is a state
    /// an offline render has no click to reach.
    pub vision_picker: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            start_secs: 612,
            players: 2,
            team_size: 1,
            // Every race within the first four slots, so a two-against-two game shows all four
            // chips side by side.
            races: vec![
                RaceView::Zerg,
                RaceView::Terran,
                RaceView::Protoss,
                RaceView::Random,
                RaceView::Terran,
                RaceView::Protoss,
                RaceView::Zerg,
                RaceView::Terran,
            ],
            supply_blocked: false,
            long_names: false,
            production_depth: 6,
            control_groups: 6,
            selection: 1,
            selection_building: false,
            selection_cargo: false,
            selection_constructing: false,
            selection_morphing: false,
            selection_defense: false,
            map_control: true,
            vision_picker: false,
        }
    }
}

impl Knobs {
    /// How many players the fake game actually has, whatever a knobs file asked for.
    fn player_count(&self) -> usize {
        self.players.clamp(2, MAX_PLAYERS)
    }

    /// What a slot is playing, for a slot a shorter knobs file said nothing about.
    fn race(&self, index: usize) -> RaceView {
        self.races.get(index).copied().unwrap_or_default()
    }

    /// Grows the race list to cover every slot, so the knob panel has one to hand out per player.
    fn fill_races(&mut self) {
        let wanted = self.player_count();
        while self.races.len() < wanted {
            self.races.push(RaceView::default());
        }
    }

    /// How many players a side holds, whatever a knobs file asked for.
    fn team_size(&self) -> usize {
        self.team_size.clamp(1, self.player_count())
    }

    /// Which side a player is on, counting from one: the slots are dealt out a side at a time, the
    /// way a lobby lays a team game out.
    fn team_of(&self, index: usize) -> u8 {
        (index / self.team_size()) as u8 + 1
    }

    /// How many sides the game has, the last of them short where the size does not divide the
    /// players.
    fn team_count(&self) -> usize {
        self.player_count().div_ceil(self.team_size())
    }

    /// The slots on one side, in slot order.
    fn side(&self, team: u8) -> Vec<usize> {
        (0..self.player_count())
            .filter(|index| self.team_of(*index) == team)
            .collect()
    }

    /// Whether this game has sides worth telling apart from the players on them, which is what
    /// decides whether the graphs panel has two groupings to offer.
    fn has_teams(&self) -> bool {
        self.team_count() > 1 && self.team_size() > 1
    }
}

/// What the fake game remembers between frames: everything the panels can change about it.
pub struct State {
    /// Whose vision the watcher is on, by player id. The game answers a vision toggle by changing
    /// what it shows; here there is nothing to show, so the panels' own state is the answer.
    vision: [bool; MAX_PLAYERS],
    /// The last production entry a click asked to be selected, which the knob panel reads back: the
    /// preview has no units to select, so the ask is all there is to see.
    pub last_selection: Option<(u8, usize)>,
    /// Whether the list of players under the minimap's vision button has been opened for a preset
    /// that asks for it. Once, so a watcher in the live preview can close it again.
    pub vision_picker_opened: bool,
}

impl State {
    pub fn new() -> State {
        State {
            vision: [true; MAX_PLAYERS],
            last_selection: None,
            vision_picker_opened: false,
        }
    }

    /// Answers a vision toggle the way the game does, by changing what the watcher is shown.
    pub fn toggle_vision(&mut self, player_id: u8) {
        if let Some(vision) = self.vision.get_mut(player_id as usize) {
            *vision = !*vision;
        }
    }

    pub fn note_selection(&mut self, player_id: u8, item: usize) {
        self.last_selection = Some((player_id, item));
    }
}

/// Which lines the graphs panel is being asked for.
#[derive(Copy, Clone)]
pub struct GraphRequest {
    pub series: GraphSeries,
    pub per_player: bool,
}

/// Builds the view the game would hand the overlay at `game_secs` into the game.
pub fn build_view(
    knobs: &Knobs,
    state: &State,
    is_replay: bool,
    game_secs: u64,
    graphs: GraphRequest,
) -> ObserverView {
    let t = game_secs as f64;
    let players = knobs.player_count();
    let matchup = MatchupView {
        players: (0..players)
            .map(|index| matchup_player(knobs, state, index, t))
            .collect(),
        elapsed_secs: game_secs,
        is_replay,
    };
    ObserverView {
        // The corner cards carry the players the bar gave up, so they are built for exactly the
        // games the bar has no halves for.
        team_cards: (matchup.form() == MatchupForm::ClockOnly)
            .then(|| team_cards(knobs, &matchup, t)),
        matchup,
        economy: EconomyView {
            players: (0..players)
                .map(|index| economy_player(knobs, state, index, t))
                .collect(),
        },
        military: MilitaryView {
            players: (0..players)
                .map(|index| military_player(knobs, state, index, t))
                .collect(),
        },
        graphs: graphs_view(knobs, graphs, game_secs),
        timeline: TimelineView {
            events: timeline_events(knobs, game_secs),
        },
        production: ProductionView {
            players: (0..players)
                .map(|index| production_player(knobs, index, t))
                .collect(),
        },
        control_groups: ControlGroupsView {
            players: (0..players)
                .map(|index| control_groups_player(knobs, state, index, t))
                .collect(),
        },
        selection: selection(knobs, t),
        map_control: knobs.map_control.then(|| map_control(t)),
    }
}

/// The name a panel other than the matchup bar puts on a player.
fn player_name(knobs: &Knobs, index: usize) -> String {
    if knobs.long_names {
        LONG_NAME.to_string()
    } else {
        NAMES[index % NAMES.len()].to_string()
    }
}

/// Minerals and gas gathered per minute.
fn income(index: usize, t: f64) -> (u32, u32) {
    let ramp = (t / 240.0).min(1.0);
    (
        (320.0 + 620.0 * ramp) as u32 + wave(index as f64 * 1.7, t, 0.021, 140.0),
        (60.0 + 260.0 * ramp) as u32 + wave(index as f64 * 2.3 + 1.0, t, 0.019, 90.0),
    )
}

/// How many workers a player owns, and how many of them are standing still.
fn workers(index: usize, t: f64) -> (u32, u32) {
    let count = (8.0 + t / 9.0).min(62.0) as u32 + index as u32;
    // Idle workers come and go, so the panel is judged both with the count on screen and without
    // it: a footnote that is always there is one nobody reads.
    let idle = wave(index as f64 * 3.1, t, 0.06, 7.0).saturating_sub(2);
    (count, idle)
}

/// What a player's standing army cost to build, in each resource.
fn army(index: usize, t: f64) -> (u32, u32) {
    let ramp = (t / 420.0).min(1.4);
    (
        (900.0 * ramp) as u32 + wave(index as f64 * 1.1, t, 0.014, 900.0),
        (420.0 * ramp) as u32 + wave(index as f64 * 2.7, t, 0.012, 520.0),
    )
}

/// Units killed and lost, which only ever climb.
fn unit_trade(index: usize, t: f64) -> (u32, u32) {
    let killed = (t / 11.0) as u32 + index as u32 * 4;
    let lost = (t / 13.0) as u32 + index as u32 * 3;
    (killed, lost)
}

/// Workers killed and lost, which climb far more slowly than the army does.
fn worker_trade(index: usize, t: f64) -> (u32, u32) {
    ((t / 95.0) as u32 + index as u32, (t / 140.0) as u32)
}

fn economy_player(knobs: &Knobs, state: &State, index: usize, t: f64) -> EconomyPlayerView {
    let (minerals_per_minute, gas_per_minute) = income(index, t);
    let (workers, idle_workers) = workers(index, t);
    EconomyPlayerView {
        name: player_name(knobs, index),
        team: knobs.team_of(index),
        color: overlay_ui::kit::theme::player_color(index),
        vision: state.vision[index],
        race: knobs.race(index),
        minerals_per_minute,
        gas_per_minute,
        workers,
        idle_workers,
    }
}

fn military_player(knobs: &Knobs, state: &State, index: usize, t: f64) -> MilitaryPlayerView {
    let (army_minerals, army_gas) = army(index, t);
    let (units_killed, units_lost) = unit_trade(index, t);
    let (worker_kills, worker_losses) = worker_trade(index, t);
    MilitaryPlayerView {
        name: player_name(knobs, index),
        team: knobs.team_of(index),
        color: overlay_ui::kit::theme::player_color(index),
        vision: state.vision[index],
        race: knobs.race(index),
        army_minerals,
        army_gas,
        units_killed,
        units_lost,
        worker_kills,
        worker_losses,
    }
}

/// The graphs panel's lines, of whichever thing the watcher asked to see them of.
///
/// A game with one player per side has only one answer, so the panel is told there is no grouping
/// to name rather than titled with a distinction it does not have.
fn graphs_view(knobs: &Knobs, request: GraphRequest, game_secs: u64) -> GraphsView {
    let has_teams = knobs.has_teams();
    let per_player = request.per_player || !has_teams;
    let lines = if per_player {
        (0..knobs.player_count())
            .map(|index| GraphLineView {
                label: player_name(knobs, index),
                color: overlay_ui::kit::theme::player_color(index),
                values: series_values(knobs, &[index], request.series, game_secs),
            })
            .collect()
    } else {
        (1..=knobs.team_count() as u8)
            .map(|team| {
                let side = knobs.side(team);
                GraphLineView {
                    label: team_name(team),
                    // A side's line takes the color of the player at the top of its block in every
                    // other panel, which is the only color on screen that already stands for it.
                    color: overlay_ui::kit::theme::player_color(side.first().copied().unwrap_or(0)),
                    values: series_values(knobs, &side, request.series, game_secs),
                }
            })
            .collect()
    };
    GraphsView {
        series: request.series,
        span_secs: game_secs as u32,
        lines,
        grouping: has_teams.then_some(if per_player {
            GraphGrouping::Players
        } else {
            GraphGrouping::Teams
        }),
    }
}

/// One line's samples, summed over the players it is a line for and evenly spaced over the whole
/// game so far.
///
/// The fake game keeps no history: every measurement is a function of game time, so its history is
/// that function evaluated backwards, which is what keeps an offline render of the same second the
/// same image every time.
fn series_values(
    knobs: &Knobs,
    members: &[usize],
    series: GraphSeries,
    game_secs: u64,
) -> Vec<f32> {
    let points = GRAPH_POINTS.min(game_secs as usize + 1).max(2);
    (0..points)
        .map(|point| {
            let t = game_secs as f64 * point as f64 / (points - 1) as f64;
            members
                .iter()
                .map(|index| sample(knobs, *index, series, t))
                .sum()
        })
        .collect()
}

/// What one player's measurement is worth at `t` seconds into the game.
fn sample(knobs: &Knobs, index: usize, series: GraphSeries, t: f64) -> f32 {
    match series {
        GraphSeries::ArmyValue => {
            let (minerals, gas) = army(index, t);
            (minerals + gas) as f32
        }
        GraphSeries::Income => {
            let (minerals, gas) = income(index, t);
            (minerals + gas) as f32
        }
        GraphSeries::Supply => supply(knobs, index, t).0 as f32,
        GraphSeries::Workers => workers(index, t).0 as f32,
        GraphSeries::Kills => unit_trade(index, t).0 as f32,
    }
}

/// What the fake game has put on the timeline by `game_secs`, newest first.
fn timeline_events(knobs: &Knobs, game_secs: u64) -> Vec<TimelineEventView> {
    let players = knobs.player_count() as u64;
    let count = game_secs / EVENT_INTERVAL_SECS;
    (0..count)
        .rev()
        .take(TIMELINE_DEPTH)
        .map(|index| {
            let player = (index % players) as usize;
            let units = race_units(knobs.race(player));
            TimelineEventView {
                secs: (index + 1) * EVENT_INTERVAL_SECS,
                color: overlay_ui::kit::theme::player_color(player),
                kind: EVENT_KINDS[(index / players) as usize % EVENT_KINDS.len()],
                icon: Some(ProductionIcon {
                    texture: None,
                    index: units[index as usize % units.len()],
                    size: None,
                    margin: 0.0,
                    wireframe: None,
                }),
                name: unit_name(units[index as usize % units.len()]),
                position: None,
            }
        })
        .collect()
}

/// How much of the map each side holds, which swings back and forth as the fake game is fought.
fn map_control(t: f64) -> MapControlView {
    MapControlView {
        left: MapControlSideView {
            color: overlay_ui::kit::theme::player_color(0),
            share: (0.28 + 0.24 * ((t * 0.008).sin() * 0.5 + 0.5)) as f32,
        },
        right: MapControlSideView {
            color: overlay_ui::kit::theme::player_color(1),
            share: (0.26 + 0.26 * ((t * 0.011 + 1.4).sin() * 0.5 + 0.5)) as f32,
        },
    }
}

/// The icons a player of this race's rows are filled from.
fn race_units(race: RaceView) -> [u16; 5] {
    match race {
        RaceView::Zerg => ZERG_UNITS,
        RaceView::Terran => TERRAN_UNITS,
        RaceView::Protoss | RaceView::Random => PROTOSS_UNITS,
    }
}

/// The buildings a player of this race's building groups are filled from.
fn race_buildings(race: RaceView) -> [u16; 2] {
    match race {
        RaceView::Zerg => ZERG_BUILDINGS,
        RaceView::Terran => TERRAN_BUILDINGS,
        RaceView::Protoss | RaceView::Random => PROTOSS_BUILDINGS,
    }
}

fn matchup_player(knobs: &Knobs, state: &State, index: usize, t: f64) -> MatchupPlayerView {
    let (supply_used, supply_max) = supply(knobs, index, t);
    MatchupPlayerView {
        player_id: index as u8,
        team: knobs.team_of(index),
        name: player_name(knobs, index),
        color: overlay_ui::kit::theme::player_color(index),
        race: knobs.race(index),
        vision: state.vision[index],
        minerals: wave(index as f64 * 2.1, t, 0.017, 1150.0),
        gas: wave(index as f64 * 1.3 + 2.0, t, 0.023, 780.0),
        supply_used,
        supply_max,
        apm: 90 + wave(index as f64 * 0.7, t, 0.09, 160.0),
    }
}

/// The two corner cards, built from the same players the bar would have carried, cut where the bar
/// would have cut them.
fn team_cards(knobs: &Knobs, matchup: &MatchupView, t: f64) -> TeamCardsView {
    TeamCardsView {
        teams: matchup
            .halves()
            .each()
            .into_iter()
            .filter(|(_, members)| !members.is_empty())
            .map(|(team, members)| TeamCardView {
                team,
                players: members
                    .iter()
                    .map(|player| TeamCardPlayerView {
                        name: player.name.clone(),
                        color: player.color,
                        race: player.race,
                        vision: player.vision,
                        minerals: player.minerals,
                        gas: player.gas,
                        supply_used: player.supply_used,
                        supply_max: player.supply_max,
                        apm: player.apm,
                    })
                    .collect(),
                // Only a card that stands for a side has anything to sum: a half of a free-for-all
                // is players who happen to share a corner, not a side with totals of its own.
                totals: team.map(|team| team_totals(knobs, team, t)),
            })
            .collect(),
    }
}

/// What one side has between them.
fn team_totals(knobs: &Knobs, team: u8, t: f64) -> TeamCardTotalsView {
    let mut totals = TeamCardTotalsView::default();
    for index in knobs.side(team) {
        let (minerals, gas) = income(index, t);
        totals.minerals_per_minute += minerals;
        totals.gas_per_minute += gas;
        let (army_minerals, army_gas) = army(index, t);
        totals.army_minerals += army_minerals;
        totals.army_gas += army_gas;
        totals.workers += workers(index, t).0;
        let (killed, lost) = unit_trade(index, t);
        totals.units_killed += killed;
        totals.units_lost += lost;
    }
    totals
}

/// Supply as it is shown: what is used, and what there is room for.
fn supply(knobs: &Knobs, index: usize, t: f64) -> (u32, u32) {
    let used = ((9.0 + t / 5.5) as u32 + index as u32 * 3).min(200);
    // A block is supply that was there and is not any more — a razed depot, a dead overlord — which
    // is the only way used supply ends up over the cap.
    if knobs.supply_blocked && index == 0 {
        return (used, used.saturating_sub(2));
    }
    let slack = 6 + wave(index as f64, t, 0.05, 12.0);
    (used, (used + slack).min(200))
}

fn production_player(knobs: &Knobs, index: usize, t: f64) -> ProductionPlayerView {
    let units = race_units(knobs.race(index));
    let items = (0..knobs.production_depth)
        .map(|slot| {
            let unit = units[(slot + index) % units.len()];
            ProductionItemView {
                // Nothing here has the game's own icon atlas, so every tile draws its number: the
                // panel is being judged on its layout, and a tile that pretended to an icon it does
                // not have would be judging the wrong thing.
                icon: ProductionIcon {
                    texture: None,
                    index: unit,
                    size: None,
                    margin: 0.0,
                    wireframe: None,
                },
                count: 1 + ((t / 7.0) as u32 + slot as u32) % 4,
                progress: fraction(t * (0.13 + 0.05 * slot as f64) + index as f64 * 0.4),
            }
        })
        .collect();
    ProductionPlayerView {
        player_id: index as u8,
        team: knobs.team_of(index),
        color: overlay_ui::kit::theme::player_color(index),
        items,
    }
}

/// What a player has bound to their number keys: the first few of the ten, so the panel is judged
/// with empty slots on it as well as full ones.
///
/// Every form a slot takes is dealt to someone, because a panel that only ever showed armies of one
/// unit would be judged on the easy half of its job: two of the slots hold a building, which the
/// game only lets one of on a key and which is drawn without a count, and every fourth slot holds a
/// mix of two units, which is drawn as both.
fn control_groups_player(
    knobs: &Knobs,
    state: &State,
    index: usize,
    t: f64,
) -> ControlGroupsPlayerView {
    let units = race_units(knobs.race(index));
    let buildings = race_buildings(knobs.race(index));
    let icon = |id: u16| ProductionIcon {
        texture: None,
        index: id,
        size: None,
        margin: 0.0,
        wireframe: None,
    };
    let groups = (0..knobs.control_groups.min(10))
        .map(|slot| {
            let building = slot.checked_sub(BUILDING_SLOT).filter(|&of| of < 2);
            ControlGroupView {
                // Key `0` sits at the end of the number row, which is where the tenth group goes.
                key: ((slot + 1) % 10) as u8,
                icon: icon(match building {
                    Some(of) => buildings[of],
                    None => units[(slot + index) % units.len()],
                }),
                combo: (building.is_none() && slot % 4 == 3)
                    .then(|| icon(units[(slot + index + 1) % units.len()])),
                count: match building {
                    Some(_) => 1,
                    None => 1 + wave(slot as f64 * 1.9 + index as f64, t, 0.031, 11.0),
                },
                building: building.is_some(),
                // Every third group goes untouched, which is what proves a stale one is told apart
                // from a live one at a glance rather than only by reading it.
                stale: (slot + index) % 3 == 2,
            }
        })
        .collect();
    ControlGroupsPlayerView {
        player_id: index as u8,
        color: overlay_ui::kit::theme::player_color(index),
        vision: state.vision[index],
        groups,
    }
}

/// What the watcher has selected: units of the first player's own army, with health, shields and
/// energy that move the way a fight moves them.
///
/// Every reading the panel has is reachable from here, because each of them is a different layout:
/// no units at all, an army the panel draws as wireframes alone, one unit read out as numbers, a
/// building part way through something, an egg part way through its morph, a building with guns,
/// and a transport with an army inside it.
///
/// A selection of one is the only one whose numbers are read out, so it is dealt both a shield and
/// an energy pool: the rows only some units have are the ones a layout gets wrong.
fn selection(knobs: &Knobs, t: f64) -> SelectionView {
    let owner = 0;
    if knobs.selection_building {
        return SelectionView {
            units: vec![producing_building(knobs, owner, t)],
        };
    }
    if knobs.selection_cargo {
        return SelectionView {
            units: vec![loaded_transport(knobs, owner, t)],
        };
    }
    if knobs.selection_constructing {
        return SelectionView {
            units: vec![building_going_up(knobs, owner, t)],
        };
    }
    if knobs.selection_morphing {
        return SelectionView {
            units: vec![morphing_egg(knobs, owner, t)],
        };
    }
    if knobs.selection_defense {
        return SelectionView {
            units: vec![defense_building(knobs, owner, t)],
        };
    }
    let units = race_units(knobs.race(owner));
    let buildings = race_buildings(knobs.race(owner));
    let count = knobs.selection.min(SelectionView::MAX_UNITS);
    SelectionView {
        units: (0..count)
            .map(|index| {
                // A selection large enough to be an army has the building a player drags a box over
                // their own base to pick up, which has neither shields nor energy of its own.
                let building = index == BUILDING_SLOT && count > BUILDING_SLOT;
                let full_health = if building {
                    750
                } else {
                    80 + 40 * index as u32
                };
                let id = if building {
                    buildings[0]
                } else {
                    units[index % units.len()]
                };
                SelectedUnitView {
                    icon: unit_icon(id),
                    name: unit_name(id),
                    owner_color: overlay_ui::kit::theme::player_color(owner),
                    owner_name: player_name(knobs, owner),
                    owner: Some(owner as u8),
                    hit_points: (
                        wave(index as f64 * 1.3, t, 0.05, full_health as f64).max(1),
                        full_health,
                    ),
                    shields: (!building && index % 3 == 0)
                        .then(|| (wave(index as f64 * 2.2 + 1.0, t, 0.04, 80.0), 80)),
                    energy: (!building && index % 2 == 0)
                        .then(|| (wave(index as f64 * 1.7 + 2.0, t, 0.03, 200.0), 200)),
                    kills: (t / 31.0) as u32 + index as u32 * 2,
                    building,
                    production: None,
                    cargo: Vec::new(),
                    // Index 0 is dealt shields, so a lone unit carries the shields chip as well.
                    upgrades: if count == 1 && !building {
                        unit_upgrades(knobs.race(owner), index % 3 == 0)
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect(),
    }
}

/// One upgrade of the fake game's: the frame its icon would be drawn from, the level it has
/// reached, and the name the game's English stat_txt gives it.
type Upgrade = (u16, u8, &'static str);

/// What a lone unit of each race fights with: its armor, its weapons, and the weapon those improve
/// with what one hit of it deals and how many hits an attack is. The icon frames are stand-ins,
/// since nothing here has the game's atlas to draw them from.
struct RaceUpgrades {
    armor: (Upgrade, u32),
    weapons: (Upgrade, &'static str, u32, u32),
}

const ZERG_UPGRADES: RaceUpgrades = RaceUpgrades {
    armor: ((0x11c, 2, "Zerg Carapace"), 0),
    weapons: ((0x121, 1, "Zerg Melee Attacks"), "Spines", 5, 1),
};
const TERRAN_UPGRADES: RaceUpgrades = RaceUpgrades {
    armor: ((0x118, 1, "Terran Infantry Armor"), 0),
    weapons: ((0x11f, 1, "Terran Infantry Weapons"), "Gauss Rifle", 6, 1),
};
const PROTOSS_UPGRADES: RaceUpgrades = RaceUpgrades {
    armor: ((0x11d, 1, "Protoss Ground Armor"), 1),
    weapons: ((0x125, 2, "Protoss Ground Weapons"), "Psi Blades", 8, 2),
};

/// The plasma shields every unit with shields is dealt, which nobody has started on.
const PLASMA_SHIELDS: Upgrade = (0x12a, 0, "Protoss Plasma Shields");

/// The upgrades a lone unit of `race` fights with, in the order the game DLL lists them: armor,
/// shields for a unit that has any, then weapons.
fn unit_upgrades(race: RaceView, shields: bool) -> Vec<UnitUpgradeView> {
    let upgrades = match race {
        RaceView::Zerg => ZERG_UPGRADES,
        RaceView::Terran => TERRAN_UPGRADES,
        RaceView::Protoss | RaceView::Random => PROTOSS_UPGRADES,
    };
    let view = |(frame, level, name): Upgrade, effect| UnitUpgradeView {
        icon: unit_icon(frame),
        level,
        name: Some(name.to_string()),
        effect,
    };
    let ((armor, base), (weapons, weapon, damage, hits)) = (upgrades.armor, upgrades.weapons);
    let mut views = vec![view(
        armor,
        UpgradeEffect::Armor {
            base,
            bonus: u32::from(armor.1),
        },
    )];
    if shields {
        views.push(view(PLASMA_SHIELDS, UpgradeEffect::Shields));
    }
    views.push(view(
        weapons,
        UpgradeEffect::Damage(vec![WeaponDamageView {
            name: Some(weapon.to_string()),
            base: damage,
            bonus: u32::from(weapons.1),
            hits,
        }]),
    ));
    views
}

/// The upgrades a building of `race` fights with, in the order the game DLL lists them: no armor,
/// since a building has none to upgrade, then shields where the race has any, then `weapons`, each
/// the weapon's name with what one hit of it deals.
fn building_upgrades(race: RaceView, weapons: &[(&'static str, u32)]) -> Vec<UnitUpgradeView> {
    let upgrades = match race {
        RaceView::Zerg => ZERG_UPGRADES,
        RaceView::Terran => TERRAN_UPGRADES,
        RaceView::Protoss | RaceView::Random => PROTOSS_UPGRADES,
    };
    let mut views = Vec::new();
    if has_shields(race) {
        let (frame, level, name) = PLASMA_SHIELDS;
        views.push(UnitUpgradeView {
            icon: unit_icon(frame),
            level,
            name: Some(name.to_string()),
            effect: UpgradeEffect::Shields,
        });
    }
    // Static defense takes none of the race's weapon upgrades: its weapons read level 0, under the
    // icon of the race's own weapon upgrade standing in for the weapon's.
    let ((frame, _, _), _, _, _) = upgrades.weapons;
    views.extend(weapons.iter().map(|&(name, damage)| UnitUpgradeView {
        icon: unit_icon(frame),
        level: 0,
        name: Some(name.to_string()),
        effect: UpgradeEffect::Damage(vec![WeaponDamageView {
            name: Some(name.to_string()),
            base: damage,
            bonus: 0,
            hits: 1,
        }]),
    }));
    views
}

/// A building of the first player's, part way through a unit with more of them queued behind it.
///
/// Shields only where the race has any, which is what proves the panel packs the rows a thing
/// actually has rather than leaving a gap where every other one's would be.
fn producing_building(knobs: &Knobs, owner: usize, t: f64) -> SelectedUnitView {
    let race = knobs.race(owner);
    let full_health = 1250;
    SelectedUnitView {
        icon: unit_icon(race_buildings(race)[0]),
        name: unit_name(race_buildings(race)[0]),
        owner_color: overlay_ui::kit::theme::player_color(owner),
        owner_name: player_name(knobs, owner),
        owner: Some(owner as u8),
        hit_points: (full_health - wave(0.0, t, 0.05, 300.0), full_health),
        shields: has_shields(race).then(|| (wave(1.0, t, 0.04, 450.0), 450)),
        energy: None,
        kills: 0,
        building: true,
        production: Some(ProductionProgressView {
            icon: unit_icon(race_units(race)[0]),
            name: unit_name(race_units(race)[0]),
            progress: fraction(t * 0.09),
            queue: Some(
                race_units(race)
                    .iter()
                    .take(QUEUED_UNITS)
                    .map(|&index| unit_icon(index))
                    .collect(),
            ),
            is_subject: false,
        }),
        cargo: Vec::new(),
        // Dealt as the game DLL deals them, which is what proves a queue leaves no row for them.
        upgrades: building_upgrades(race, &[]),
    }
}

/// A production building of the first player's that is itself still going up, its hit points
/// climbing with it the way a building's do while it is built.
fn building_going_up(knobs: &Knobs, owner: usize, t: f64) -> SelectedUnitView {
    let race = knobs.race(owner);
    let building = race_buildings(race)[0];
    let progress = fraction(t * 0.05);
    let full_health = 1000;
    SelectedUnitView {
        icon: unit_icon(building),
        name: unit_name(building),
        owner_color: overlay_ui::kit::theme::player_color(owner),
        owner_name: player_name(knobs, owner),
        owner: Some(owner as u8),
        hit_points: (
            (full_health as f32 * (0.1 + 0.9 * progress)) as u32,
            full_health,
        ),
        shields: has_shields(race).then_some(((500.0 * progress) as u32, 500)),
        energy: None,
        kills: 0,
        building: true,
        production: Some(ProductionProgressView {
            icon: unit_icon(building),
            name: unit_name(building),
            progress,
            queue: None,
            is_subject: true,
        }),
        cargo: Vec::new(),
        upgrades: building_upgrades(race, &[]),
    }
}

/// An egg of the first player's, part way through its morph into the race's second unit.
///
/// The egg is dealt the carapace the race's units are, at the level they have it: an egg is armored
/// by the same upgrade, and the console reads it out as the egg's own.
fn morphing_egg(knobs: &Knobs, owner: usize, t: f64) -> SelectedUnitView {
    let target = race_units(RaceView::Zerg)[2];
    let ((frame, level, name), _) = ZERG_UPGRADES.armor;
    SelectedUnitView {
        icon: unit_icon(ZERG_EGG),
        name: unit_name(ZERG_EGG),
        owner_color: overlay_ui::kit::theme::player_color(owner),
        owner_name: player_name(knobs, owner),
        owner: Some(owner as u8),
        hit_points: (200, 200),
        shields: None,
        energy: None,
        kills: 0,
        building: false,
        production: Some(ProductionProgressView {
            icon: unit_icon(target),
            name: unit_name(target),
            progress: fraction(t * 0.07),
            queue: None,
            is_subject: false,
        }),
        cargo: Vec::new(),
        upgrades: vec![UnitUpgradeView {
            icon: unit_icon(frame),
            level,
            name: Some(name.to_string()),
            effect: UpgradeEffect::Armor {
                base: 10,
                bonus: u32::from(level),
            },
        }],
    }
}

/// A building of the first player's that defends with guns of its own, idle: for a race with
/// shields, the reading with every chip a building can have.
fn defense_building(knobs: &Knobs, owner: usize, t: f64) -> SelectedUnitView {
    let race = knobs.race(owner);
    let (id, full_health, weapons): (u16, u32, &[(&'static str, u32)]) = match race {
        RaceView::Zerg => (ZERG_DEFENSE, 300, &[("Subterranean Tentacle", 40)]),
        RaceView::Terran => (TERRAN_DEFENSE, 200, &[("Longbolt Missile", 20)]),
        RaceView::Protoss | RaceView::Random => (
            PROTOSS_DEFENSE,
            100,
            &[("STS Photon Cannon", 20), ("STS Photon Cannon", 20)],
        ),
    };
    SelectedUnitView {
        icon: unit_icon(id),
        name: unit_name(id),
        owner_color: overlay_ui::kit::theme::player_color(owner),
        owner_name: player_name(knobs, owner),
        owner: Some(owner as u8),
        hit_points: (
            full_health - wave(0.0, t, 0.05, full_health as f64 * 0.4),
            full_health,
        ),
        shields: has_shields(race).then(|| (wave(1.0, t, 0.04, 100.0), 100)),
        energy: None,
        kills: 0,
        building: true,
        production: None,
        cargo: Vec::new(),
        upgrades: building_upgrades(race, weapons),
    }
}

/// A transport of the first player's with an army inside it.
///
/// The carried units are dealt fixed fractions of their health rather than the moving ones the rest
/// of the fake game runs on, because what the row is here to prove is the tints: one of them is
/// whole, one is hurt, one is nearly dead, and the panel has to draw three different colors.
fn loaded_transport(knobs: &Knobs, owner: usize, t: f64) -> SelectedUnitView {
    const CARGO_HEALTH: [f32; CARGO_UNITS] = [1.0, 0.6, 0.25, 0.85];

    let race = knobs.race(owner);
    let units = race_units(race);
    let full_health = 150;
    SelectedUnitView {
        icon: unit_icon(race_transport(race)),
        name: unit_name(race_transport(race)),
        owner_color: overlay_ui::kit::theme::player_color(owner),
        owner_name: player_name(knobs, owner),
        owner: Some(owner as u8),
        hit_points: (full_health - wave(0.0, t, 0.06, 60.0), full_health),
        shields: has_shields(race).then(|| (wave(2.0, t, 0.05, 80.0), 80)),
        energy: None,
        kills: 0,
        building: false,
        production: None,
        cargo: CARGO_HEALTH
            .iter()
            .enumerate()
            .map(|(slot, left)| {
                let full_health = 80 + 20 * slot as u32;
                SelectedUnitView {
                    icon: unit_icon(units[slot % units.len()]),
                    name: unit_name(units[slot % units.len()]),
                    owner_color: overlay_ui::kit::theme::player_color(owner),
                    owner_name: player_name(knobs, owner),
                    owner: Some(owner as u8),
                    hit_points: ((full_health as f32 * left) as u32, full_health),
                    shields: None,
                    energy: None,
                    kills: 0,
                    building: false,
                    production: None,
                    cargo: Vec::new(),
                    upgrades: Vec::new(),
                }
            })
            .collect(),
        upgrades: Vec::new(),
    }
}

/// What a player of this race carries their army around in.
fn race_transport(race: RaceView) -> u16 {
    match race {
        RaceView::Zerg => ZERG_TRANSPORT,
        RaceView::Terran => TERRAN_TRANSPORT,
        RaceView::Protoss | RaceView::Random => PROTOSS_TRANSPORT,
    }
}

/// Whether this race's units and buildings carry shields, which is the row only one of the three
/// races has.
fn has_shields(race: RaceView) -> bool {
    matches!(race, RaceView::Protoss | RaceView::Random)
}

/// Where SC:R puts the minimap for a watcher: the square of the console's own minimap, in the
/// screen's bottom-left corner, which the console scales with the screen's height.
pub fn minimap_square(screen: Rect) -> Rect {
    let side = MINIMAP_UNITS * screen.height() / DESIGN_HEIGHT;
    Rect::from_min_size(
        pos2(screen.left(), screen.bottom() - side),
        vec2(side, side),
    )
}

/// The side of the minimap's square at the design's 1080 points of height.
const MINIMAP_UNITS: f32 = 348.0;
const DESIGN_HEIGHT: f32 = 1080.0;

/// Paints something where the game's minimap would be, under the overlay, so the frame the overlay
/// draws around it is judged against a square that is there: dark ground with a few patches of
/// terrain and the screen box, which is the shape a minimap reads as at a glance.
pub fn paint_minimap_stand_in(ctx: &egui::Context, square: Rect) {
    let painter = ctx.layer_painter(egui::LayerId::new(
        egui::Order::Background,
        egui::Id::new("minimap_stand_in"),
    ));
    painter.rect_filled(square, 0.0, Color32::from_rgb(0x0c, 0x10, 0x0e));
    let unit = square.width() / 12.0;
    for (x, y, w, h) in [
        (1.0, 1.0, 3.0, 2.0),
        (7.5, 1.5, 3.0, 3.0),
        (4.5, 5.0, 3.0, 2.5),
        (1.5, 8.5, 3.5, 2.5),
        (8.0, 8.0, 2.5, 3.0),
    ] {
        painter.rect_filled(
            Rect::from_min_size(
                square.min + vec2(x * unit, y * unit),
                vec2(w * unit, h * unit),
            ),
            2.0,
            Color32::from_rgb(0x2a, 0x33, 0x27),
        );
    }
    painter.rect_stroke(
        Rect::from_min_size(
            square.min + vec2(4.0 * unit, 3.5 * unit),
            vec2(3.0 * unit, 2.0 * unit),
        ),
        0.0,
        egui::Stroke::new(1.0, Color32::WHITE),
        egui::StrokeKind::Inside,
    );
}

/// A tile's icon. Nothing here has the game's own icon atlas, so every tile draws its number: these
/// panels are being judged on their layout, and a tile that pretended to an icon it does not have
/// would be judging the wrong thing.
fn unit_icon(index: u16) -> ProductionIcon {
    ProductionIcon {
        texture: None,
        index,
        size: None,
        margin: 0.0,
        wireframe: None,
    }
}

/// A number that rises and falls over `scale`, so a panel is judged against values that move the
/// way a game's do rather than against one frozen sample.
fn wave(phase: f64, t: f64, rate: f64, scale: f64) -> u32 {
    let cycle = ((t * rate + phase).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
    (cycle * scale) as u32
}

/// The fractional part of a count, which is how far along something repeating is.
fn fraction(value: f64) -> f32 {
    (value - value.floor()) as f32
}

/// How much of the overlay a preset puts on screen at once.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    /// The game and as little else as possible: the matchup bar, the minimap and the plate.
    Minimal,
    /// A caster's working set: the minimal screen with the economy, production, control groups and
    /// selection panels added.
    Standard,
    /// Every panel the overlay has.
    Analyst,
    /// The analyst's screen with the upper stats wings and the dock hidden, so the panels under
    /// the wings are drawn where the wings would have been, and the right-hand ones against the
    /// edge the dock has left.
    ReflowWings,
    /// The analyst's screen with the lower half of the centred stack hidden, so the panels over it
    /// are drawn against the screen's own bottom edge.
    ReflowStack,
}

impl Screen {
    /// Moves `prefs` to this screen's set of surfaces, leaving the dock where the watcher put it
    /// unless the screen is about the dock being gone.
    fn apply(self, prefs: &mut PanelPrefs) {
        // Everything a minimal screen gives up, and the part of it a standard one keeps.
        let analysis = self != Screen::Minimal;
        let deep = analysis && self != Screen::Standard;
        prefs.matchup = true;
        prefs.minimap = true;
        prefs.transport = true;
        prefs.map_control = deep;
        prefs.economy = analysis;
        prefs.military = deep;
        prefs.graphs = deep;
        prefs.timeline = deep;
        prefs.production = analysis;
        prefs.control_groups = analysis;
        prefs.selection = analysis;
        // Each reflow screen is the analyst's with a hole in it, which is what the panels around
        // the hole are meant to close up into.
        match self {
            Screen::ReflowWings => {
                prefs.economy = false;
                prefs.military = false;
                prefs.dock = false;
            }
            Screen::ReflowStack => {
                prefs.production = false;
                prefs.selection = false;
            }
            _ => {}
        }
    }

    /// What a render of this screen is filed under.
    fn slug(self) -> &'static str {
        match self {
            Screen::Minimal => "minimal",
            Screen::Standard => "standard",
            Screen::Analyst => "analyst",
            // The two reflow screens are takes on one another, so they are filed as a pair rather
            // than each named after the panels it happens to hide.
            Screen::ReflowWings => "reflow-a",
            Screen::ReflowStack => "reflow-b",
        }
    }
}

/// Which of the selection panel's own readings a preset puts the fake game into.
///
/// The panel draws a different layout for each of them, and the readings a game only reaches by
/// clicking the right thing are the ones an offline render would otherwise never cover.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Showcase {
    /// Whatever the scenario's knobs already ask for, which is the single unit they default to.
    Knobs,
    /// A building part way through making a unit, with more of them queued behind it.
    Producing,
    /// A transport with an army inside it.
    Loaded,
    /// A building that is itself still going up.
    Constructing,
    /// An egg part way through its morph.
    Morphing,
    /// A building with guns of its own, with nothing on the way.
    Defense,
    /// The single unit the knobs default to, with the list of players under the minimap's vision
    /// button open.
    VisionPicker,
}

/// Where along the replay plate's track the marker hover rests, as the plate stands on the duel's
/// analyst screen: on a tick well clear of the playhead, so the card is not read against its glow.
const TRACK_MARKER_X: f32 = 1640.0;

/// Where the weapon upgrade of the lone unit the selection panel reads out sits on the duel's
/// analyst screen: the third chip, after its armor and its shields.
const UPGRADE_CHIP_X: f32 = 1331.0;
const UPGRADE_CHIP_Y: f32 = 1040.0;

/// Where a preset rests the pointer, for the readings the overlay only gives while it is hovered.
///
/// An offline render has no pointer of its own, so a screen whose whole point is what the pointer
/// is over has to say where it is. The points are the design's own 1920x1080 ones, which is the
/// space every render size is laid out in.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Hover {
    /// Nowhere: every screen that is only being read.
    None,
    /// Over the graphs plot, where the crosshair and its card are.
    Graphs,
    /// Over the economy row's keycap on the collapsed dock.
    DockEconomy,
    /// Over one of the timeline's rows, which in a replay says what clicking it does.
    TimelineRow,
    /// Over one of the markers ticked along the replay plate's track.
    TrackMarker,
    /// Over the weapon upgrade of the unit the selection panel reads out, which names it, its
    /// level and the damage it comes to.
    UpgradeChip,
}

impl Hover {
    /// Where the pointer rests, in the emulated screen's points.
    fn point(self) -> Option<(f32, f32)> {
        match self {
            Hover::None => None,
            Hover::Graphs => Some((1550.0, 380.0)),
            Hover::DockEconomy => Some((1878.0, 402.0)),
            Hover::TimelineRow => Some((250.0, 336.0)),
            Hover::TrackMarker => Some((TRACK_MARKER_X, 996.0)),
            Hover::UpgradeChip => Some((UPGRADE_CHIP_X, UPGRADE_CHIP_Y)),
        }
    }

    /// What a render of this pointer is filed under.
    fn slug(self) -> &'static str {
        match self {
            Hover::None => "",
            Hover::Graphs => "graph-hover",
            Hover::DockEconomy => "dock-hover",
            Hover::TimelineRow => "timeline-hover",
            Hover::TrackMarker => "marker-hover",
            Hover::UpgradeChip => "upgrade-hover",
        }
    }
}

/// A one-click state of the observer panels: one shape of game, one set of surfaces.
#[derive(Clone, Copy)]
pub struct Preset {
    /// How many players the game has, which together with the size of a side is what decides
    /// whether it is read from the bar's two halves, its stacked ones, or the corner cards.
    pub players: usize,
    /// How many players a side holds, one being a free-for-all.
    pub team_size: usize,
    pub panels: Screen,
    pub showcase: Showcase,
    pub hover: Hover,
}

impl Preset {
    /// One shape of game on one set of surfaces, with the selection the knobs' own.
    pub const fn game(players: usize, team_size: usize, panels: Screen) -> Preset {
        Preset {
            players,
            team_size,
            panels,
            showcase: Showcase::Knobs,
            hover: Hover::None,
        }
    }

    /// A duel on the analyst's screen, there to put the selection panel into one of its readings.
    const fn selection_showcase(showcase: Showcase) -> Preset {
        Preset {
            players: 2,
            team_size: 1,
            panels: Screen::Analyst,
            showcase,
            hover: Hover::None,
        }
    }

    /// A duel on the analyst's screen with the pointer resting on something, there to show what the
    /// overlay only says while it is being pointed at.
    const fn hover_showcase(hover: Hover) -> Preset {
        Preset {
            players: 2,
            team_size: 1,
            panels: Screen::Analyst,
            showcase: Showcase::Knobs,
            hover,
        }
    }

    pub const ALL: [Preset; 30] = [
        Preset::game(2, 1, Screen::Minimal),
        Preset::game(2, 1, Screen::Standard),
        Preset::game(2, 1, Screen::Analyst),
        // The reflow screens are dealt to the duel alone, which is the shape with the room to read
        // the move each of them is about off.
        Preset::game(2, 1, Screen::ReflowWings),
        Preset::game(2, 1, Screen::ReflowStack),
        // An odd number of players, which is what leaves the stacked bar a slot short, and the
        // same three with nobody allied, which is what leaves its halves standing for no side.
        Preset::game(3, 2, Screen::Standard),
        Preset::game(3, 1, Screen::Standard),
        Preset::game(4, 2, Screen::Minimal),
        Preset::game(4, 2, Screen::Standard),
        Preset::game(4, 2, Screen::Analyst),
        Preset::game(6, 3, Screen::Minimal),
        Preset::game(6, 3, Screen::Standard),
        Preset::game(6, 3, Screen::Analyst),
        // Two sides a player apart, which the production panel splits into a column for each side
        // rather than into two even ones.
        Preset::game(7, 4, Screen::Analyst),
        // A free-for-all and a game of four sides: both are read from cards the game names no side
        // for, which is what the unlabelled card is drawn for.
        Preset::game(6, 1, Screen::Analyst),
        Preset::game(8, 2, Screen::Analyst),
        Preset::game(8, 4, Screen::Minimal),
        Preset::game(8, 4, Screen::Standard),
        Preset::game(8, 4, Screen::Analyst),
        Preset::selection_showcase(Showcase::Producing),
        Preset::selection_showcase(Showcase::Loaded),
        Preset::selection_showcase(Showcase::Constructing),
        Preset::selection_showcase(Showcase::Morphing),
        Preset::selection_showcase(Showcase::Defense),
        // The vision list is shown over a team game, which is the one with a list worth reading.
        Preset {
            players: 4,
            team_size: 2,
            panels: Screen::Analyst,
            showcase: Showcase::VisionPicker,
            hover: Hover::None,
        },
        Preset::hover_showcase(Hover::Graphs),
        Preset::hover_showcase(Hover::DockEconomy),
        Preset::hover_showcase(Hover::TimelineRow),
        Preset::hover_showcase(Hover::TrackMarker),
        Preset::hover_showcase(Hover::UpgradeChip),
    ];

    /// What a render of this preset is filed under: the shape of its game, then its screen.
    pub fn label(self) -> String {
        match self.showcase {
            Showcase::Producing => return "1v1-selection-building".to_string(),
            Showcase::Loaded => return "1v1-selection-cargo".to_string(),
            Showcase::Constructing => return "1v1-selection-constructing".to_string(),
            Showcase::Morphing => return "1v1-selection-morphing".to_string(),
            Showcase::Defense => return "1v1-selection-defense".to_string(),
            Showcase::VisionPicker => return format!("{}-vision-picker", self.shape()),
            Showcase::Knobs => {}
        }
        if self.hover != Hover::None {
            return format!("{}-{}", self.shape(), self.hover.slug());
        }
        format!("{}-{}", self.shape(), self.panels.slug())
    }

    /// What this preset's game is called. Two players are a duel however the game has them lined
    /// up; a game where everyone is their own side is named after how many of them there are; two
    /// even sides after the size of one, and more even sides than that after how many there are.
    /// Anything left over is named after its players alone, having no shape a name would fit.
    fn shape(self) -> String {
        if self.players == 2 {
            return "1v1".to_string();
        }
        if self.team_size == 1 {
            return format!("{}ffa", self.players);
        }
        if !self.players.is_multiple_of(self.team_size) {
            return format!("{}p", self.players);
        }
        match self.players / self.team_size {
            2 => format!("{}v{}", self.team_size, self.team_size),
            teams => format!("{teams}teams"),
        }
    }

    /// Presets the fake game, the panel set, and the vantage point the panels are watched from.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.mode = overlay_ui::shell::Mode::Replay;
        self.panels.apply(&mut knobs.host.panels);
        // The dock's two forms are both worth looking at, and the screen that asks for everything
        // is the one whose watcher wants the rail spelled out. A screen about what the pointer is
        // over takes the strip of keycaps instead, since that is the form with anything left to say.
        knobs.host.panels.dock_expanded =
            self.panels == Screen::Analyst && self.hover == Hover::None;
        knobs.host.pointer = self.hover.point();
        knobs.observer = Knobs {
            players: self.players,
            team_size: self.team_size,
            selection_building: self.showcase == Showcase::Producing,
            selection_cargo: self.showcase == Showcase::Loaded,
            selection_constructing: self.showcase == Showcase::Constructing,
            selection_morphing: self.showcase == Showcase::Morphing,
            selection_defense: self.showcase == Showcase::Defense,
            vision_picker: self.showcase == Showcase::VisionPicker,
            ..Knobs::default()
        };
        // The buildings with chips to read out are the Protoss ones, whose shields every one of
        // them has, so the readings of a building are watched from a Protoss player's side.
        if matches!(self.showcase, Showcase::Constructing | Showcase::Defense) {
            knobs.observer.races[0] = RaceView::Protoss;
        }
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(k: &mut Knobs, state: &State, ui: &mut egui::Ui) -> bool {
    let mut changed = false;

    ui.label(
        "Which panels are up is the shell's: the dock's own rows and the panel checkboxes above \
         move that.",
    );

    changed |= ui
        .add(egui::Slider::new(&mut k.start_secs, 0..=5400).text("clock start (s)"))
        .changed();
    changed |= ui
        .add(egui::Slider::new(&mut k.players, 2..=MAX_PLAYERS).text("players"))
        .on_hover_text(
            "Two players get the matchup bar's halves, up to two a half get its stacked form, and \
             anything wider gets the corner team cards with the clock alone between them.",
        )
        .changed();
    changed |= ui
        .add(egui::Slider::new(&mut k.team_size, 1..=MAX_PLAYERS).text("players a side"))
        .on_hover_text(
            "How many players a side holds, dealt out in slot order. One is a free-for-all, and a \
             size that does not divide the players leaves the last side short, the way three \
             players at two a side are two against one.",
        )
        .changed();
    k.fill_races();
    for index in 0..k.player_count() {
        let name = NAMES[index % NAMES.len()];
        let team = k.team_of(index);
        ui.horizontal(|ui| {
            ui.label(format!("{name} (team {team}):"));
            for option in RaceView::ALL {
                changed |= ui
                    .selectable_value(&mut k.races[index], option, option.label())
                    .changed();
            }
        });
    }
    changed |= ui
        .checkbox(&mut k.supply_blocked, "supply blocked")
        .on_hover_text(
            "Puts the left player's used supply over their cap, the way a razed depot does.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.long_names, "longest names")
        .on_hover_text("Gives every player the longest name the game allows.")
        .changed();
    changed |= ui
        .add(egui::Slider::new(&mut k.production_depth, 0..=16).text("production entries"))
        .changed();
    changed |= ui
        .add(egui::Slider::new(&mut k.control_groups, 0..=10).text("control groups"))
        .on_hover_text("How many of the ten number keys each player has something on.")
        .changed();
    changed |= ui
        .add(egui::Slider::new(&mut k.selection, 0..=SelectionView::MAX_UNITS).text("selection"))
        .on_hover_text(
            "How many units the watcher has selected. One is read out as numbers, several are the \
             wireframe grid alone, and none leaves the panel on screen saying so.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.selection_building, "selection is producing")
        .on_hover_text(
            "Selects a building part way through a unit with two more queued, which leaves no room \
             for the building's upgrades.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.selection_cargo, "selection is loaded")
        .on_hover_text(
            "Selects a transport with four units inside it at mixed health, which is what the row \
             of carried units is drawn for.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.selection_constructing, "selection is going up")
        .on_hover_text(
            "Selects a building that is itself still being built, which names the building once \
             and reads its progress as its own.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.selection_morphing, "selection is morphing")
        .on_hover_text(
            "Selects an egg part way through its morph, which has one slot of what it is turning \
             into and its carapace under that.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.selection_defense, "selection is static defense")
        .on_hover_text(
            "Selects the first player's static defense with nothing on the way, which reads out \
             its shields and its guns.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.vision_picker, "vision list open")
        .on_hover_text(
            "Opens the list of players under the minimap's vision button when the scenario \
             starts, the state the button's click leaves it in.",
        )
        .changed();
    changed |= ui
        .checkbox(&mut k.map_control, "reports map control")
        .on_hover_text(
            "The real game has no map-control measurement yet. With this off the bar is not drawn \
             and its dock row is not offered, which is what a game without one looks like.",
        )
        .changed();

    ui.add_space(4.0);
    ui.label("Click a player on the bar to take their vision; click a production tile to select what is making it.");
    match state.last_selection {
        Some((player_id, item)) => {
            ui.weak(format!("last selected: player {player_id}, entry {item}"))
        }
        None => ui.weak("no production tile clicked yet"),
    };

    changed
}
