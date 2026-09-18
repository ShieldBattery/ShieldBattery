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
//! One matchup fits on the bar today, so the scenario runs two players. The sampling below is
//! per-player and knows nothing about how many there are, which is what the team variants will need
//! of it.

use overlay_ui::observer::{
    EconomyPlayerView, EconomyView, GraphLineView, GraphSeries, GraphsView, MapControlSideView,
    MapControlView, MatchupPlayerView, MatchupView, MilitaryPlayerView, MilitaryView, ObserverView,
    ProductionIcon, ProductionItemView, ProductionPlayerView, ProductionView, RaceView,
    TimelineEventKind, TimelineEventView, TimelineView,
};
use overlay_ui::shell::PanelPreset;
use serde::{Deserialize, Serialize};

use crate::knobs::Knobs as AllKnobs;

/// How many players the bar has halves for.
const PLAYERS: usize = 2;

/// The longest name the game lets a player carry, which is what the bar's name slot has to survive.
const LONG_NAME: &str = "MaximumLengthName_24ch";

/// The names the fake game's players are given, in side order.
const NAMES: [&str; PLAYERS] = ["Rhynso", "tec27"];

/// How many points a graph line is drawn from. The panel is a few hundred points wide, so more
/// samples than this would be more line segments than there are pixels to draw them in.
const GRAPH_POINTS: usize = 120;

/// How often the fake game puts something on the timeline, in seconds of game time.
const EVENT_INTERVAL_SECS: u64 = 37;

/// How many events the fake game keeps. More than the panel draws, so a host that grew the feed
/// would have something to grow it with.
const TIMELINE_DEPTH: usize = 12;

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

/// The fake game's knobs.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Knobs {
    /// Where the game's clock starts, in seconds. A live game counts up from here; a replay takes
    /// its clock from the fake replay instead, so the two never disagree on screen.
    pub start_secs: u32,
    /// What each player is playing, left side first.
    pub races: [RaceView; PLAYERS],
    /// Whether the player on the left has lost supply they were already using, which is the one
    /// number on the bar that changes color.
    pub supply_blocked: bool,
    /// Whether the players carry the longest names the game allows, which is what proves a name
    /// slot elides rather than pushing the numbers beside it out of place.
    pub long_names: bool,
    /// How many entries each player's production row carries.
    pub production_depth: usize,
    /// Whether the game reports how much of the map each side holds. The real game has no such
    /// measurement yet, so this is the switch that proves the bar disappears without one rather
    /// than drawing an empty share.
    pub map_control: bool,
}

impl Default for Knobs {
    fn default() -> Knobs {
        Knobs {
            start_secs: 612,
            races: [RaceView::Zerg, RaceView::Terran],
            supply_blocked: false,
            long_names: false,
            production_depth: 6,
            map_control: true,
        }
    }
}

/// What the fake game remembers between frames: everything the panels can change about it.
pub struct State {
    /// Whose vision the watcher is on, by player id. The game answers a vision toggle by changing
    /// what it shows; here there is nothing to show, so the panels' own state is the answer.
    vision: [bool; PLAYERS],
    /// The last production entry a click asked to be selected, which the knob panel reads back: the
    /// preview has no units to select, so the ask is all there is to see.
    pub last_selection: Option<(u8, usize)>,
}

impl State {
    pub fn new() -> State {
        State {
            vision: [true; PLAYERS],
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

/// Builds the view the game would hand the overlay at `game_secs` into the game.
pub fn build_view(
    knobs: &Knobs,
    state: &State,
    is_replay: bool,
    game_secs: u64,
    series: GraphSeries,
) -> ObserverView {
    let t = game_secs as f64;
    ObserverView {
        matchup: MatchupView {
            players: (0..PLAYERS)
                .map(|index| matchup_player(knobs, state, index, t))
                .collect(),
            elapsed_secs: game_secs,
            is_replay,
        },
        economy: EconomyView {
            players: (0..PLAYERS)
                .map(|index| economy_player(knobs, state, index, t))
                .collect(),
        },
        military: MilitaryView {
            players: (0..PLAYERS)
                .map(|index| military_player(knobs, state, index, t))
                .collect(),
        },
        graphs: GraphsView {
            series,
            span_secs: game_secs as u32,
            lines: (0..PLAYERS)
                .map(|index| graph_line(knobs, index, series, game_secs))
                .collect(),
        },
        timeline: TimelineView {
            events: timeline_events(knobs, game_secs),
        },
        production: ProductionView {
            players: (0..PLAYERS)
                .map(|index| production_player(knobs, index, t))
                .collect(),
        },
        map_control: knobs.map_control.then(|| map_control(t)),
    }
}

/// The name a panel other than the matchup bar puts on a player.
fn player_name(knobs: &Knobs, index: usize) -> String {
    if knobs.long_names {
        LONG_NAME.to_string()
    } else {
        NAMES[index].to_string()
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
    let lost = (t / 13.0) as u32 + (PLAYERS - 1 - index) as u32 * 3;
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

/// One player's line on the graphs panel, sampled evenly over the whole game so far.
///
/// The fake game keeps no history: every measurement is a function of game time, so its history is
/// that function evaluated backwards, which is what keeps an offline render of the same second the
/// same image every time.
fn graph_line(knobs: &Knobs, index: usize, series: GraphSeries, game_secs: u64) -> GraphLineView {
    let points = GRAPH_POINTS.min(game_secs as usize + 1).max(2);
    let values = (0..points)
        .map(|point| {
            let t = game_secs as f64 * point as f64 / (points - 1) as f64;
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
        })
        .collect();
    GraphLineView {
        label: player_name(knobs, index),
        color: overlay_ui::kit::theme::player_color(index),
        values,
    }
}

/// What the fake game has put on the timeline by `game_secs`, newest first.
fn timeline_events(knobs: &Knobs, game_secs: u64) -> Vec<TimelineEventView> {
    let count = game_secs / EVENT_INTERVAL_SECS;
    (0..count)
        .rev()
        .take(TIMELINE_DEPTH)
        .map(|index| {
            let player = (index % PLAYERS as u64) as usize;
            let units = race_units(knobs.races[player]);
            TimelineEventView {
                secs: (index + 1) * EVENT_INTERVAL_SECS,
                color: overlay_ui::kit::theme::player_color(player),
                kind: EVENT_KINDS[(index as usize / PLAYERS) % EVENT_KINDS.len()],
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

fn matchup_player(knobs: &Knobs, state: &State, index: usize, t: f64) -> MatchupPlayerView {
    let (supply_used, supply_max) = supply(knobs, index, t);
    MatchupPlayerView {
        player_id: index as u8,
        name: player_name(knobs, index),
        color: overlay_ui::kit::theme::player_color(index),
        race: knobs.races[index],
        vision: state.vision[index],
        minerals: wave(index as f64 * 2.1, t, 0.017, 1150.0),
        gas: wave(index as f64 * 1.3 + 2.0, t, 0.023, 780.0),
        supply_used,
        supply_max,
        apm: 90 + wave(index as f64 * 0.7, t, 0.09, 160.0),
    }
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
    let units = race_units(knobs.races[index]);
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

/// A one-click state of the observer panels: one matchup, one set of surfaces.
///
/// The matchup is fixed at a duel while the bar is the only form there is; the team variants take
/// their place beside it here.
#[derive(Clone, Copy)]
pub struct Preset {
    pub panels: PanelPreset,
}

impl Preset {
    pub const ALL: [Preset; 3] = [
        Preset {
            panels: PanelPreset::Minimal,
        },
        Preset {
            panels: PanelPreset::Standard,
        },
        Preset {
            panels: PanelPreset::Analyst,
        },
    ];

    pub fn label(self) -> &'static str {
        match self.panels {
            PanelPreset::Minimal => "1v1-minimal",
            PanelPreset::Standard => "1v1-standard",
            PanelPreset::Analyst => "1v1-analyst",
        }
    }

    /// Presets the fake game, the panel set, and the vantage point the panels are watched from.
    pub fn apply(self, knobs: &mut AllKnobs) {
        knobs.host.mode = overlay_ui::shell::Mode::Replay;
        self.panels.apply(&mut knobs.host.panels);
        // The dock's two forms are both worth looking at, and the preset that asks for everything is
        // the one whose watcher wants the rail spelled out.
        knobs.host.panels.dock_expanded = self.panels == PanelPreset::Analyst;
        knobs.observer = Knobs::default();
    }
}

/// The scenario's knob section. Returns whether anything changed.
pub fn knobs_ui(k: &mut Knobs, state: &State, ui: &mut egui::Ui) -> bool {
    let mut changed = false;

    ui.label(
        "Which panels are up is the shell's: the dock's own preset buttons and the panel \
         checkboxes above move that.",
    );

    changed |= ui
        .add(egui::Slider::new(&mut k.start_secs, 0..=5400).text("clock start (s)"))
        .changed();
    for (index, race) in k.races.iter_mut().enumerate() {
        ui.horizontal(|ui| {
            ui.label(format!("{} race:", NAMES[index]));
            for option in RaceView::ALL {
                changed |= ui.selectable_value(race, option, option.label()).changed();
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
        .on_hover_text("Gives both players the longest name the game allows.")
        .changed();
    changed |= ui
        .add(egui::Slider::new(&mut k.production_depth, 0..=16).text("production entries"))
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
