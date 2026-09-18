//! The stats wings' views: what the sampler's history looks like once it is a panel.
//!
//! Every panel here reports on the same set of players in the same order, so the set is worked out
//! once and the four builders share it. That is also what keeps a row in one wing lined up with the
//! row for the same player in the other.

use egui::Color32;
use overlay_ui::observer::{
    EconomyPlayerView, EconomyView, GraphLineView, GraphSeries, GraphsView, MilitaryPlayerView,
    MilitaryView, TimelineEventView, TimelineView,
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
        .map(|(_team, player_id)| StatsPlayer {
            player_id,
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

/// Builds the graphs panel's view for whichever series the watcher is on.
///
/// Only that one series is thinned out of the history. The panel plots one at a time, and the other
/// four would be four times the work for lines nobody is looking at.
pub fn build_graphs_view(
    bw: &BwVars,
    players: &[StatsPlayer],
    stats: Option<&GameStats>,
    series: GraphSeries,
) -> GraphsView {
    GraphsView {
        series,
        span_secs: elapsed_secs(bw) as u32,
        lines: players
            .iter()
            .map(|player| GraphLineView {
                label: player.name.clone(),
                color: player.color,
                values: stats
                    .map(|stats| stats.series(player.player_id, series, GRAPH_POINTS))
                    .unwrap_or_default(),
            })
            .collect(),
    }
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
fn player_color(bw: &BwVars, player_id: u8) -> Color32 {
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
fn player_name(bw: &BwVars, player_id: u8) -> String {
    let name = unsafe { bw::player_name(bw.players.add(player_id as usize)) };
    if name.is_empty() {
        format!("Player {}", player_id + 1)
    } else {
        name.into_owned()
    }
}
