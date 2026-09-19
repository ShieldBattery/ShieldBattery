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
//! same fake game drives a duel, two sides of two and two sides of four. What changes with the
//! count is which surfaces the game has: a duel is read from the matchup bar, four players from the
//! stacked one, and anything larger from the corner team cards.

use overlay_ui::observer::{
    ControlGroupView, ControlGroupsPlayerView, ControlGroupsView, EconomyPlayerView, EconomyView,
    GraphGrouping, GraphLineView, GraphSeries, GraphsView, MapControlSideView, MapControlView,
    MatchupPlayerView, MatchupView, MilitaryPlayerView, MilitaryView, ObserverView, ProductionIcon,
    ProductionItemView, ProductionPlayerView, ProductionProgressView, ProductionView, RaceView,
    SelectedUnitView, SelectionView, TeamCardPlayerView, TeamCardTotalsView, TeamCardView,
    TeamCardsView, TimelineEventKind, TimelineEventView, TimelineView, team_name,
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

/// How many events the fake game keeps. More than the panel draws, so a host that grew the feed
/// would have something to grow it with.
const TIMELINE_DEPTH: usize = 12;

/// The number of players a game has to reach before the matchup bar gives its halves up to the
/// corner team cards.
const TEAM_CARD_PLAYERS: usize = 5;

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

/// How many units the loaded transport is carrying, which is short of the eight one holds: a row
/// drawn to its last slot would not say whether the panel draws the room or only what is in it.
const CARGO_UNITS: usize = 4;

/// How many more units the producing building has waiting behind the one on the way.
const QUEUED_UNITS: u32 = 2;

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
    /// How many players the fake game has. Split down the middle into two sides, which is what the
    /// bar's two forms and the corner cards are all shapes of.
    pub players: usize,
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
    /// Whether the game reports how much of the map each side holds. The real game has no such
    /// measurement yet, so this is the switch that proves the bar disappears without one rather
    /// than drawing an empty share.
    pub map_control: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            start_secs: 612,
            players: 2,
            races: vec![
                RaceView::Zerg,
                RaceView::Terran,
                RaceView::Protoss,
                RaceView::Zerg,
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
            map_control: true,
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

    /// Which side a player is on. The first half of the slots are one side and the rest the other,
    /// which is how a lobby lays a team game out.
    fn team_of(&self, index: usize) -> u8 {
        if index < self.player_count() / 2 {
            1
        } else {
            2
        }
    }

    /// The slots on one side, in slot order.
    fn side(&self, team: u8) -> Vec<usize> {
        (0..self.player_count())
            .filter(|index| self.team_of(*index) == team)
            .collect()
    }

    /// Whether this game is read from the corner cards rather than from the bar's own halves.
    fn has_team_cards(&self) -> bool {
        self.player_count() >= TEAM_CARD_PLAYERS
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
}

impl State {
    pub fn new() -> State {
        State {
            vision: [true; MAX_PLAYERS],
            last_selection: None,
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
        team_cards: knobs
            .has_team_cards()
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
    let has_teams = knobs.player_count() > 2;
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
        [1u8, 2]
            .into_iter()
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
                }),
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

/// The two corner cards, built from the same players the bar would have carried.
fn team_cards(knobs: &Knobs, matchup: &MatchupView, t: f64) -> TeamCardsView {
    TeamCardsView {
        teams: matchup
            .sides()
            .into_iter()
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
                totals: team_totals(knobs, team, t),
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
                },
                count: 1 + ((t / 7.0) as u32 + slot as u32) % 4,
                progress: fraction(t * (0.13 + 0.05 * slot as f64) + index as f64 * 0.4),
            }
        })
        .collect();
    ProductionPlayerView {
        player_id: index as u8,
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
        name: player_name(knobs, index),
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
/// building part way through something, and a transport with an army inside it.
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
                SelectedUnitView {
                    icon: ProductionIcon {
                        texture: None,
                        index: if building {
                            buildings[0]
                        } else {
                            units[index % units.len()]
                        },
                    },
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
                }
            })
            .collect(),
    }
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
            progress: fraction(t * 0.09),
            queued: QUEUED_UNITS,
        }),
        cargo: Vec::new(),
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
                }
            })
            .collect(),
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

/// A tile's icon. Nothing here has the game's own icon atlas, so every tile draws its number: these
/// panels are being judged on their layout, and a tile that pretended to an icon it does not have
/// would be judging the wrong thing.
fn unit_icon(index: u16) -> ProductionIcon {
    ProductionIcon {
        texture: None,
        index,
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
    /// Every panel the overlay has, over the game's own console.
    Standard,
    /// Every panel with the game's console hidden, which is where our own bottom panels have the
    /// room the design draws them in.
    Analyst,
    /// The analyst's screen with the upper stats wings hidden, so the panels under them are drawn
    /// where the wings would have been.
    ReflowWings,
    /// The analyst's screen with the lower half of the centred stack hidden, so the panels over it
    /// are drawn against the screen's own bottom edge.
    ReflowStack,
}

impl Screen {
    /// Moves `prefs` to this screen's set of surfaces, leaving the dock where the watcher put it.
    fn apply(self, prefs: &mut PanelPrefs) {
        // Everything a minimal screen gives up.
        let analysis = self != Screen::Minimal;
        prefs.matchup = true;
        prefs.minimap = true;
        prefs.transport = true;
        prefs.map_control = analysis;
        prefs.economy = analysis;
        prefs.military = analysis;
        prefs.graphs = analysis;
        prefs.timeline = analysis;
        prefs.production = analysis;
        prefs.control_groups = analysis;
        prefs.selection = analysis;
        prefs.console = self == Screen::Standard;
        // Each reflow screen is the analyst's with a hole in it, which is what the panels around
        // the hole are meant to close up into.
        match self {
            Screen::ReflowWings => {
                prefs.economy = false;
                prefs.military = false;
            }
            Screen::ReflowStack => {
                prefs.production = false;
                prefs.selection = false;
            }
            _ => {}
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
}

/// A one-click state of the observer panels: one shape of game, one set of surfaces.
#[derive(Clone, Copy)]
pub struct Preset {
    /// How many players the game has, which is what decides whether it is read from the bar's two
    /// halves, its stacked ones, or the corner cards.
    pub players: usize,
    pub panels: Screen,
    pub showcase: Showcase,
}

impl Preset {
    /// One shape of game on one set of surfaces, with the selection the knobs' own.
    pub const fn game(players: usize, panels: Screen) -> Preset {
        Preset {
            players,
            panels,
            showcase: Showcase::Knobs,
        }
    }

    /// A duel on the analyst's screen, there to put the selection panel into one of its readings.
    const fn selection_showcase(showcase: Showcase) -> Preset {
        Preset {
            players: 2,
            panels: Screen::Analyst,
            showcase,
        }
    }

    pub const ALL: [Preset; 16] = [
        Preset::game(2, Screen::Minimal),
        Preset::game(2, Screen::Standard),
        Preset::game(2, Screen::Analyst),
        Preset::game(2, Screen::ReflowWings),
        Preset::game(2, Screen::ReflowStack),
        Preset::game(4, Screen::Minimal),
        Preset::game(4, Screen::Standard),
        Preset::game(4, Screen::Analyst),
        Preset::game(6, Screen::Minimal),
        Preset::game(6, Screen::Standard),
        Preset::game(6, Screen::Analyst),
        Preset::game(8, Screen::Minimal),
        Preset::game(8, Screen::Standard),
        Preset::game(8, Screen::Analyst),
        Preset::selection_showcase(Showcase::Producing),
        Preset::selection_showcase(Showcase::Loaded),
    ];

    pub fn label(self) -> &'static str {
        match self.showcase {
            Showcase::Producing => return "1v1-selection-building",
            Showcase::Loaded => return "1v1-selection-cargo",
            Showcase::Knobs => {}
        }
        match (self.players, self.panels) {
            (2, Screen::Minimal) => "1v1-minimal",
            (2, Screen::Standard) => "1v1-standard",
            (2, Screen::Analyst) => "1v1-analyst",
            // The reflow screens are dealt to the duel alone, which is the shape with the room to
            // read the move each of them is about off.
            (_, Screen::ReflowWings) => "1v1-reflow-a",
            (_, Screen::ReflowStack) => "1v1-reflow-b",
            (4, Screen::Minimal) => "2v2-minimal",
            (4, Screen::Standard) => "2v2-standard",
            (4, Screen::Analyst) => "2v2-analyst",
            (6, Screen::Minimal) => "3v3-minimal",
            (6, Screen::Standard) => "3v3-standard",
            (6, Screen::Analyst) => "3v3-analyst",
            (_, Screen::Minimal) => "4v4-minimal",
            (_, Screen::Standard) => "4v4-standard",
            (_, Screen::Analyst) => "4v4-analyst",
        }
    }

    /// Presets the fake game, the panel set, and the vantage point the panels are watched from.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.mode = overlay_ui::shell::Mode::Replay;
        self.panels.apply(&mut knobs.host.panels);
        // The dock's two forms are both worth looking at, and the screen that asks for everything
        // is the one whose watcher wants the rail spelled out.
        knobs.host.panels.dock_expanded = self.panels == Screen::Analyst;
        knobs.observer = Knobs {
            players: self.players,
            selection_building: self.showcase == Showcase::Producing,
            selection_cargo: self.showcase == Showcase::Loaded,
            ..Knobs::default()
        };
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
            "Split down the middle into two sides. Two players get the matchup bar's halves, four \
             get its stacked form, and five or more get the corner team cards with the clock \
             alone between them.",
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
            "Selects a building part way through a unit with two more queued, which is the reading \
             an egg mid-morph gets as well.",
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
