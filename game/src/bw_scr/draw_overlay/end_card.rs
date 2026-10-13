//! The end-of-game card's numbers, read off the game at the moment it was decided.

use overlay_ui::end_card::{EndCardStats, EndCardView, GameResult};

use crate::bw;
use crate::bw::apm_stats::ApmStats;
use crate::bw_scr::game_stats::{SCORE_UNITS_KILLED, SCORE_UNITS_LOST, SCORE_UNITS_PRODUCED};

use super::BwVars;

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
    let stats = (player < MAX_PLAYERS).then(|| EndCardStats {
        units_produced: bw.game.score(SCORE_UNITS_PRODUCED, player),
        units_killed: bw.game.score(SCORE_UNITS_KILLED, player),
        units_lost: bw.game.score(SCORE_UNITS_LOST, player),
        minerals_gathered: bw::gathered_minerals(bw.game, player),
        gas_gathered: bw::gathered_gas(bw.game, player),
        average_apm: apm.and_then(|apm| apm.player_average_apm(player)),
    });
    EndCardView {
        result,
        game_seconds,
        stats,
    }
}
