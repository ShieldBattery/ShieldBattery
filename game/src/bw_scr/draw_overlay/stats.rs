//! The stats wings' views: what the sampler's history looks like once it is a panel.
//!
//! Every panel here reports on the same set of players in the same order, so the set is worked out
//! once and the four builders share it. That is also what keeps a row in one wing lined up with the
//! row for the same player in the other.

use bw_dat::{Game, Unit, UnitId};
use egui::Color32;
use overlay_ui::kit::theme;
use overlay_ui::observer::{
    ControlGroupView, ControlGroupsPlayerView, ControlGroupsView, EconomyPlayerView, EconomyView,
    GraphGrouping, GraphLineView, GraphSeries, GraphsView, MatchupView, MilitaryPlayerView,
    MilitaryView, SelectedUnitView, SelectionView, TeamCardPlayerView, TeamCardTotalsView,
    TeamCardView, TeamCardsView, TimelineEventView, TimelineView,
};
use overlay_ui::transport;

use crate::bw;
use crate::bw_scr::game_stats::{GameStats, Sample};

use super::{
    BwVars, FASTEST_GAME_SPEED, has_player_vision, player_has_units, production,
    replay_players_by_team,
};

/// How many points one graph line is drawn from.
///
/// The plot is a few hundred points wide, so this is about one value for every two of them: fewer
/// would lose the shape of a fight, more would be line segments too short to see.
const GRAPH_POINTS: usize = 180;

/// How many timeline entries are handed over. More than the panel draws, so the six it shows are
/// still the six newest after any of them is filtered out.
const TIMELINE_DEPTH: usize = 24;

/// One player as every stats wing names them.
pub struct StatsPlayer {
    pub player_id: u8,
    /// Which side of the game they are on, which is where the tables' dividers fall and which side
    /// of the game their numbers are summed into.
    pub team: u8,
    pub name: String,
    pub color: Color32,
    pub vision: bool,
}

/// The players the stats wings have rows for, in the order the replay lists them.
///
/// The same rule the matchup bar uses, so a game's panels all report on the same players: a slot
/// with no units is taken for an observer on a UMS map, a team game's slots are all kept since one
/// of them owns the team's units, and a slot whose vision the watcher has taken is kept whatever it
/// owns, so it is clear where the vision on screen is coming from.
pub fn stats_players(bw: &BwVars) -> Vec<StatsPlayer> {
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
        })
        .collect()
}

/// Builds the economy panel's view.
pub fn build_economy_view(players: &[StatsPlayer], stats: Option<&GameStats>) -> EconomyView {
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
                    minerals_per_minute,
                    gas_per_minute,
                    workers: sample.workers,
                    idle_workers: sample.idle_workers,
                }
            })
            .collect(),
    }
}

/// Builds the military panel's view.
pub fn build_military_view(players: &[StatsPlayer], stats: Option<&GameStats>) -> MilitaryView {
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
/// four would be four times the work for lines nobody is looking at.
pub fn build_graphs_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    stats: Option<&GameStats>,
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
        span_secs: elapsed_secs(bw) as u32,
        lines,
        grouping,
    }
}

/// Adds one player's samples into a side's running total, keeping whichever of the two is shorter.
///
/// Two players sampled over the same game have the same number of samples, so the trim only ever
/// matters for a slot that joined late or was cleared by a seek — and a side's line is more honest
/// stopping where its shortest member's history does than running on as a partial sum.
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
/// Read off the bar's own players rather than off the game a second time: the cards carry exactly
/// the numbers the bar's halves would have, and a second reading of them could only disagree.
pub fn build_team_cards_view(
    matchup: &MatchupView,
    players: &[StatsPlayer],
    stats: Option<&GameStats>,
) -> TeamCardsView {
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
                totals: team_totals(stats, players.iter().filter(|player| player.team == team)),
            })
            .collect(),
    }
}

/// What one side has between them, summed over the players on it.
fn team_totals<'a>(
    stats: Option<&GameStats>,
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
pub fn build_control_groups_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    stats: Option<&GameStats>,
) -> ControlGroupsView {
    ControlGroupsView {
        players: players
            .iter()
            .map(|player| ControlGroupsPlayerView {
                name: player.name.clone(),
                color: player.color,
                vision: player.vision,
                groups: stats
                    .map(|stats| stats.control_groups(player.player_id))
                    .unwrap_or_default()
                    .iter()
                    .map(|group| ControlGroupView {
                        key: group.key,
                        icon: production::unit_icon(group.unit_id, bw.is_hd),
                        combo: group
                            .secondary_unit_id
                            .map(|unit_id| production::unit_icon(unit_id, bw.is_hd)),
                        count: group.count,
                        building: group.building,
                        stale: group.stale,
                    })
                    .collect(),
            })
            .collect(),
    }
}

/// Builds the selection panel's view: what the local client has clicked, in the game's order.
///
/// Read straight off the selection rather than off the sampler, so the panel changes in the same
/// frame the click does.
pub fn build_selection_view(bw: &BwVars, players: &[StatsPlayer]) -> SelectionView {
    SelectionView {
        units: bw
            .client_selection
            .iter()
            .flatten()
            .take(SelectionView::MAX_UNITS)
            .map(|&unit| selected_unit_view(bw, players, unit))
            .collect(),
    }
}

/// One selected unit, named and measured the way the game's own console measures it, with what it
/// is making and what it is carrying.
fn selected_unit_view(bw: &BwVars, players: &[StatsPlayer], unit: Unit) -> SelectedUnitView {
    let mut view = carried_unit_view(bw, players, unit);
    view.production = production::selected_production(unit, bw.is_hd);
    view.cargo = cargo_views(bw, players, unit);
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
    SelectedUnitView {
        icon: production::unit_icon(unit_id, bw.is_hd),
        owner_color: owner.map_or(theme::TEXT_DIM, |player| player.color),
        owner_name: owner.map(|player| player.name.clone()).unwrap_or_default(),
        hit_points: (
            whole_points(unit.hitpoints()),
            // Already the game's "never zero" maximum: the unit's own hit points stand in for a
            // dat entry of zero, and one point stands in for both being zero.
            unit.max_hp_displayed().max(0) as u32,
        ),
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
        production: None,
        cargo: Vec::new(),
    }
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

/// Builds the timeline's view, newest first.
///
/// Only the players the wings have rows for: an event from a slot the panels are not reporting on
/// would be a line in a color nothing else on screen carries.
pub fn build_timeline_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    stats: Option<&GameStats>,
) -> TimelineView {
    let game_speed = bw
        .replay
        .map_or(FASTEST_GAME_SPEED, |replay| replay.game_speed);
    let events = stats
        .into_iter()
        .flat_map(GameStats::events)
        .filter_map(|event| {
            let player = players
                .iter()
                .find(|player| player.player_id == event.player)?;
            Some(TimelineEventView {
                secs: transport::frames_to_seconds(event.frame, game_speed),
                color: player.color,
                kind: event.kind,
                icon: Some(production::timeline_icon(event.subject, bw.is_hd)),
            })
        })
        .take(TIMELINE_DEPTH)
        .collect();
    TimelineView { events }
}

/// The last thing the sampler recorded about a player, or an empty second before it has recorded
/// anything.
///
/// Zeroes rather than no row: a game's first second is one where every one of these numbers really
/// is zero, and a panel that appeared a second late would read as a panel that failed to open.
fn latest(stats: Option<&GameStats>, player_id: u8) -> Sample {
    stats
        .and_then(|stats| stats.latest(player_id))
        .copied()
        .unwrap_or_default()
}

/// How far into the game it is, in seconds.
fn elapsed_secs(bw: &BwVars) -> u64 {
    transport::frames_to_seconds(
        bw.game.frame_count(),
        bw.replay
            .map_or(FASTEST_GAME_SPEED, |replay| replay.game_speed),
    )
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

/// What this player is called, falling back to their slot for a slot that carries no name.
pub(super) fn player_name(bw: &BwVars, player_id: u8) -> String {
    let name = unsafe { bw::player_name(bw.players.add(player_id as usize)) };
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
        }
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
