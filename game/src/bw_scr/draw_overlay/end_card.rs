//! The end-of-game card's numbers, read off the game at the moment it was decided.

use overlay_ui::end_card::{EndCardStats, EndCardView, GameResult, StatLeads};
use overlay_ui::observer::RaceView;

use crate::bw;
use crate::bw::apm_stats::ApmStats;
use crate::bw_scr::game_stats::{SCORE_UNITS_KILLED, SCORE_UNITS_LOST, SCORE_UNITS_PRODUCED};

use super::BwVars;
use super::stats::player_race;

/// The most players the game's per-player tables have a row for.
const MAX_PLAYERS: u8 = 8;

/// What the card says about the local player's game.
///
/// Read straight off the game's own score tables and resource totals rather than out of the
/// observer panels' sampler, which a player's own game does not run.
pub fn build_end_card_view(
    bw: &BwVars,
    apm: Option<&ApmStats>,
    result: GameResult,
    game_seconds: u64,
) -> EndCardView {
    let player = bw.local_player_id;
    let stats_of = |player: u8| EndCardStats {
        units_produced: bw.game.score(SCORE_UNITS_PRODUCED, player),
        units_killed: bw.game.score(SCORE_UNITS_KILLED, player),
        units_lost: bw.game.score(SCORE_UNITS_LOST, player),
        minerals_gathered: bw::gathered_minerals(bw.game, player),
        gas_gathered: bw::gathered_gas(bw.game, player),
        average_apm: apm.and_then(|apm| apm.player_average_apm(player)),
    };
    let stats = (player < MAX_PLAYERS).then(|| stats_of(player));
    let others = (0..MAX_PLAYERS)
        .filter(|&other| other != player && played_in_game(bw, other))
        .map(stats_of)
        .collect::<Vec<_>>();
    let leads = stats.map_or(StatLeads::default(), |own| StatLeads::of(&own, &others));
    // A race the game itself does not know is left off the card rather than drawn as a guess.
    let race = (player < MAX_PLAYERS)
        .then(|| player_race(bw, player).1)
        .filter(|&race| race != RaceView::Random);
    EndCardView {
        result,
        game_seconds,
        stats,
        leads,
        race,
    }
}

/// Whether this slot is someone who played the game, a person or a computer, including one who has
/// since left it: their numbers stand after they go, and a lead over them is still a lead.
fn played_in_game(bw: &BwVars, player_id: u8) -> bool {
    // SAFETY: the player table is the game's, with a slot for every player id below
    // `MAX_PLAYERS`, and it is read on the thread that runs the game.
    let player_type = unsafe { (*bw.players.add(usize::from(player_id))).player_type };
    // A computer and a person, then the two types the game marks a slot with once its player has
    // left.
    matches!(player_type, 1 | 2 | 10 | 11)
}
