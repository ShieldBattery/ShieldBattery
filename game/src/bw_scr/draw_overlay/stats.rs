//! The stats wings' views: what the sampler's history looks like once it is a panel.
//!
//! Every panel here reports on the same set of players in the same order, so the set is worked out
//! once a frame and every builder shares it. That is also what keeps a row in one wing lined up
//! with the row for the same player in the other.

use std::collections::HashMap;

use bw_dat::{Game, Race, Unit, UnitId};
use egui::Color32;
use overlay_ui::kit::theme;
use overlay_ui::kit::widgets::{ResourceGlyph, ResourceRace};
use overlay_ui::observer::{
    ControlGroupView, ControlGroupsPlayerView, ControlGroupsView, EconomyPlayerView, EconomyView,
    GraphGrouping, GraphLineView, GraphSeries, GraphsView, MapControlSideView, MapControlView,
    MatchupPlayerView, MatchupView, MilitaryPlayerView, MilitaryView, ObserverView, ProductionIcon,
    ProductionView, RaceView, ResourcesLeftView, SelectedUnitView, SelectionView,
    TeamCardPlayerView, TeamCardTotalsView, TeamCardView, TeamCardsView, TimelineEventView,
    TimelineView,
};
use overlay_ui::shell::PanelPrefs;
use overlay_ui::transport;

use crate::bw;
use crate::bw::players::BwPlayerId;
use crate::bw_scr::game_stats::{GameStats, HistoryStamp, Sample, StatsAsOf, TimelineSubject};
use crate::game_thread;
use crate::user_aliases;

use super::{
    BwVars, FASTEST_GAME_SPEED, has_player_vision, player_has_units, production,
    replay_players_by_team,
};

/// How many points one graph line is drawn from.
///
/// The plot is a few hundred points wide, so this is about one value for every two of them: fewer
/// would lose the shape of a fight, more would be line segments too short to see.
const GRAPH_POINTS: usize = 180;

/// One player as every stats wing names them.
#[derive(PartialEq)]
struct StatsPlayer {
    pub player_id: u8,
    /// Which side of the game they are on, which is where the tables' dividers fall and which side
    /// of the game their numbers are summed into.
    pub team: u8,
    pub name: String,
    pub color: Color32,
    pub vision: bool,
    pub race: RaceView,
}

/// The players the stats wings have rows for, in the order the replay lists them.
///
/// The same rule the matchup bar uses, so a game's panels all report on the same players: a slot
/// with no units is taken for an observer on a UMS map, a team game's slots are all kept since one
/// of them owns the team's units, and a slot whose vision the watcher has taken is kept whatever it
/// owns, so it is clear where the vision on screen is coming from.
fn stats_players(bw: &BwVars) -> Vec<StatsPlayer> {
    replay_players_by_team(bw)
        .filter(|&(_team, player_id)| {
            player_has_units(bw, player_id) || bw.is_team_game || has_player_vision(bw, player_id)
        })
        .map(|(team, player_id)| StatsPlayer {
            player_id,
            team,
            name: player_name(bw, player_id),
            color: player_color(bw, player_id),
            vision: has_player_vision(bw, player_id),
            race: player_race(bw, player_id).1,
        })
        .collect()
}

/// The observer panels as the last frame handed them to the shell, and what the ones reporting the
/// sampler's history were built from.
///
/// The economy, military, graphs and timeline panels read only the history, which moves at a sample
/// or when a seek moves the frame it is read up to; the timeline of a long game alone is thousands
/// of names. Each is built again only once something it reads has moved, and only while it is
/// wanted on screen; a hidden panel keeps the view it last had for its fade-out.
///
/// The rest are read off the game and built every frame, and so are the icons, since a change of
/// graphics can swap them without a sample being taken.
pub(super) struct ObserverViewCache {
    view: ObserverView,
    /// Who every sampled panel has rows for. A change of it is a change of every one of them.
    players: Vec<StatsPlayer>,
    /// What each sampled view was built from, or `None` for one that has to be built before it is
    /// shown.
    economy: Option<Option<HistoryStamp>>,
    military: Option<Option<HistoryStamp>>,
    graphs: Option<GraphsKey>,
    timeline: Option<TimelineKey>,
    timeline_icons: TimelineIcons,
}

/// What a graphs view was built from.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct GraphsKey {
    samples: Option<HistoryStamp>,
    series: GraphSeries,
    grouping: Option<GraphGrouping>,
}

/// What a timeline view was built from.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct TimelineKey {
    events: Option<HistoryStamp>,
    /// What a frame stamp is turned into seconds at.
    game_speed: u8,
    /// Whether the game's names could be read.
    named: bool,
}

impl ObserverViewCache {
    /// The view for this frame, reusing whatever of `previous` nothing has moved under.
    ///
    /// `matchup` and `production` are this frame's, built by the caller.
    pub(super) fn build(
        previous: Option<ObserverViewCache>,
        bw: &BwVars,
        game_stats: Option<&GameStats>,
        prefs: &PanelPrefs,
        matchup: MatchupView,
        production: ProductionView,
    ) -> ObserverViewCache {
        let players = stats_players(bw);
        let stats = game_stats.map(|stats| stats.as_of(bw.game.frame_count()));
        let stats = stats.as_ref();
        // A game with one player per side plots the same lines either way, so it is told there is
        // no grouping to name rather than titled with a distinction it does not have.
        let grouping = matchup.has_teams().then_some(if prefs.graph_per_player {
            GraphGrouping::Players
        } else {
            GraphGrouping::Teams
        });
        // The corner cards are what a game the bar has no halves for is read from instead. They
        // are cut from the game exactly where the bar would have cut it, so the same players end
        // up on the same side of the screen either way.
        let team_cards = (matchup.form() == overlay_ui::observer::MatchupForm::ClockOnly)
            .then(|| build_team_cards_view(&matchup, &players, stats));
        let control_groups = build_control_groups_view(bw, &players, stats);
        let selection = build_selection_view(bw, &players);
        let map_control = build_map_control_view(&matchup, stats);
        let mut cache = match previous {
            Some(mut cache) => {
                cache.view.matchup = matchup;
                cache.view.team_cards = team_cards;
                cache.view.production = production;
                cache.view.control_groups = control_groups;
                cache.view.selection = selection;
                cache.view.map_control = map_control;
                if cache.players != players {
                    cache.players = players;
                    cache.economy = None;
                    cache.military = None;
                    cache.graphs = None;
                    cache.timeline = None;
                }
                cache
            }
            None => ObserverViewCache {
                view: ObserverView {
                    matchup,
                    team_cards,
                    economy: EconomyView {
                        players: Vec::new(),
                    },
                    military: MilitaryView {
                        players: Vec::new(),
                    },
                    graphs: GraphsView {
                        series: prefs.graph_series,
                        span_secs: 0,
                        lines: Vec::new(),
                        grouping,
                    },
                    timeline: TimelineView { events: Vec::new() },
                    production,
                    control_groups,
                    selection,
                    map_control,
                },
                players,
                economy: None,
                military: None,
                graphs: None,
                timeline: None,
                timeline_icons: TimelineIcons::default(),
            },
        };

        let samples = stats.map(StatsAsOf::samples_stamp);
        if stale(&cache.economy, &samples, prefs.economy) {
            cache.view.economy = build_economy_view(&cache.players, stats);
            cache.economy = Some(samples);
        }
        if stale(&cache.military, &samples, prefs.military) {
            cache.view.military = build_military_view(&cache.players, stats);
            cache.military = Some(samples);
        }
        let graphs = GraphsKey {
            samples,
            series: prefs.graph_series,
            grouping,
        };
        if stale(&cache.graphs, &graphs, prefs.graphs) {
            cache.view.graphs = build_graphs_view(&cache.players, stats, graphs.series, grouping);
            cache.graphs = Some(graphs);
        }
        // The axis runs to the frame on screen rather than to the last sample.
        cache.view.graphs.span_secs = elapsed_secs(bw) as u32;
        let timeline = TimelineKey {
            events: stats.map(StatsAsOf::events_stamp),
            game_speed: game_speed(bw),
            named: bw.stat_txt.is_some(),
        };
        // A replay's seek bar is ticked with the timeline's events, whether or not the panel is up.
        let timeline_wanted = prefs.timeline || (bw.replay.is_some() && prefs.transport);
        if stale(&cache.timeline, &timeline, timeline_wanted) {
            let (view, icons) = build_timeline_view(bw, &cache.players, stats);
            cache.view.timeline = view;
            cache.timeline_icons = icons;
            cache.timeline = Some(timeline);
        }
        cache
            .timeline_icons
            .refresh(&mut cache.view.timeline.events, |subject| {
                production::timeline_icon(subject, bw)
            });
        cache
    }

    pub(super) fn view(&self) -> &ObserverView {
        &self.view
    }
}

/// Whether a view last built from `built_from` has to be built again to be what `key` says, which
/// it only is while it is `wanted` on screen.
fn stale<K: PartialEq>(built_from: &Option<K>, key: &K, wanted: bool) -> bool {
    wanted && built_from.as_ref() != Some(key)
}

/// The icons of a timeline view's events, read once per subject rather than once per event: a game
/// names a few dozen kinds of building and research a few thousand times between them.
#[derive(Default)]
struct TimelineIcons {
    /// Every subject the view names, once each.
    subjects: Vec<TimelineSubject>,
    /// The icon written into the view's events for each of `subjects`.
    icons: Vec<Option<ProductionIcon>>,
    /// Which of `subjects` each of the view's events is about, in the view's order.
    of_event: Vec<u32>,
}

impl TimelineIcons {
    /// Indexes the subjects of `events`, in the order the view lists them.
    fn index(events: impl Iterator<Item = TimelineSubject>) -> TimelineIcons {
        let mut indices: HashMap<TimelineSubject, u32> = HashMap::new();
        let mut subjects = Vec::new();
        let of_event = events
            .map(|subject| {
                *indices.entry(subject).or_insert_with(|| {
                    subjects.push(subject);
                    subjects.len() as u32 - 1
                })
            })
            .collect();
        TimelineIcons {
            icons: vec![None; subjects.len()],
            subjects,
            of_event,
        }
    }

    /// Reads every subject's icon through `icon_of`, and writes the ones that changed into
    /// `events`, the view this was indexed from.
    fn refresh(
        &mut self,
        events: &mut [TimelineEventView],
        icon_of: impl Fn(TimelineSubject) -> ProductionIcon,
    ) {
        let mut changed = false;
        for (&subject, icon) in self.subjects.iter().zip(&mut self.icons) {
            let now = Some(icon_of(subject));
            if *icon != now {
                *icon = now;
                changed = true;
            }
        }
        if changed {
            for (event, &index) in events.iter_mut().zip(&self.of_event) {
                event.icon = self.icons[index as usize];
            }
        }
    }
}

/// Each side's share of the map in sight, for a game of exactly two sides. The game measures no
/// control of territory, but it does keep what every player can see, and the part of the map a side
/// has in sight is where its units and buildings are: the closest reading of map control the game
/// itself backs.
fn build_map_control_view(
    matchup: &MatchupView,
    stats: Option<&StatsAsOf<'_>>,
) -> Option<MapControlView> {
    let vision = stats?.vision()?;
    let halves = matchup.halves();
    halves.teams?;
    let side = |players: &[&MatchupPlayerView]| {
        let mask = players
            .iter()
            .filter(|player| player.player_id < 8)
            .fold(0u8, |mask, player| mask | (1 << player.player_id));
        Some(MapControlSideView {
            color: players.first()?.color,
            share: vision.seen_by(mask),
        })
    };
    Some(MapControlView {
        left: side(&halves.left)?,
        right: side(&halves.right)?,
    })
}

/// Builds the economy panel's view.
fn build_economy_view(players: &[StatsPlayer], stats: Option<&StatsAsOf<'_>>) -> EconomyView {
    EconomyView {
        players: players
            .iter()
            .map(|player| {
                let sample = latest(stats, player.player_id);
                let (minerals_per_minute, gas_per_minute) = stats
                    .map(|stats| stats.income_per_minute(player.player_id))
                    .unwrap_or((0, 0));
                EconomyPlayerView {
                    name: player.name.clone(),
                    team: player.team,
                    color: player.color,
                    vision: player.vision,
                    race: player.race,
                    minerals_per_minute,
                    gas_per_minute,
                    workers: sample.workers,
                    idle_workers: sample.idle_workers,
                    income_trend: stats.and_then(|stats| stats.income_trend(player.player_id)),
                }
            })
            .collect(),
    }
}

/// Builds the military panel's view.
fn build_military_view(players: &[StatsPlayer], stats: Option<&StatsAsOf<'_>>) -> MilitaryView {
    MilitaryView {
        players: players
            .iter()
            .map(|player| {
                let sample = latest(stats, player.player_id);
                MilitaryPlayerView {
                    name: player.name.clone(),
                    team: player.team,
                    color: player.color,
                    vision: player.vision,
                    race: player.race,
                    army_minerals: sample.army_minerals,
                    army_gas: sample.army_gas,
                    units_killed: sample.units_killed,
                    units_lost: sample.units_lost,
                    worker_kills: sample.worker_kills,
                    worker_losses: sample.worker_losses,
                }
            })
            .collect(),
    }
}

/// Builds the graphs panel's view for whichever series the watcher is on, plotted for whichever of
/// the game's sides or players they asked for.
///
/// Only that one series is thinned out of the history. The panel plots one at a time, and the other
/// four would be four times the work for lines nobody is looking at. The time axis is left to the
/// caller, since it runs to the frame on screen rather than to the samples.
fn build_graphs_view(
    players: &[StatsPlayer],
    stats: Option<&StatsAsOf<'_>>,
    series: GraphSeries,
    grouping: Option<GraphGrouping>,
) -> GraphsView {
    let of_player = |player: &StatsPlayer| {
        stats
            .map(|stats| stats.series(player.player_id, series, GRAPH_POINTS))
            .unwrap_or_default()
    };
    let lines = if grouping == Some(GraphGrouping::Teams) {
        sides(players)
            .into_iter()
            .map(|(team, members)| GraphLineView {
                label: overlay_ui::observer::team_name(team),
                // A side's line takes the color of the player at the top of its block in every
                // other panel, which is the only color on screen that already stands for it.
                color: members
                    .first()
                    .map(|player| player.color)
                    .unwrap_or(Color32::WHITE),
                values: members
                    .into_iter()
                    .map(of_player)
                    .fold(Vec::new(), |total, values| add_series(total, &values)),
            })
            .collect()
    } else {
        players
            .iter()
            .map(|player| GraphLineView {
                label: player.name.clone(),
                color: player.color,
                values: of_player(player),
            })
            .collect()
    };
    GraphsView {
        series,
        span_secs: 0,
        lines,
        grouping,
    }
}

/// Adds one player's samples into a side's running total, keeping whichever of the two is shorter.
///
/// Every player is sampled on the same frames, so their lines are the same length; the trim only
/// guards against one that is not, since a side's line is more honest stopping where its shortest
/// member's history does than running on as a partial sum.
fn add_series(total: Vec<f32>, values: &[f32]) -> Vec<f32> {
    if total.is_empty() {
        return values.to_vec();
    }
    total
        .into_iter()
        .zip(values)
        .map(|(sum, value)| sum + value)
        .collect()
}

/// The players grouped into the sides they are on, in the order the sides are listed.
fn sides(players: &[StatsPlayer]) -> Vec<(u8, Vec<&StatsPlayer>)> {
    let mut sides: Vec<(u8, Vec<&StatsPlayer>)> = Vec::new();
    for player in players {
        match sides.last_mut() {
            Some((team, members)) if *team == player.team => members.push(player),
            _ => sides.push((player.team, vec![player])),
        }
    }
    sides
}

/// Builds the corner team cards, for a game whose players the matchup bar has no halves for.
///
/// Read off the bar's own players and cut along the bar's own halves, so the cards carry exactly the
/// numbers and players the bar's halves would have.
fn build_team_cards_view(
    matchup: &MatchupView,
    players: &[StatsPlayer],
    stats: Option<&StatsAsOf<'_>>,
) -> TeamCardsView {
    TeamCardsView {
        teams: matchup
            .halves()
            .each()
            .into_iter()
            // A half with nobody in it is no card: an empty corner of chrome would say the game
            // has an end to it that has no players.
            .filter(|(_, members)| !members.is_empty())
            .map(|(team, members)| TeamCardView {
                team,
                players: members
                    .iter()
                    .map(|player| TeamCardPlayerView {
                        player_id: player.player_id,
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
                // Only a card that stands for a side has anything to sum: the players on a half of
                // a free-for-all are not on a side together, so their totals would be a number
                // about nothing.
                totals: team.map(|team| {
                    team_totals(stats, players.iter().filter(|player| player.team == team))
                }),
            })
            .collect(),
    }
}

/// What one side has between them, summed over the players on it.
fn team_totals<'a>(
    stats: Option<&StatsAsOf<'_>>,
    members: impl Iterator<Item = &'a StatsPlayer>,
) -> TeamCardTotalsView {
    let mut totals = TeamCardTotalsView::default();
    for player in members {
        let sample = latest(stats, player.player_id);
        let (minerals, gas) = stats
            .map(|stats| stats.income_per_minute(player.player_id))
            .unwrap_or((0, 0));
        totals.minerals_per_minute = totals.minerals_per_minute.saturating_add(minerals);
        totals.gas_per_minute = totals.gas_per_minute.saturating_add(gas);
        totals.army_minerals = totals.army_minerals.saturating_add(sample.army_minerals);
        totals.army_gas = totals.army_gas.saturating_add(sample.army_gas);
        totals.workers = totals.workers.saturating_add(sample.workers);
        totals.units_killed = totals.units_killed.saturating_add(sample.units_killed);
        totals.units_lost = totals.units_lost.saturating_add(sample.units_lost);
    }
    totals
}

/// Builds the control groups panel's view: what each player has on their number keys.
fn build_control_groups_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    stats: Option<&StatsAsOf<'_>>,
) -> ControlGroupsView {
    ControlGroupsView {
        // A player who has left has nothing on their keys any more: what they had went to nobody.
        players: players
            .iter()
            .filter(|player| unsafe {
                !crate::bw_scr::game_stats::player_out(bw.game, bw.players, player.player_id)
            })
            .map(|player| ControlGroupsPlayerView {
                player_id: player.player_id,
                color: player.color,
                vision: player.vision,
                groups: stats
                    .map(|stats| stats.control_groups(player.player_id))
                    .unwrap_or_default()
                    .iter()
                    .map(|group| ControlGroupView {
                        key: group.key,
                        icon: production::unit_icon(group.unit_id, bw),
                        combo: group
                            .secondary_unit_id
                            .map(|unit_id| production::unit_icon(unit_id, bw)),
                        count: group.count,
                        building: group.building,
                        stale: group.stale,
                    })
                    .collect(),
            })
            .collect(),
        default_player: game_thread::replay_seat_of_local_user(),
    }
}

/// Builds the selection panel's view: what the local client has clicked, in the game's order.
///
/// Read straight off the selection rather than off the sampler, so the panel changes in the same
/// frame the click does.
fn build_selection_view(bw: &BwVars, players: &[StatsPlayer]) -> SelectionView {
    let selected: Vec<Unit> = bw
        .client_selection
        .iter()
        .flatten()
        .take(SelectionView::MAX_UNITS)
        .copied()
        .collect();
    let alone = selected.len() == 1;
    SelectionView {
        units: selected
            .into_iter()
            .map(|unit| selected_unit_view(bw, players, unit, alone))
            .collect(),
    }
}

/// One selected unit, named and measured the way the game's own console measures it, with what it
/// is making and what it is carrying, and the upgrades it fights with and how many of it are
/// stacked where it is selected `alone`: those are only read out for a unit selected alone, so they
/// are only read for one.
fn selected_unit_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    unit: Unit,
    alone: bool,
) -> SelectedUnitView {
    let mut view = carried_unit_view(bw, players, unit);
    view.production = production::selected_production(unit, bw);
    view.cargo = cargo_views(bw, players, unit);
    if alone {
        view.upgrades = production::selected_upgrades(unit, bw);
        view.stacked = game_thread::stacked_building_count(unit, bw.active_units);
    }
    view
}

/// The units inside a transport or a bunker, in the order the game holds them, and nothing at all
/// for anything else.
fn cargo_views(bw: &BwVars, players: &[StatsPlayer], unit: Unit) -> Vec<SelectedUnitView> {
    let Some(units) = bw.units.as_ref() else {
        return Vec::new();
    };
    if !carries_units(bw.game, unit) {
        return Vec::new();
    }
    unit.loaded_units(units)
        .map(|loaded| carried_unit_view(bw, players, loaded))
        .collect()
}

/// Whether this unit is one that holds other units inside it.
///
/// A bunker is named on its own rather than left to `is_transport`, which answers what may be
/// loaded into a unit rather than what is in it: it refuses a hallucination, and it refuses an
/// overlord until ventral sacs are researched. Those are rules about loading, and a bunker's cargo
/// is read whatever they say.
fn carries_units(game: Game, unit: Unit) -> bool {
    unit.id() == bw_dat::unit::BUNKER || unit.is_transport(game)
}

/// One unit as a slot of the panel reports it, with nothing of what it is making or carrying.
///
/// What a carried unit is doing is not a reading the panel has room for, and a unit inside a unit
/// inside a unit is not a thing the game has: everything a transport or a bunker can hold is
/// ground infantry, which carries nothing of its own.
fn carried_unit_view(bw: &BwVars, players: &[StatsPlayer], unit: Unit) -> SelectedUnitView {
    let unit_id = unit.id();
    // A unit can belong to a slot no stats wing has a row for — anything neutral, and any slot the
    // wings dropped — and then no color or name on screen stands for its owner.
    let owner = players
        .iter()
        .find(|player| player.player_id == unit.player());
    let hit_points = whole_points(unit.hitpoints());
    // Already the game's "never zero" maximum: the unit's own hit points stand in for a dat entry
    // of zero, and one point stands in for both being zero.
    let max_hit_points = unit.max_hp_displayed().max(0) as u32;
    SelectedUnitView {
        icon: production::unit_icon_at_health(unit_id, hit_points, max_hit_points, bw),
        // The overlay is built in the game's draw, on its main thread.
        name: bw
            .stat_txt
            .and_then(|stat_txt| unsafe { stat_txt.unit_name(unit_id) }),
        owner_color: owner.map_or(theme::TEXT_DIM, |player| player.color),
        owner_name: owner.map(|player| player.name.clone()).unwrap_or_default(),
        owner: owner.map(|player| player.player_id),
        // The console writes no hit points for anything that cannot lose them, which every mineral
        // field and geyser is.
        hit_points: (!unit.is_invincible()).then_some((hit_points, max_hit_points)),
        shields: unit_id.has_shields().then(|| {
            (
                whole_points(unit.shields()),
                whole_points(unit_id.shields()),
            )
        }),
        energy: is_spellcaster(unit_id).then(|| {
            (
                whole_points(unit.energy() as i32),
                whole_points(max_energy(bw, unit) as i32),
            )
        }),
        kills: unit.kills(),
        building: unit_id.is_building(),
        resources: resources_left(unit),
        stacked: None,
        production: None,
        cargo: Vec::new(),
        upgrades: Vec::new(),
    }
}

/// What is left to mine in this unit, for a mineral field, a geyser, or the building on a geyser.
fn resources_left(unit: Unit) -> Option<ResourcesLeftView> {
    use bw_dat::unit;

    let unit_id = unit.id();
    if !unit_id.is_resource_container() {
        return None;
    }
    let (glyph, race) = match unit_id {
        unit::MINERAL_FIELD_1 | unit::MINERAL_FIELD_2 | unit::MINERAL_FIELD_3 => {
            (ResourceGlyph::Minerals, None)
        }
        unit::REFINERY => (ResourceGlyph::Gas, Some(ResourceRace::Terran)),
        unit::EXTRACTOR => (ResourceGlyph::Gas, Some(ResourceRace::Zerg)),
        unit::ASSIMILATOR => (ResourceGlyph::Gas, Some(ResourceRace::Protoss)),
        _ => (ResourceGlyph::Gas, None),
    };
    Some(ResourcesLeftView {
        glyph,
        race,
        amount: u32::from(unit.resource_amount()),
    })
}

/// Whether units.dat marks this kind of unit a spellcaster, which is what the game draws energy
/// for. `bw_dat` names the flags either side of this one in the same word, but not this one.
fn is_spellcaster(unit_id: UnitId) -> bool {
    const SPELLCASTER: u32 = 0x0020_0000;
    unit_id.flags() & SPELLCASTER != 0
}

/// The energy this unit tops out at, in the same 8.8 fixed point its current energy is in.
///
/// The upgrade tables the maximum comes from are indexed by player slot and assert on anything past
/// the twelfth, so a unit owned by no slot is answered with the unupgraded cap rather than read up.
fn max_energy(bw: &BwVars, unit: Unit) -> u32 {
    const PLAYER_SLOTS: u8 = 0xc;
    const UNUPGRADED_MAX_ENERGY: u32 = 200 * 256;
    if unit.player() < PLAYER_SLOTS {
        bw.game.max_energy(unit.player(), unit.id())
    } else {
        UNUPGRADED_MAX_ENERGY
    }
}

/// Whole points out of one of the game's 8.8 fixed-point health values.
///
/// Rounded up the way the game's own readouts round: anything left of a point is still a point, so
/// a unit that is alive never reads as zero, and a negative value (which the game allows a dying
/// unit to reach) reads as none rather than wrapping.
fn whole_points(fixed: i32) -> u32 {
    (fixed.max(0) as u32).saturating_add(0xff) >> 8
}

/// Builds the timeline's view, newest first, with its events' subjects indexed for their icons,
/// which are left for [`TimelineIcons::refresh`] to fill in.
///
/// Every event recorded up to the frame on screen, for the players the wings have rows for: an
/// event from a slot the panels are not reporting on would be a line in a color nothing else on
/// screen carries.
fn build_timeline_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    stats: Option<&StatsAsOf<'_>>,
) -> (TimelineView, TimelineIcons) {
    let game_speed = game_speed(bw);
    let mut names: HashMap<TimelineSubject, Option<String>> = HashMap::new();
    let (events, subjects): (Vec<TimelineEventView>, Vec<TimelineSubject>) = stats
        .into_iter()
        .flat_map(StatsAsOf::events)
        .filter_map(|event| {
            let player = players
                .iter()
                .find(|player| player.player_id == event.player)?;
            let name = match event.kind.names_its_subject() {
                true => names
                    .entry(event.subject)
                    .or_insert_with(|| production::timeline_name(event.subject, bw))
                    .clone(),
                false => None,
            };
            let view = TimelineEventView {
                secs: transport::frames_to_seconds(event.frame, game_speed),
                color: player.color,
                kind: event.kind,
                significance: event.significance,
                icon: None,
                name,
                team: players
                    .iter()
                    .any(|other| other.team == player.team && other.player_id != player.player_id)
                    .then_some(player.team),
                position: event
                    .position
                    .map(|(x, y)| overlay_ui::observer::MapPoint { x, y }),
            };
            Some((view, event.subject))
        })
        .unzip();
    (
        TimelineView { events },
        TimelineIcons::index(subjects.into_iter()),
    )
}

/// The last thing the sampler recorded about a player, or an empty second before it has recorded
/// anything.
///
/// Zeroes rather than no row: a game's first second is one where every one of these numbers really
/// is zero, and a panel that appeared a second late would read as a panel that failed to open.
fn latest(stats: Option<&StatsAsOf<'_>>, player_id: u8) -> Sample {
    stats
        .and_then(|stats| stats.latest(player_id))
        .copied()
        .unwrap_or_default()
}

/// How far into the game it is, in seconds.
fn elapsed_secs(bw: &BwVars) -> u64 {
    transport::frames_to_seconds(bw.game.frame_count(), game_speed(bw))
}

/// The speed the game's frames are turned into seconds at: the replay's recorded one, or Fastest.
pub(super) fn game_speed(bw: &BwVars) -> u8 {
    bw.replay
        .map_or(FASTEST_GAME_SPEED, |replay| replay.game_speed)
}

/// The color this player is on the map.
pub(super) fn player_color(bw: &BwVars, player_id: u8) -> Color32 {
    let color = unsafe {
        bw::player_color(
            bw.game,
            bw.main_palette,
            bw.use_rgb_colors,
            bw.rgb_colors,
            player_id,
        )
    };
    Color32::from_rgb(color[0], color[1], color[2])
}

/// A player's race, as the game counts its supply and as a panel draws it.
pub(super) fn player_race(bw: &BwVars, player_id: u8) -> (Race, RaceView) {
    // SAFETY: the player table is the game's, with a slot for every player id.
    match unsafe { (*bw.players.add(player_id as usize)).race } {
        0 => (Race::Zerg, RaceView::Zerg),
        1 => (Race::Terran, RaceView::Terran),
        2 => (Race::Protoss, RaceView::Protoss),
        // A random player's race is resolved before the game starts, so anything else here is a
        // slot whose race the game itself does not know.
        _ => (Race::Zerg, RaceView::Random),
    }
}

/// What this player is called (or the alias the local user gave them), falling back to their slot
/// for a slot that carries no name.
pub(super) fn player_name(bw: &BwVars, player_id: u8) -> String {
    let name = user_aliases::player_display_name(BwPlayerId(player_id), unsafe {
        bw::player_name(bw.players.add(player_id as usize))
    });
    if name.is_empty() {
        format!("Player {}", player_id + 1)
    } else {
        name.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(player_id: u8, team: u8) -> StatsPlayer {
        StatsPlayer {
            player_id,
            team,
            name: String::new(),
            color: Color32::WHITE,
            vision: true,
            race: RaceView::Terran,
        }
    }

    fn icon(index: u16) -> ProductionIcon {
        ProductionIcon {
            texture: None,
            index,
            size: None,
            margin: 0.0,
            wireframe: None,
        }
    }

    fn event() -> TimelineEventView {
        TimelineEventView {
            secs: 0,
            color: Color32::WHITE,
            kind: overlay_ui::observer::TimelineEventKind::BuildingCompleted,
            significance: overlay_ui::observer::Significance::Notable,
            icon: None,
            name: None,
            team: None,
            position: None,
        }
    }

    #[test]
    fn a_view_is_built_again_only_once_what_it_reads_has_moved() {
        assert!(stale(&None, &1, true));
        assert!(!stale(&Some(1), &1, true));
        assert!(stale(&Some(1), &2, true));
    }

    #[test]
    fn a_hidden_view_keeps_what_it_was_last_built_with() {
        assert!(!stale(&Some(1), &2, false));
        assert!(!stale(&None::<u32>, &2, false));
    }

    #[test]
    fn every_event_takes_its_subjects_icon_as_it_is_now() {
        use bw_dat::unit;
        let subjects = [
            TimelineSubject::Unit(unit::BARRACKS),
            TimelineSubject::Unit(unit::FACTORY),
            TimelineSubject::Unit(unit::BARRACKS),
        ];
        let mut events: Vec<_> = subjects.iter().map(|_| event()).collect();
        let mut icons = TimelineIcons::index(subjects.into_iter());
        assert_eq!(icons.subjects.len(), 2);
        let icon_of = |offset: u16| {
            move |subject: TimelineSubject| match subject {
                TimelineSubject::Unit(id) => icon(id.0 + offset),
                _ => icon(0),
            }
        };
        icons.refresh(&mut events, icon_of(0));
        let indices = |events: &[TimelineEventView]| -> Vec<Option<u16>> {
            events
                .iter()
                .map(|event| event.icon.map(|icon| icon.index))
                .collect()
        };
        let barracks = unit::BARRACKS.0;
        let factory = unit::FACTORY.0;
        assert_eq!(
            indices(&events),
            [Some(barracks), Some(factory), Some(barracks)]
        );
        // The atlas the icons are read from changed between frames.
        icons.refresh(&mut events, icon_of(1000));
        assert_eq!(
            indices(&events),
            [
                Some(barracks + 1000),
                Some(factory + 1000),
                Some(barracks + 1000)
            ]
        );
    }

    #[test]
    fn a_sides_line_is_the_sum_of_its_members_lines() {
        let total = add_series(Vec::new(), &[1.0, 2.0, 3.0]);
        assert_eq!(
            add_series(total, &[10.0, 20.0, 30.0]),
            vec![11.0, 22.0, 33.0]
        );
    }

    #[test]
    fn a_side_stops_where_its_shortest_members_history_does() {
        let total = add_series(Vec::new(), &[1.0, 2.0, 3.0]);
        assert_eq!(add_series(total, &[10.0]), vec![11.0]);
        let total = add_series(Vec::new(), &[1.0]);
        assert_eq!(add_series(total, &[10.0, 20.0]), vec![11.0]);
    }

    #[test]
    fn a_part_of_a_point_still_reads_as_a_whole_one() {
        assert_eq!(whole_points(0), 0);
        assert_eq!(whole_points(1), 1);
        assert_eq!(whole_points(0x80), 1);
        assert_eq!(whole_points(0x100), 1);
        assert_eq!(whole_points(0x101), 2);
        assert_eq!(whole_points(40 * 256), 40);
    }

    #[test]
    fn a_dying_units_negative_health_reads_as_none() {
        assert_eq!(whole_points(-1), 0);
        assert_eq!(whole_points(i32::MIN), 0);
    }

    #[test]
    fn the_sides_keep_the_order_the_players_are_listed_in() {
        let players = [player(3, 1), player(0, 1), player(5, 2)];
        let sides = sides(&players);
        assert_eq!(sides.len(), 2);
        assert_eq!(sides[0].0, 1);
        assert_eq!(
            sides[0].1.iter().map(|p| p.player_id).collect::<Vec<_>>(),
            vec![3, 0]
        );
        assert_eq!(sides[1].0, 2);
        assert_eq!(
            sides[1].1.iter().map(|p| p.player_id).collect::<Vec<_>>(),
            vec![5]
        );
    }
}
